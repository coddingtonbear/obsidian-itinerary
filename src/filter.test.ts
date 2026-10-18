import { compileFilter } from "./filter";
import { EventSpec } from "./types";

function event(fields: Partial<EventSpec>): EventSpec {
  return {
    title: "Event",
    backgroundColor: "blue",
    borderColor: "blue",
    textColor: "white",
    ...fields,
  };
}

describe("compileFilter", () => {
  test("matches on a truthy property", () => {
    const filter = compileFilter("allDay");
    expect(filter(event({ allDay: true }))).toBe(true);
    expect(filter(event({ allDay: false }))).toBe(false);
  });

  test("does not match an event missing the property", () => {
    expect(compileFilter("allDay")(event({}))).toBe(false);
  });

  test("matches a tag in a list of tags", () => {
    const filter = compileFilter('"hotel" in tag');
    expect(filter(event({ tag: ["hotel", "booked"] }))).toBe(true);
    expect(filter(event({ tag: ["flight"] }))).toBe(false);
  });

  test("matches a tag given as a single string", () => {
    expect(compileFilter('"hotel" in tag')(event({ tag: "hotel" }))).toBe(
      true
    );
  });

  test("supports negated membership", () => {
    const filter = compileFilter('"hotel" not in tag');
    expect(filter(event({ tag: ["flight"] }))).toBe(true);
    expect(filter(event({ tag: ["hotel"] }))).toBe(false);
  });

  test("matches an event without tags on a negated tag filter", () => {
    expect(compileFilter('"hotel" not in tag')(event({}))).toBe(true);
  });

  test("treats a missing property as empty", () => {
    expect(compileFilter("not allDay")(event({}))).toBe(true);
  });

  test("does not match an event without tags on a tag filter", () => {
    expect(compileFilter('"hotel" in tag')(event({}))).toBe(false);
  });

  test("compares string properties", () => {
    const filter = compileFilter('color == "red"');
    expect(filter(event({ color: "red" }))).toBe(true);
    expect(filter(event({ color: "blue" }))).toBe(false);
  });

  test("treats a runtime error as not matching", () => {
    expect(compileFilter("nonexistentFunction(title)")(event({}))).toBe(false);
  });

  test("throws on a syntax error", () => {
    expect(() => compileFilter("(((")).toThrow();
  });
});
