import { describe, expect, test } from "vitest";

import {
  CompletionEnvironment,
  DocumentLines,
  EventFields,
  ItineraryFields,
  blockTags,
  complete,
  findBlock,
  findTarget,
  matching,
  presentFields,
  tagsInNote,
  yamlScalar,
} from "./completion";

function lines(text: string): DocumentLines {
  const all = text.split("\n");
  return { lineCount: all.length, getLine: (line) => all[line] };
}

/** Completes at the `|` in the text, which is removed first. */
function completeAt(
  text: string,
  env: Partial<CompletionEnvironment> = {}
): ReturnType<typeof complete> {
  const all = text.split("\n");
  const line = all.findIndex((l) => l.includes("|"));
  const ch = all[line].indexOf("|");
  all[line] = all[line].replace("|", "");
  return complete(lines(all.join("\n")), { line, ch }, {
    timeZones: () => ["America/New_York", "America/Los_Angeles", "Europe/Paris"],
    noteTags: () => [],
    ...env,
  });
}

function labels(text: string, env?: Partial<CompletionEnvironment>): string[] {
  return completeAt(text, env)?.suggestions.map((s) => s.label) ?? [];
}

describe("findBlock", () => {
  const doc = lines(
    [
      "# Trip", // 0
      "```itinerary-event", // 1
      "title: A", // 2
      "```", // 3
      "between", // 4
      "```itinerary", // 5
      "initialView: listDay", // 6
      "```", // 7
      "```js", // 8
      "code", // 9
      "```", // 10
      "```itinerary-event", // 11
      "title: unclosed", // 12
    ].join("\n")
  );

  test("finds the block whose body holds the line", () => {
    expect(findBlock(doc, 2)).toEqual({
      kind: "itinerary-event",
      openLine: 1,
      closeLine: 3,
    });
    expect(findBlock(doc, 6)).toEqual({
      kind: "itinerary",
      openLine: 5,
      closeLine: 7,
    });
  });

  test("is not in a block on its fences or outside it", () => {
    expect(findBlock(doc, 0)).toBeNull();
    expect(findBlock(doc, 1)).toBeNull();
    expect(findBlock(doc, 3)).toBeNull();
    expect(findBlock(doc, 4)).toBeNull();
  });

  test("ignores other fences", () => {
    expect(findBlock(doc, 9)).toBeNull();
  });

  test("treats an unclosed block as running to the end", () => {
    expect(findBlock(doc, 12)).toEqual({
      kind: "itinerary-event",
      openLine: 11,
      closeLine: 13,
    });
  });

  test("accepts indented fences and trailing spaces, as extractor.ts does", () => {
    const indented = lines("  ```itinerary-event  \ntitle: A\n  ```");
    expect(findBlock(indented, 1)?.kind).toBe("itinerary-event");
  });

  test("doesn't take other languages starting with the same name", () => {
    expect(findBlock(lines("```itinerary-events\ntitle: A\n```"), 1)).toBeNull();
  });
});

