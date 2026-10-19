import { describe, test, expect } from "vitest";
import { DefaultEventOrder } from "./order";
import { getCalendarOptions, normalizeSources, parseItinerarySpec } from "./spec";

describe("normalizeSources", () => {
  test("returns nothing when unset", () => {
    expect(normalizeSources(undefined)).toEqual([]);
    expect(normalizeSources(null)).toEqual([]);
  });

  test("wraps a single source", () => {
    expect(normalizeSources("[[Trip]]")).toEqual(["[[Trip]]"]);
  });

  test("keeps a list of sources", () => {
    expect(normalizeSources(["[[Trip]]", "notes/other.md"])).toEqual([
      "[[Trip]]",
      "notes/other.md",
    ]);
  });

  test("reads an unquoted [[link]] back as a link", () => {
    expect(normalizeSources([["Trip"]])).toEqual(["[[Trip]]"]);
  });

  test("reads a block list of unquoted links", () => {
    expect(normalizeSources([[["A"]], [["B"]]])).toEqual(["[[A]]", "[[B]]"]);
  });

  test("rejects other shapes", () => {
    expect(() => normalizeSources({ a: 1 })).toThrow(/source/);
    expect(() => normalizeSources([5])).toThrow(/source/);
  });
});

describe("parseItinerarySpec", () => {
  test("accepts an empty block", () => {
    expect(parseItinerarySpec("")).toEqual({
      source: [],
      filter: [],
      debug: false,
    });
  });

  test("reads plugin options and passes others through", () => {
    const spec = parseItinerarySpec(
      [
        'source: "[[Trip]]"',
        "filter: allDay",
        "debug: true",
        "initialDate: 2021-11-01",
        "initialView: listDay",
      ].join("\n")
    );
    expect(spec).toEqual({
      source: ["[[Trip]]"],
      filter: ["allDay"],
      debug: true,
      initialDate: "2021-11-01",
      initialView: "listDay",
    });
  });

  test("reads an unquoted link source", () => {
    expect(parseItinerarySpec("source: [[Trip]]").source).toEqual(["[[Trip]]"]);
  });

  test("rejects invalid YAML", () => {
    expect(() => parseItinerarySpec("source: [unclosed")).toThrow(
      /Could not parse itinerary spec/
    );
  });

  test("rejects a block that isn't a mapping", () => {
    expect(() => parseItinerarySpec("- a\n- b")).toThrow(
      /Could not parse itinerary spec/
    );
  });

  test("rejects a non-text filter", () => {
    expect(() => parseItinerarySpec("filter:\n  a: 1")).toThrow(/filter/);
  });

  test("accepts quoted true and yes for debug", () => {
    expect(parseItinerarySpec('debug: "yes"').debug).toBe(true);
    expect(parseItinerarySpec('debug: "true"').debug).toBe(true);
  });

  test("rejects a non-boolean debug", () => {
    expect(() => parseItinerarySpec("debug: often")).toThrow(/debug/);
  });
});

describe("getCalendarOptions", () => {
  test("drops options FullCalendar doesn't know", () => {
    const { options } = getCalendarOptions({
      source: ["[[Trip]]"],
      filter: ["allDay"],
      debug: true,
      initialView: "listDay",
    });
    expect(options).not.toHaveProperty("source");
    expect(options).not.toHaveProperty("filter");
    expect(options).not.toHaveProperty("debug");
    expect(options.initialView).toBe("listDay");
  });

  test("orders events by order, strictly, by default", () => {
    const { options } = getCalendarOptions({});
    expect(options.eventOrder).toBe(DefaultEventOrder);
    expect(options.eventOrderStrict).toBe(true);
  });

  test("keeps an itinerary's own eventOrder and eventOrderStrict", () => {
    const { options } = getCalendarOptions({
      eventOrder: "start,color",
      eventOrderStrict: false,
    });
    expect(options.eventOrder).toBe("start,color");
    expect(options.eventOrderStrict).toBe(false);
  });
});
