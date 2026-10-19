import { describe, test, expect } from "vitest";

import { getEventInformation, parseEventSpec } from "./extractor";

describe("parseEventSpec", () => {
  test("applies a default title", () => {
    const evt = parseEventSpec("start: 2021-11-01T12:00");
    expect(evt.title).toBe("Untitled event");
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
    expect(new Date(evt.start as string).toISOString()).toBe(
      "2021-12-31T23:00:00.000Z"
    );
    expect(new Date(evt.end as string).toISOString()).toBe(
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
    expect(new Date(evt.start as string).toISOString()).toBe(
      "2022-08-07T17:30:00.000Z"
    );
    expect(new Date(evt.end as string).toISOString()).toBe(
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

  test("keeps the instant of a time that names its offset", () => {
    const evt = parseEventSpec(
      "start: 2021-12-31T23:00:00Z\ntimeZone: America/New_York"
    );
    expect(evt.start).toBe("2021-12-31T18:00:00-05:00");
  });

  test.each([
    ["a space separator", "2021-12-31 23:00-00:00"],
    ["a lowercase separator", "2021-12-31t23:00Z"],
    ["a bracketed zone", "2021-12-31T18:00:00-05:00[America/New_York]"],
    ["an offset with seconds", "2022-01-01T04:30:00+05:30:00"],
  ])("keeps the instant of a time with %s", (_, start) => {
    const evt = parseEventSpec(`start: "${start}"\ntimeZone: America/Chicago`);
    expect(new Date(evt.start as string).toISOString()).toBe(
      "2021-12-31T23:00:00.000Z"
    );
  });

  test.each([
    ["2021-11-01T00:30+01:00"],
    ["2021-11-01T00:30:00Z"],
    ["2021-11-01 00:30+01:00"],
  ])("leaves %s as written when no zone is set", (start) => {
    // Filters compare times as text: `start >= "2021-11-01"`.
    expect(parseEventSpec(`start: "${start}"`).start).toBe(start);
  });

  test.each([
    ["a lowercase separator", "2021-11-01t11:00z", "2021-11-01T11:00Z"],
    ["an offset with seconds", "2021-11-01T00:30+01:00:00", "2021-11-01T00:30+01:00"],
    ["a lowercase separator and offset", "2021-11-01t00:30+01:00", "2021-11-01T00:30+01:00"],
    ["a decimal comma", "2021-11-01T00:30:00,5Z", "2021-11-01T00:30:00.5Z"],
    ["an hour and no minutes", "2021-11-01T12", "2021-11-01T12:00:00"],
  ])("rewrites a time with %s for FullCalendar when no zone is set", (_, start, expected) => {
    expect(parseEventSpec(`start: "${start}"`).start).toBe(expected);
  });

  test("keeps the local date of a bracketed time when no zone is set", () => {
    const evt = parseEventSpec('start: "2021-11-01T00:30+01:00[Europe/Paris]"');
    expect(evt.start).toBe("2021-11-01T00:30:00+01:00");
  });

  test.each([
    ["a bracketed time near midnight", "2021-11-01T00:30[Europe/Paris]"],
    ["an offset time", "2021-11-01T00:30+01:00"],
    ["a UTC time", "2021-11-01T23:30Z"],
    ["a wall-clock time", "2021-11-01T10:00"],
    ["a date", "2021-11-01"],
  ])("gives an all-day event the date of %s as written", (_, time) => {
    const evt = parseEventSpec(
      `allDay: true\nstart: "${time}"\nend: "${time}"`
    );
    expect(evt.start).toBe("2021-11-01");
    expect(evt.end).toBe("2021-11-01");
  });

  test.each([[""], ["\ntimeZone: America/New_York"]])(
    "rejects an unknown bracketed zone%s",
    (zone) => {
      expect(() =>
        parseEventSpec(`start: "2021-11-01T12:00[Europe/Pari]"${zone}`)
      ).toThrow(/unknown time zone/);
    }
  );

  test("reads a zone-annotated date as the date", () => {
    const evt = parseEventSpec('start: "2021-11-01[Europe/Paris]"');
    expect(evt.start).toBe("2021-11-01");
  });

  test("zones dates when allDay is false", () => {
    const evt = parseEventSpec(
      "start: 2021-11-01\nallDay: false\ntimeZone: Asia/Tokyo"
    );
    expect(evt.start).toBe("2021-11-01T00:00:00+09:00");
  });

  test("leaves a plain wall-clock time alone when no zone is set", () => {
    expect(parseEventSpec("start: 2021-11-01T12:00").start).toBe(
      "2021-11-01T12:00"
    );
  });

  test("keeps the zone a time names in brackets without an offset", () => {
    const evt = parseEventSpec(
      'start: "2021-11-01T12:00[Europe/Paris]"\ntimeZone: America/New_York'
    );
    expect(new Date(evt.start as string).toISOString()).toBe(
      "2021-11-01T11:00:00.000Z"
    );
  });

  test("zones a date-only start when the end has a time", () => {
    // The event is timed, so its start is midnight in the event's zone.
    const evt = parseEventSpec(
      "start: 2021-11-01\nend: 2021-11-03T10:00\ntimeZone: America/New_York"
    );
    expect(evt.start).toBe("2021-11-01T00:00:00-04:00");
    expect(evt.end).toBe("2021-11-03T10:00:00-04:00");
  });

  test("leaves date-only times as dates, even with a timeZone", () => {
    // FullCalendar infers an all-day event from date-only times; giving
    // them a zone would turn them into events at midnight.
    const evt = parseEventSpec(
      "start: 2021-12-31\nend: 2022-01-02\ntimeZone: America/New_York"
    );
    expect(evt.start).toBe("2021-12-31");
    expect(evt.end).toBe("2022-01-02");
  });

  test("does not default colors the block doesn't set", () => {
    // Defaults would override the itinerary's eventColor and the theme.
    const evt = parseEventSpec("title: Plain");
    expect(evt).not.toHaveProperty("backgroundColor");
    expect(evt).not.toHaveProperty("borderColor");
    expect(evt).not.toHaveProperty("textColor");
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