describe("findTarget", () => {
  test("a field name being typed", () => {
    expect(findTarget(["sta"], 0, 3)).toEqual({
      type: "field",
      query: "sta",
      from: 0,
      to: 3,
    });
  });

  test("a field name with the cursor inside it covers the whole word", () => {
    expect(findTarget(["start  "], 0, 2)).toEqual({
      type: "field",
      query: "st",
      from: 0,
      to: 5,
    });
  });

  test("not on an empty line or an indented one", () => {
    expect(findTarget([""], 0, 0)).toBeNull();
    expect(findTarget(["duration:", "  da"], 1, 4)).toBeNull();
  });

  test("a field's value", () => {
    expect(findTarget(["timeZone: Amer"], 0, 14)).toEqual({
      type: "value",
      field: "timeZone",
      query: "Amer",
      from: 10,
      to: 14,
    });
  });

  test("a value just after the colon", () => {
    expect(findTarget(["allDay: "], 0, 8)).toMatchObject({
      type: "value",
      field: "allDay",
      query: "",
    });
  });

  test("not on the key of a key: value line", () => {
    expect(findTarget(["allDay: true"], 0, 3)).toBeNull();
  });

  test("ignores an opening quote", () => {
    expect(findTarget(['tag: "ho'], 0, 8)).toMatchObject({ query: "ho" });
  });

  test("leaves flow collections and comments alone", () => {
    expect(findTarget(["tag: [a, b"], 0, 10)).toBeNull();
    expect(findTarget(["title: x # no"], 0, 13)).toBeNull();
  });

  test("a list item belongs to the field above it", () => {
    expect(findTarget(["tag:", "- hotel", "- fl"], 2, 4)).toEqual({
      type: "value",
      field: "tag",
      query: "fl",
      from: 2,
      to: 4,
    });
    expect(findTarget(["tag:", "  - fl"], 1, 6)).toMatchObject({
      field: "tag",
      query: "fl",
    });
  });

  test("a list item under no field has no target", () => {
    expect(findTarget(["- fl"], 0, 4)).toBeNull();
    expect(findTarget(["duration:", "  days: 4", "- x"], 2, 3)).toBeNull();
  });
});

describe("matching", () => {
  test("puts prefix matches first and ignores case", () => {
    expect(matching(["endTimeZone", "timeZone", "title"], "ti")).toEqual([
      "timeZone",
      "title",
      "endTimeZone",
    ]);
  });

  test("matches at the start of words only", () => {
    expect(matching(["headerToolbar", "eventOrder", "debug"], "de")).toEqual([
      "debug",
    ]);
    expect(
      matching(["America/New_York", "Europe/Paris", "Asia/Yerevan"], "york")
    ).toEqual(["America/New_York"]);
    expect(matching(["Etc/GMT+5"], "gmt")).toEqual(["Etc/GMT+5"]);
  });
});

describe("yamlScalar", () => {
  test("leaves plain text alone", () => {
    expect(yamlScalar("hotel")).toBe("hotel");
    expect(yamlScalar("America/New_York")).toBe("America/New_York");
    expect(yamlScalar("Etc/GMT+5")).toBe("Etc/GMT+5");
  });

  test("quotes text YAML would read as something else", () => {
    expect(yamlScalar("true")).toBe('"true"');
    expect(yamlScalar("2021")).toBe('"2021"');
    expect(yamlScalar("a: b")).toBe('"a: b"');
    expect(yamlScalar("#x")).toBe('"#x"');
    expect(yamlScalar("null")).toBe('"null"');
  });
});

describe("tags", () => {
  test("blockTags reads one tag or a list", () => {
    expect(blockTags("tag: hotel")).toEqual(["hotel"]);
    expect(blockTags("tag:\n- a\n- 2")).toEqual(["a", "2"]);
    expect(blockTags("title: x")).toEqual([]);
    expect(blockTags("tag: [unclosed")).toEqual([]);
  });

  test("tagsInNote collects each event block's tags once", () => {
    const note = [
      "```itinerary-event",
      "tag:",
      "- hotel",
      "```",
      "```itinerary-event",
      "tag: flight",
      "```",
      "```itinerary-event",
      "tag: [hotel, outing]",
      "```",
      "```js",
      "tag: nope",
      "```",
    ].join("\n");
    expect(tagsInNote(note)).toEqual(["hotel", "flight", "outing"]);
  });

  test("presentFields lists top-level keys", () => {
    expect([...presentFields(["title: x", "tag:", "- a", "  nested: 1"])]).toEqual(
      ["title", "tag"]
    );
  });
});

