import { describe, test, expect, vi } from "vitest";
import { parseEventSpec } from "./extractor";
import {
  EventRule,
  RuleBook,
  applyRules,
  checkWhen,
  compileRules,
  mergePatch,
  normalizeRules,
  parseRulePatch,
  readRuleField,
  writeRuleField,
} from "./rules";

function rule(when: string, set: Record<string, unknown>, name = ""): EventRule {
  return { name, when, set };
}

function apply(eventYaml: string, rules: EventRule[]) {
  return applyRules(parseEventSpec(eventYaml), compileRules(rules));
}

describe("mergePatch", () => {
  // Examples from RFC 7386, appendix A.
  test.each([
    [{ a: "b" }, { a: "c" }, { a: "c" }],
    [{ a: "b" }, { b: "c" }, { a: "b", b: "c" }],
    [{ a: "b" }, { a: null }, {}],
    [{ a: "b", b: "c" }, { a: null }, { b: "c" }],
    [{ a: ["b"] }, { a: "c" }, { a: "c" }],
    [{ a: "c" }, { a: ["b"] }, { a: ["b"] }],
    [{ a: { b: "c" } }, { a: { b: "d", c: null } }, { a: { b: "d" } }],
    [{ a: [{ b: "c" }] }, { a: [1] }, { a: [1] }],
    [["a", "b"], ["c", "d"], ["c", "d"]],
    [{ a: "b" }, ["c"], ["c"]],
    [{ a: "foo" }, null, null],
    [{ a: "foo" }, "bar", "bar"],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: "b", c: null }, { a: "b" }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])("merges %j with %j", (target, patch, expected) => {
    expect(mergePatch(target, patch)).toEqual(expected);
  });

  test("leaves its arguments alone", () => {
    const target = { a: { b: 1 } };
    const patch = { a: { c: 2 } };
    mergePatch(target, patch);
    expect(target).toEqual({ a: { b: 1 } });
    expect(patch).toEqual({ a: { c: 2 } });
  });
});

