import { describe, test, expect } from "vitest";
import { Temporal } from "temporal-polyfill";

import {
  readEventForEdit,
  replaceEventBlock,
  serializeEditedEvent,
} from "./eventEdit";
import { tagFieldText, tagsFromField, validateEventForm } from "./eventForm";
import { parseEventSpec, readInstant } from "./extractor";
import { EventSpec } from "./types";

/** The instant an extracted time means, read in `zone` when it names
 * none (as the calendar would show it). */
function moment(time: string | undefined, zone = "UTC"): string | undefined {
  if (time === undefined) {
    return undefined;
  }
  const instant = readInstant(time);
  if (instant) {
    return instant.toString();
  }
  try {
    return Temporal.PlainDateTime.from(time).toZonedDateTime(zone).toInstant().toString();
  } catch {
    return time;
  }
}

/** What the calendar would show for an event: its times as instants
 * (dates for an all-day event) and every other field. */
function shown(event: EventSpec): Record<string, unknown> {
  const { start, end, timeZone, startTimeZone, endTimeZone, ...rest } = event;
  void timeZone;
  void startTimeZone;
  void endTimeZone;
  if (event.allDay) {
    return { ...rest, start, end };
  }
  return { ...rest, start: moment(start), end: moment(end) };
}

/** Reading a block for the form and saving it unchanged. */
function saveUnchanged(source: string): string {
  return serializeEditedEvent(readEventForEdit(source));
}

describe("readEventForEdit", () => {
  test("reads a block the form wrote back into the same values", () => {
    const edit = readEventForEdit(
      [
        "title: Flight",
        "start: 2021-11-10T12:31",
        "end: 2021-11-10T13:49",
        "startTimeZone: America/Mexico_City",
        "endTimeZone: America/Cancun",
        "color: red",
        "tag:",
        "- flight",
        "- travel",
      ].join("\n")
    );
    expect(edit.values).toEqual({
      title: "Flight",
      allDay: false,
      start: "2021-11-10T12:31",
      end: "2021-11-10T13:49",
      startTimeZone: "America/Mexico_City",
      endTimeZone: "America/Cancun",
      endTimeZoneFollows: false,
      tags: ["flight", "travel"],
      color: "red",
    });
    expect(edit.kept).toEqual({});
  });

  test("uses timeZone for both ends, and an end's zone follows the start's", () => {
    const { values } = readEventForEdit(
      "title: Dinner\nstart: 2021-11-01T19:00\nend: 2021-11-01T21:00\ntimeZone: Europe/Paris"
    );
    expect(values.startTimeZone).toBe("Europe/Paris");
    expect(values.endTimeZone).toBe("Europe/Paris");
    expect(values.endTimeZoneFollows).toBe(true);
  });

  test("leaves the zones empty for an event without one", () => {
    const { values } = readEventForEdit("title: Call\nstart: 2021-11-01T09:00");
    expect(values.startTimeZone).toBe("");
    expect(values.endTimeZone).toBe("");
    expect(values.end).toBe("");
  });

  test("shows an all-day event's exclusive end as its last day", () => {
    const { values } = readEventForEdit(
      "title: Hotel\nstart: 2021-10-31\nend: 2021-11-04"
    );
    expect(values.allDay).toBe(true);
    expect(values.start).toBe("2021-10-31");
    expect(values.end).toBe("2021-11-03");
  });

  test("keeps a zero-length all-day event to its one day", () => {
    const { values } = readEventForEdit(
      "title: Holiday\nstart: 2021-11-01\nend: 2021-11-01"
    );
    expect(values.end).toBe("2021-11-01");
  });

  test("writes compact dates out in full", () => {
    const { values } = readEventForEdit('title: Day\nstart: "20211101"');
    expect(values.start).toBe("2021-11-01");
  });

  test("keeps saying allDay: false when the block did", () => {
    const edit = readEventForEdit("title: Late\nallDay: false\nstart: 2021-11-01");
    expect(serializeEditedEvent(edit)).toBe(
      "title: Late\nallDay: false\nstart: 2021-11-01T00:00"
    );
    expect(
      serializeEditedEvent({ ...edit, values: { ...edit.values, allDay: true } })
    ).toBe("title: Late\nallDay: true\nstart: 2021-11-01T00:00");
  });

  test("shows a date in a timed event as midnight", () => {
    const { values } = readEventForEdit(
      "title: Late\nallDay: false\nstart: 2021-11-01"
    );
    expect(values.allDay).toBe(false);
    expect(values.start).toBe("2021-11-01T00:00");
  });

  test("shows a time written with an offset in the event's zone", () => {
    const { values } = readEventForEdit(
      "title: Call\nstart: 2021-11-01T12:00Z\ntimeZone: America/New_York"
    );
    expect(values.start).toBe("2021-11-01T08:00");
    expect(values.startTimeZone).toBe("America/New_York");
  });

  test("takes the zone from a time written with one when the event has none", () => {
    expect(readEventForEdit("title: A\nstart: 2021-11-01T12:00Z").values).toMatchObject({
      start: "2021-11-01T12:00",
      startTimeZone: "UTC",
    });
    expect(
      readEventForEdit("title: A\nstart: 2021-11-01T12:00+05:30").values
    ).toMatchObject({ start: "2021-11-01T12:00", startTimeZone: "+05:30" });
    expect(
      readEventForEdit("title: A\nstart: 2021-11-01T12:00[Europe/Paris]").values
    ).toMatchObject({ start: "2021-11-01T12:00", startTimeZone: "Europe/Paris" });
  });

  test("reads a time given in milliseconds", () => {
    const { values } = readEventForEdit(
      `title: A\nstart: ${Date.UTC(2021, 10, 1, 12, 0)}`
    );
    expect(values).toMatchObject({ start: "2021-11-01T12:00", startTimeZone: "UTC" });
  });

  test("keeps seconds when a time has them", () => {
    const { values } = readEventForEdit("title: A\nstart: 2021-11-01T12:00:30");
    expect(values.start).toBe("2021-11-01T12:00:30");
  });

  test("reads a single tag", () => {
    expect(readEventForEdit("title: A\nstart: 2021-11-01\ntag: hotel").values.tags).toEqual([
      "hotel",
    ]);
  });

  test("keeps the fields the form doesn't show", () => {
    const { kept } = readEventForEdit(
      [
        "title: A",
        "start: 2021-11-01",
        "url: https://example.com",
        "display: background",
        "extendedProps:",
        "  room: 12",
      ].join("\n")
    );
    expect(kept).toEqual({
      url: "https://example.com",
      display: "background",
      extendedProps: { room: 12 },
    });
  });

  test("opens an event without a title with an empty one, for the form to ask for", () => {
    const { values } = readEventForEdit("start: 2021-11-01");
    expect(values.title).toBe("");
  });

  test("throws for a block that isn't a set of fields", () => {
    expect(() => readEventForEdit("- a\n- b")).toThrow(/key: value/);
  });

  test("gives values the form accepts for an ordinary event", () => {
    const { values } = readEventForEdit(
      "title: Parade\nstart: 2021-11-01T12:00\nend: 2021-11-01T14:00\ntimeZone: America/Mexico_City"
    );
    expect(validateEventForm(values)).toEqual([]);
  });
});