describe("complete", () => {
  test("nothing outside a block", () => {
    expect(completeAt("sta|")).toBeNull();
  });

  test("suggests event fields not yet set, with descriptions", () => {
    const result = completeAt("```itinerary-event\ntitle: A\nt|\n```");
    const names = result?.suggestions.map((s) => s.label);
    expect(names).toContain("timeZone");
    expect(names).toContain("tag");
    expect(names).not.toContain("title");
    expect(result?.suggestions.every((s) => s.description)).toBe(true);
    expect(result?.suggestions[0].text).toMatch(/^\w+: $/);
    expect(result).toMatchObject({ line: 2, from: 0, to: 1, query: "t" });
  });

  test("suggests itinerary options, including calendar options", () => {
    const names = labels("```itinerary\ni|\n```");
    expect(names).toContain("initialView");
    expect(names).toContain("initialDate");
    expect(labels("```itinerary\ns|\n```")).toContain("source");
    expect(labels("```itinerary\nde|\n```")).toEqual(["debug"]);
  });

  test("matches later words of a field name", () => {
    expect(labels("```itinerary-event\nzone|\n```")).toEqual([
      "timeZone",
      "startTimeZone",
      "endTimeZone",
    ]);
  });

  test("doesn't suggest event fields in an itinerary or the reverse", () => {
    expect(labels("```itinerary\nhidde|\n```")).toEqual(["hiddenDays"]);
    expect(labels("```itinerary-event\nsour|\n```")).toEqual([]);
  });

  test("suggests time zones as typed", () => {
    expect(labels("```itinerary-event\ntimeZone: amer|\n```")).toEqual([
      "America/New_York",
      "America/Los_Angeles",
    ]);
    expect(labels("```itinerary-event\nendTimeZone: paris|\n```")).toEqual([
      "Europe/Paris",
    ]);
    expect(labels("```itinerary\ntimeZone: Eur|\n```")).toEqual([
      "Europe/Paris",
    ]);
  });

  test("replaces the whole value", () => {
    const result = completeAt("```itinerary-event\ntimeZone: Amer|ica/Chi\n```");
    expect(result).toMatchObject({ from: 10, to: 21 });
  });

  test("suggests true and false, unquoted", () => {
    const result = completeAt("```itinerary-event\nallDay: |\n```");
    expect(result?.suggestions.map((s) => s.text)).toEqual(["true", "false"]);
    expect(labels("```itinerary-event\nhidden: f|\n```")).toEqual(["false"]);
    expect(labels("```itinerary\ndebug: |\n```")).toEqual(["true", "false"]);
  });

  test("offers nothing once the value is complete", () => {
    expect(completeAt("```itinerary-event\nallDay: true|\n```")).toBeNull();
  });

  test("suggests the plugin's views for initialView", () => {
    expect(labels("```itinerary\ninitialView: listW|\n```")).toEqual([
      "listWeek",
    ]);
    expect(labels("```itinerary\ninitialView: |\n```")).toContain(
      "timeGridDay"
    );
  });

  test("suggests the note's tags, inline or as list items", () => {
    const env = { noteTags: () => ["hotel", "flight", "outing"] };
    expect(labels("```itinerary-event\ntag: o|\n```", env)).toEqual([
      "outing",
    ]);
    expect(labels("```itinerary-event\ntag:\n- f|\n```", env)).toEqual([
      "flight",
    ]);
  });

  test("leaves out tags the event already has", () => {
    const env = { noteTags: () => ["hotel", "flight", "outing"] };
    expect(labels("```itinerary-event\ntag:\n- hotel\n- |\n```", env)).toEqual([
      "flight",
      "outing",
    ]);
  });

  test("quotes tags that need it", () => {
    const result = completeAt("```itinerary-event\ntag: |\n```", {
      noteTags: () => ["2021"],
    });
    expect(result?.suggestions[0].text).toBe('"2021"');
  });

  test("leaves values of other fields alone", () => {
    expect(completeAt("```itinerary-event\ntitle: |\n```")).toBeNull();
    expect(completeAt("```itinerary\nsource: [[|\n```")).toBeNull();
  });
});

describe("field lists", () => {
  test("have unique names", () => {
    for (const fields of [EventFields, ItineraryFields]) {
      const names = fields.map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
