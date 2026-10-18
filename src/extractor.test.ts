import { describe, test, expect } from "vitest";
import { DateTime } from "luxon";

import { getEventInformation, parseEventSpec } from "./extractor";

describe("parseEventSpec", () => {
  test("applies default colors and title", () => {
    const evt = parseEventSpec("start: 2021-11-01T12:00");
    expect(evt.title).toBe("Untitled event");
    expect(evt.backgroundColor).toBe("blue");
    expect(evt.borderColor).toBe("blue");
    expect(evt.textColor).toBe("white");
  });

  test("uses color for background and border", () => {
    const evt = parseEventSpec("title: Parade\ncolor: red");
    expect(evt.backgroundColor).toBe("red");
    expect(evt.borderColor).toBe("red");
  });

  test("prefers explicit background, border and text colors", () => {
    const evt = parseEventSpec(
      "color: red\nbackgroundColor: green\nborderColor: black\ntextColor: yellow"
    );
    expect(evt.backgroundColor).toBe("green");
    expect(evt.borderColor).toBe("black");
    expect(evt.textColor).toBe("yellow");
  });

  test("leaves times without a zone untouched", () => {
    const evt = parseEventSpec("start: 2021-11-01T12:00\nend: 2021-11-01T13:00");
    expect(evt.start).toBe("2021-11-01T12:00");
    expect(evt.end).toBe("2021-11-01T13:00");
  });

  test("interprets times in timeZone", () => {
    const evt = parseEventSpec(
      "start: 2021-12-31T18:00\nend: 2022-01-01T04:00\ntimeZone: America/New_York"
    );
    expect(DateTime.fromISO(evt.start as string).toUTC().toISO()).toBe(
      "2021-12-31T23:00:00.000Z"
    );
    expect(DateTime.fromISO(evt.end as string).toUTC().toISO()).toBe(
      "2022-01-01T09:00:00.000Z"
    );
  });

  test("prefers startTimeZone and endTimeZone over timeZone", () => {
    const evt = parseEventSpec(
      [
        "start: 2022-08-07T10:30",
        "startTimeZone: America/Los_Angeles",
        "end: 2022-08-07T20:49",
        "endTimeZone: America/Montreal",
        "timeZone: Europe/London",
      ].join("\n")
    );
    expect(DateTime.fromISO(evt.start as string).toUTC().toISO()).toBe(
      "2022-08-07T17:30:00.000Z"
    );
    expect(DateTime.fromISO(evt.end as string).toUTC().toISO()).toBe(
      "2022-08-08T00:49:00.000Z"
    );
  });

  test("does not apply zones to all-day events", () => {
    const evt = parseEventSpec(
      "allDay: true\nstart: 2021-10-31\nend: 2021-11-04\ntimeZone: Asia/Tokyo"
    );
    expect(evt.start).toBe("2021-10-31");
    expect(evt.end).toBe("2021-11-04");
  });
});

describe("getEventInformation", () => {
  test("finds every itinerary-event block in a document", () => {
    const doc = [
      "# Trip",
      "",
      "```itinerary",
      "initialDate: 2021-11-01",
      "```",
      "",
      "```itinerary-event",
      "title: First",
      "start: 2021-11-01T12:00",
      "```",
      "",
      "Some text",
      "",
      "```itinerary-event",
      "title: Second",
      "start: 2021-11-02T12:00",
      "```",
    ].join("\n");

    expect(getEventInformation(doc).map((e) => e.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  test("returns nothing for a document without events", () => {
    expect(getEventInformation("# Nothing here")).toEqual([]);
  });

  test("skips blocks that fail to parse", () => {
    const doc = [
      "```itinerary-event",
      "title: [unclosed",
      "```",
      "```itinerary-event",
      "title: Good",
      "```",
    ].join("\n");

    expect(getEventInformation(doc).map((e) => e.title)).toEqual(["Good"]);
  });
});

describe("parseEventSpec validation", () => {
  test("rejects a block that isn't a mapping", () => {
    expect(() => parseEventSpec("- a\n- b")).toThrow(/key: value/);
  });

  test("accepts an empty block", () => {
    expect(parseEventSpec("").title).toBe("Untitled event");
  });

  test("rejects an unknown time zone", () => {
    expect(() =>
      parseEventSpec("start: 2021-11-01T12:00\ntimeZone: Mars/Olympus_Mons")
    ).toThrow(/time zone "Mars\/Olympus_Mons"/);
  });

  test("rejects a non-boolean hidden", () => {
    expect(() => parseEventSpec("hidden: sometimes")).toThrow(/hidden/);
  });

  test("accepts quoted true and false", () => {
    expect(parseEventSpec('hidden: "true"').hidden).toBe(true);
    expect(parseEventSpec('allDay: "False"').allDay).toBe(false);
  });

  test("leaves out options the block doesn't set", () => {
    // FullCalendar reads a present-but-undefined `allDay` as false, which
    // stops it inferring all-day events from date-only times.
    const evt = parseEventSpec("start: 2021-10-31\nend: 2021-11-04");
    expect(Object.keys(evt)).not.toContain("allDay");
    expect(Object.values(evt)).not.toContain(undefined);
  });

  test("reads numeric titles and tags as text", () => {
    const evt = parseEventSpec("title: 1984\ntag:\n- 2021\n- trip");
    expect(evt.title).toBe("1984");
    expect(evt.tag).toEqual(["2021", "trip"]);
  });

  test("rejects a tag that isn't text", () => {
    expect(() => parseEventSpec("tag:\n- a: 1")).toThrow(/tag/);
  });
});

describe("getEventInformation formatting", () => {
  test("handles Windows line endings", () => {
    const doc = "```itinerary-event\r\ntitle: CRLF\r\n```\r\n";
    expect(getEventInformation(doc).map((e) => e.title)).toEqual(["CRLF"]);
  });

  test("allows backticks inside a block", () => {
    const doc = "```itinerary-event\ntitle: Uses `code`\n```";
    expect(getEventInformation(doc).map((e) => e.title)).toEqual([
      "Uses `code`",
    ]);
  });

  test("does not run an empty block into the next one", () => {
    const doc = "```itinerary-event\n```\n\n```itinerary-event\ntitle: Next\n```";
    expect(getEventInformation(doc).map((e) => e.title)).toEqual([
      "Untitled event",
      "Next",
    ]);
  });

  test("finds indented blocks, such as those in a list", () => {
    const doc = "- Day 1\n  ```itinerary-event\n  title: Indented\n  ```";
    expect(getEventInformation(doc).map((e) => e.title)).toEqual(["Indented"]);
  });
});