describe("saving an event unchanged", () => {
  const blocks = [
    "title: Parade\nstart: 2021-11-01T12:00\nend: 2021-11-01T14:00\ntimeZone: America/Mexico_City",
    "title: Flight\nstart: 2021-11-10T12:31\nend: 2021-11-10T13:49\nstartTimeZone: America/Mexico_City\nendTimeZone: America/Cancun",
    "title: Hotel\nstart: 2021-10-31\nend: 2021-11-04\ncolor: blue\ntag:\n- hotel",
    "title: Holiday\nallDay: true\nstart: 2021-11-01T15:00+05:00",
    "title: Late\nallDay: false\nstart: 2021-11-01",
    "title: Call\nstart: 2021-11-01T12:00Z\nend: 2021-11-01T13:00Z",
    "title: Call\nstart: 2021-11-01T12:00+05:30\ntimeZone: Asia/Tokyo",
    "title: Talk\nstart: 2021-11-01T12:00[Europe/Paris]\nend: 2021-11-01T13:00[Europe/London]",
    `title: Old\nstart: ${Date.UTC(2021, 10, 1, 12, 0)}`,
    "title: Day\nstart: 20211101",
    'title: Day\nstart: "20211101"',
    "title: Odd\nstart: 2021-11-01T09:00\nbackgroundColor: red\ntextColor: white\nurl: https://example.com\ndisplay: block",
    'title: "true"\nstart: 2021-11-01\ntag: ["a, b", c]',
  ];

  test.each(blocks)("describes the same event: %s", (source) => {
    expect(shown(parseEventSpec(saveUnchanged(source)))).toEqual(
      shown(parseEventSpec(source))
    );
  });

  test("writes the kept fields after the form's", () => {
    expect(
      saveUnchanged("url: https://example.com\ntitle: A\nstart: 2021-11-01\ndisplay: block")
    ).toBe("title: A\nallDay: true\nstart: 2021-11-01\nurl: https://example.com\ndisplay: block");
  });

  test("writes the form's changes", () => {
    const edit = readEventForEdit("title: A\nstart: 2021-11-01T09:00\nurl: x");
    const body = serializeEditedEvent({
      ...edit,
      values: { ...edit.values, title: "B", end: "2021-11-01T10:00" },
    });
    expect(body).toBe("title: B\nstart: 2021-11-01T09:00\nend: 2021-11-01T10:00\nurl: x");
  });
});

