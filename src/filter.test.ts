import { describe, test, expect } from "vitest";
import { compileFilter as compileWithErrors } from "./filter";
import { EventSpec } from "./types";

function compileFilter(expression: string) {
  const filter = compileWithErrors(expression);
  return (evt: EventSpec): boolean => filter(evt).matched;
}

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

  test("treats a runtime error as not matching, and says why", () => {
    expect(compileWithErrors("nonexistentFunction(title)")(event({}))).toEqual({
      matched: false,
      error: expect.stringMatching(/nonexistentFunction/) as unknown,
    });
  });

  test("compares ISO dates as text", () => {
    const filter = compileFilter(
      'start >= "2021-11-01" and start < "2021-11-02"'
    );
    expect(filter(event({ start: "2021-11-01T12:00" }))).toBe(true);
    expect(filter(event({ start: "2021-11-02T12:00" }))).toBe(false);
  });

  test("still compares numbers", () => {
    expect(compileFilter("priority > 2")(event({ priority: 3 }))).toBe(true);
    expect(compileFilter("priority > 2")(event({ priority: 1 }))).toBe(false);
  });

  test("does not compare text with a number", () => {
    expect(compileFilter("title > 2")(event({ title: "x" }))).toBe(false);
  });

  test("matches a single tag by equality", () => {
    const filter = compileFilter('tag == "hotel"');
    expect(filter(event({ tag: "hotel" }))).toBe(true);
    expect(filter(event({ tag: ["hotel"] }))).toBe(true);
    expect(filter(event({ tag: ["hotel", "booked"] }))).toBe(false);
    expect(compileFilter('tag != "hotel"')(event({ tag: "hotel" }))).toBe(
      false
    );
  });

  test("throws on a syntax error", () => {
    expect(() => compileFilter("(((")).toThrow();
  });
});