describe("applyRules", () => {
  const hotels = rule('"hotel" in tag', { color: "brown", order: 1 }, "Hotels");

  test("sets options on matching events", () => {
    const { event, matches } = apply("title: Nikko\ntag: hotel", [hotels]);
    expect(event).toMatchObject({
      title: "Nikko",
      color: "brown",
      backgroundColor: "brown",
      borderColor: "brown",
      order: 1,
    });
    expect(matches).toEqual([{ name: "Hotels", fields: ["color", "order"] }]);
  });

  test("leaves other events alone", () => {
    const original = parseEventSpec("title: Parade");
    const { event, matches } = applyRules(original, compileRules([hotels]));
    expect(event).toBe(original);
    expect(matches).toEqual([]);
  });

  test("lets the event's own fields win, field by field", () => {
    const { event, matches } = apply(
      "title: Nikko\ntag: hotel\ncolor: red",
      [hotels]
    );
    expect(event).toMatchObject({
      backgroundColor: "red",
      borderColor: "red",
      order: 1,
    });
    expect(matches).toEqual([{ name: "Hotels", fields: ["order"] }]);
  });

  test("keeps an event's own border color under a rule's color", () => {
    const { event } = apply("title: Nikko\ntag: hotel\nborderColor: black", [
      hotels,
    ]);
    expect(event).toMatchObject({
      backgroundColor: "brown",
      borderColor: "black",
    });
  });

  test("applies every matching rule, the higher one winning", () => {
    const { event, matches } = apply("title: Nikko\ntag: [hotel, paid]", [
      rule('"paid" in tag', { color: "green" }, "Paid"),
      hotels,
    ]);
    expect(event).toMatchObject({ backgroundColor: "green", order: 1 });
    expect(matches).toEqual([
      { name: "Paid", fields: ["color"] },
      { name: "Hotels", fields: ["order"] },
    ]);
  });

  test("matches every rule against the event as written", () => {
    // The second rule would match if it saw the first rule's color.
    const { matches } = apply("title: Nikko\ntag: hotel", [
      hotels,
      rule('color == "brown"', { order: 5 }),
    ]);
    expect(matches.map((m) => m.name)).toEqual(["Hotels"]);
  });

  test("replaces lists rather than adding to them", () => {
    const { event } = apply("title: X\nclassNames: [a]", [
      rule("1 == 1", { classNames: ["b"] }),
    ]);
    expect(event.classNames).toEqual(["a"]);
    const unset = apply("title: X", [rule("1 == 1", { classNames: ["b"] })]);
    expect(unset.event.classNames).toEqual(["b"]);
  });

  test("names unnamed rules by position", () => {
    const { matches } = apply("title: X", [
      rule("false", {}),
      rule("1 == 1", { order: 2 }),
    ]);
    expect(matches).toEqual([{ name: "#2", fields: ["order"] }]);
  });

  test("reports a rule that fails on an event", () => {
    const { matches, errors } = apply("title: X", [
      rule("title > 2", { order: 1 }, "Broken"),
    ]);
    expect(matches).toEqual([]);
    expect(errors).toEqual([
      { name: "Broken", error: expect.stringMatching(/compare/) as string },
    ]);
  });

  test("skips a rule whose expression doesn't compile", () => {
    const compiled = compileRules([rule("((", { order: 1 })]);
    expect(compiled[0].filter).toBeNull();
    expect(compiled[0].error).toBeTruthy();
    const { matches, errors } = applyRules(
      parseEventSpec("title: X"),
      compiled
    );
    expect(matches).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("checkWhen", () => {
  test("accepts a valid expression", () => {
    expect(checkWhen('"hotel" in tag')).toBeNull();
  });

  test("rejects an empty or invalid one", () => {
    expect(checkWhen("  ")).toMatch(/Enter an expression/);
    expect(checkWhen("((")).toBeTruthy();
  });
});

describe("parseRulePatch", () => {
  test("reads YAML options", () => {
    expect(parseRulePatch("color: brown\norder: 1")).toEqual({
      color: "brown",
      order: 1,
    });
    expect(parseRulePatch("")).toEqual({});
  });

  test("rejects anything but options", () => {
    expect(() => parseRulePatch("- a")).toThrow(/key: value/);
    expect(() => parseRulePatch("a: [")).toThrow(/Could not parse YAML/);
    expect(() => parseRulePatch("order: first")).toThrow(/"order"/);
  });
});

describe("normalizeRules", () => {
  test("keeps well-formed rules and repairs the rest", () => {
    expect(
      normalizeRules([
        { name: "Hotels", when: "x", set: { order: 1 } },
        { name: 3, set: [] },
        "junk",
      ])
    ).toEqual([
      { name: "Hotels", when: "x", set: { order: 1 } },
      { name: "", when: "", set: {} },
    ]);
  });

  test("returns nothing for missing settings", () => {
    expect(normalizeRules(undefined)).toEqual([]);
  });
});

describe("readRuleField and writeRuleField", () => {
  test("read and write a rule's fields by key", () => {
    const rules = [rule("x", { order: 1 }, "Hotels")];
    expect(readRuleField(rules, "rules.0.name")).toBe("Hotels");
    expect(readRuleField(rules, "rules.0.set")).toBe("order: 1\n");

    expect(writeRuleField(rules, "rules.0.when", '"hotel" in tag')).toBe(true);
    expect(writeRuleField(rules, "rules.0.set", "color: brown")).toBe(true);
    expect(rules[0]).toEqual(rule('"hotel" in tag', { color: "brown" }, "Hotels"));
  });

  test("ignore keys naming no rule, and invalid options", () => {
    const rules = [rule("x", { order: 1 })];
    expect(readRuleField(rules, "rules.1.name")).toBeUndefined();
    expect(readRuleField(rules, "rules.0.other")).toBeUndefined();
    expect(writeRuleField(rules, "rules.3.name", "y")).toBe(false);
    expect(writeRuleField(rules, "rules.0.set", "- a")).toBe(false);
    expect(rules[0].set).toEqual({ order: 1 });
  });

  test("show empty options as empty text", () => {
    expect(readRuleField([rule("x", {})], "rules.0.set")).toBe("");
  });
});

describe("RuleBook", () => {
  test("tells subscribers when rules change, until they unsubscribe", () => {
    const book = new RuleBook();
    const listener = vi.fn();
    const unsubscribe = book.subscribe(listener);
    book.setRules([rule("1 == 1", { order: 1 })]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(book.apply(parseEventSpec("title: X")).event.order).toBe(1);

    unsubscribe();
    book.setRules([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