describe("tag field", () => {
  test("shows tags without commas, and keeps those with them", () => {
    const tags = ["hotel", "a, b", "trip"];
    expect(tagFieldText(tags)).toBe("hotel, trip");
    expect(tagsFromField("hotel, food", tags)).toEqual(["hotel", "food", "a, b"]);
  });
});

describe("replaceEventBlock", () => {
  const body = "title: New\nstart: 2021-11-02";

  test("replaces the block's body and keeps its fences", () => {
    const doc = "# Trip\n\n```itinerary-event\ntitle: Old\nstart: 2021-11-01\n```\n\nAfter";
    expect(
      replaceEventBlock(doc, { lineStart: 2, lineEnd: 5 }, "title: Old\nstart: 2021-11-01\n", body)
    ).toBe("# Trip\n\n```itinerary-event\ntitle: New\nstart: 2021-11-02\n```\n\nAfter");
  });

  test("keeps tilde and longer fences", () => {
    const doc = "~~~~itinerary-event\ntitle: Old\n~~~~";
    expect(
      replaceEventBlock(doc, { lineStart: 0, lineEnd: 2 }, "title: Old", body)
    ).toBe("~~~~itinerary-event\ntitle: New\nstart: 2021-11-02\n~~~~");
  });

  test("keeps a block's indentation in a list, and its quoting", () => {
    const listed = "- Day one\n- ```itinerary-event\n  title: Old\n  ```\n- Day two";
    expect(
      replaceEventBlock(listed, { lineStart: 0, lineEnd: 4 }, "title: Old", body)
    ).toBe("- Day one\n- ```itinerary-event\n  title: New\n  start: 2021-11-02\n  ```\n- Day two");

    const quoted = "> ```itinerary-event\n> title: Old\n> ```";
    expect(
      replaceEventBlock(quoted, { lineStart: 0, lineEnd: 2 }, "title: Old", "a: 1\n\nb: 2")
    ).toBe("> ```itinerary-event\n> a: 1\n>\n> b: 2\n> ```");
  });

  test("keeps Windows line endings", () => {
    const doc = "```itinerary-event\r\ntitle: Old\r\n```\r\n";
    expect(
      replaceEventBlock(doc, { lineStart: 0, lineEnd: 2 }, "title: Old", body)
    ).toBe("```itinerary-event\r\ntitle: New\r\nstart: 2021-11-02\r\n```\r\n");
  });

  test("picks the block with this body among several in the section", () => {
    const doc =
      "```itinerary-event\ntitle: First\n```\n```itinerary-event\ntitle: Old\n```";
    expect(
      replaceEventBlock(doc, { lineStart: 0, lineEnd: 5 }, "title: Old", "title: New")
    ).toBe("```itinerary-event\ntitle: First\n```\n```itinerary-event\ntitle: New\n```");
  });

  test("refuses when the block has changed or moved", () => {
    const doc = "```itinerary-event\ntitle: Changed\n```";
    expect(replaceEventBlock(doc, { lineStart: 0, lineEnd: 2 }, "title: Old", body)).toBeNull();
    const moved = "Inserted\n```itinerary-event\ntitle: Old\n```";
    expect(replaceEventBlock(moved, { lineStart: 0, lineEnd: 2 }, "title: Old", body)).toBeNull();
  });

  test("refuses when two blocks in the section match", () => {
    const doc = "```itinerary-event\ntitle: Old\n```\n```itinerary-event\ntitle: Old\n```";
    expect(replaceEventBlock(doc, { lineStart: 0, lineEnd: 5 }, "title: Old", body)).toBeNull();
  });

  test("refuses an unclosed block, and other kinds of block", () => {
    expect(
      replaceEventBlock("```itinerary-event\ntitle: Old", { lineStart: 0, lineEnd: 1 }, "title: Old", body)
    ).toBeNull();
    expect(
      replaceEventBlock("```itinerary\ntitle: Old\n```", { lineStart: 0, lineEnd: 2 }, "title: Old", body)
    ).toBeNull();
  });
});
