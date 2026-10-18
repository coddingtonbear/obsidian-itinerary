import { DateTime } from "luxon";

import { getEventInformation, parseEventSpec } from "./extractor";

describe("parseEventSpec", () => {
  test("applies default colors and title", () => {
    const evt = parseEventSpec("start: 2021-11-01T12:00");
    expect(evt.title).toBe("Untitled Event");
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
