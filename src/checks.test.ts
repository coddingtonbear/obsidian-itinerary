import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  FullCalendarEventFields,
  editDistance,
  readEventBlock,
  suggestField,
} from "./checks";

const Refiners = [
  "EVENT_UI_REFINERS",
  "EVENT_NON_DATE_REFINERS",
  "EVENT_DATE_REFINERS",
  "EVENT_REFINERS",
  "SIMPLE_RECURRING_REFINERS",
];

/** The event fields FullCalendar reads, from the refiner objects in its
 * (bundled) source. Spreads of other refiners (`...EVENT_UI_REFINERS`)
 * aren't fields, and are skipped. */
function fullCalendarEventFields(): string[] {
  const require = createRequire(import.meta.url);
  const chunks = join(dirname(require.resolve("fullcalendar")), "chunks");
  const sources = readdirSync(chunks)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(join(chunks, name), "utf8"));
  const fields = new Set<string>();
  for (const refiner of Refiners) {
    const pattern = new RegExp(`const ${refiner} = \\{([^}]*)\\};`);
    const body = sources
      .map((source) => pattern.exec(source)?.[1])
      .find((match) => match !== undefined);
    if (body === undefined) {
      throw new Error(`FullCalendar's ${refiner} was not found; check checks.ts`);
    }
    for (const [, field] of body.matchAll(/^\s*(\w+):/gm)) {
      fields.add(field);
    }
  }
  return [...fields].sort();
}

describe("FullCalendarEventFields", () => {
  test("matches the fields FullCalendar reads", () => {
    expect([...FullCalendarEventFields].sort()).toEqual(
      fullCalendarEventFields()
    );
  });
});

function problems(source: string): { errors: string[]; warnings: string[] } {
  const { errors, warnings } = readEventBlock(source);
  return { errors, warnings };
}

describe("readEventBlock", () => {
  test("finds nothing wrong with a well-formed event", () => {
    expect(
      problems(
        [
          "title: Flight",
          "start: 2022-08-07T10:30",
          "startTimeZone: America/Los_Angeles",
          "end: 2022-08-07T20:49",
          "endTimeZone: America/Montreal",
          "tag: flight",
          "seat: 12A",
        ].join("\n")
      )
    ).toEqual({ errors: [], warnings: [] });
  });

  test("returns the event parseEventSpec would", () => {
    expect(readEventBlock("title: Parade\nstart: 2021-11-01").event).toEqual({
      title: "Parade",
      start: "2021-11-01",
      allDay: true,
    });
  });

  test("passes on parse errors", () => {
    expect(() => readEventBlock("- a\n- b")).toThrow(/key: value/);
  });

  describe("errors", () => {
    test("on a missing start", () => {
      expect(problems("title: Parade").errors).toEqual([
        "No start, so this event can't appear on any calendar.",
      ]);
    });

    test.each([
      ["date", "date: 2021-11-01"],
      ["daysOfWeek", "daysOfWeek: [1, 3]"],
      ["startTime", "startTime: '10:00'"],
      ["startRecur", "startRecur: 2021-11-01"],
    ])("not on a missing start when %s is set", (_, field) => {
      expect(problems(`title: Class\n${field}`).errors).toEqual([]);
    });

    test.each([["next tuesday"], ["2021/11/01"], ["Nov 1, 2021"]])(
      "on a start FullCalendar can't read: %j",
      (start) => {
        expect(problems(`title: Parade\nstart: "${start}"`).errors).toEqual([
          `Can't read start "${start}" as a date, so this event can't appear on any calendar.`,
        ]);
      }
    );

    test("on a date FullCalendar can't read", () => {
      expect(problems("title: Parade\ndate: next tuesday").errors).toEqual([
        `Can't read date "next tuesday" as a date, so this event can't appear on any calendar.`,
      ]);
    });

    test("on a missing start when a recurrence field is empty", () => {
      // FullCalendar only treats an event as recurring if one has a value.
      expect(problems("title: Class\nstartRecur: ''").errors).toEqual([
        "No start, so this event can't appear on any calendar.",
      ]);
    });

    test("not on the start of a recurring event, which FullCalendar ignores", () => {
      expect(
        problems("title: Class\ndaysOfWeek: [1]\nstartTime: '10:00'\nstart: '10:00'")
          .errors
      ).toEqual([]);
    });

    test.each([
      ["a year", "'2021'"],
      ["a year and month", "2021-11"],
      ["a compact date", "'20211101'"],
      ["a time with an offset", '"2021-11-01T12:00+01:00"'],
      ["milliseconds since 1970", "1635782400000"],
      ["an impossible date FullCalendar rolls over", "2021-02-30"],
      ["an hour without minutes", '"2021-11-01T12"'],
    ])("not on %s", (_, start) => {
      expect(problems(`title: Parade\nstart: ${start}`).errors).toEqual([]);
    });

    test("are reported with warnings", () => {
      expect(problems("titel: Parade")).toEqual({
        errors: ["No start, so this event can't appear on any calendar."],
        warnings: [
          'Unknown field "titel": did you mean "title"?',
          'No title, so this event is shown as "Untitled event".',
        ],
      });
    });
  });

  describe("warnings", () => {
    const start = "start: 2021-11-01T10:00";

    test.each([
      ["tags", "tag"],
      ["colour", "color"],
      ["timezone", "timeZone"],
      ["Start_Time_Zone", "startTimeZone"],
      ["tz", "timeZone"],
      ["hiden", "hidden"],
      ["backgroundColour", "backgroundColor"],
      ["al-day", "allDay"],
      ["Title", "title"],
    ])("on %j, a likely %j", (field, known) => {
      expect(
        problems(`title: Parade\n${start}\n${field}: x`).warnings
      ).toEqual([`Unknown field "${field}": did you mean "${known}"?`]);
    });

    test.each([
      ["seat"],
      ["cost"],
      ["notes"],
      ["is"],
      ["place"],
      ["time"],
      ["gate"],
      ["rate"],
      ["stars"],
      ["tax"],
      ["group"],
    ])(
      "not on a custom field like %j",
      (field) => {
        expect(
          problems(`title: Parade\n${start}\n${field}: x`).warnings
        ).toEqual([]);
      }
    );

    test.each([["title: ''"], ["title:"], [""]])(
      "on a missing title: %j",
      (title) => {
        expect(problems(`${title}\n${start}`).warnings).toEqual([
          'No title, so this event is shown as "Untitled event".',
        ]);
      }
    );

    test.each([
      ["wall-clock times", "2021-11-01T10:00", "2021-11-01T09:00"],
      ["dates", "2021-11-03", "2021-11-01"],
      ["times with offsets", "2021-11-01T10:00Z", "2021-11-01T10:30+01:00"],
      ["the same time", "2021-11-01T10:00", "2021-11-01T10:00"],
    ])("on an end before its start, for %s", (_, from, to) => {
      const { event, warnings } = readEventBlock(
        `title: Parade\nstart: "${from}"\nend: "${to}"`
      );
      const relation = event.allDay ? "is before" : "isn't after";
      expect(warnings).toEqual([
        `end (${event.end}) ${relation} start (${event.start}), so calendars ignore the end.`,
      ]);
    });

    test("not on an all-day end on the start's own day", () => {
      // Dropping it leaves the same one-day event.
      expect(
        problems("title: Fair\nstart: 2021-11-01\nend: 2021-11-01").warnings
      ).toEqual([]);
    });

    test("not on the times of a recurring event, which FullCalendar ignores", () => {
      expect(
        problems(
          "title: Class\ndaysOfWeek: [1]\nstart: 2021-11-01T10:00\nend: 2021-11-01T09:00\nstartTimeZone: Europe/Paris"
        ).warnings
      ).toEqual([]);
    });

    test.each([
      ["start", "2021"],
      ["start", "202111"],
      ["date", "20211101"],
    ])("on an unquoted %s of %s", (field, value) => {
      expect(problems(`title: Trip\n${field}: ${value}`).warnings).toContain(
        `${field} ${value} is read as milliseconds since 1970; to mean a date, quote it: '${value}'.`
      );
    });

    test.each([["start"], ["end"]])(
      "on an unquoted compact date in %s",
      (field) => {
        const times: Record<string, string> = {
          start: "start: 2021-11-01",
          end: "end: 2021-11-05",
        };
        times[field] = `${field}: 20211101`;
        expect(
          problems(`title: Trip\n${times.start}\n${times.end}`).warnings
        ).toContain(
          `${field} 20211101 is read as milliseconds since 1970; to mean a date, quote it: '20211101'.`
        );
      }
    );

    test("compares times in the zones they're written in", () => {
      // Arrives in Montreal three hours "earlier" by the clock, but later.
      expect(
        problems(
          [
            "title: Flight",
            "start: 2022-08-07T10:30",
            "startTimeZone: America/Montreal",
            "end: 2022-08-07T09:30",
            "endTimeZone: America/Los_Angeles",
          ].join("\n")
        ).warnings
      ).toEqual([]);
    });

    test.each([
      ["one with an offset and one without", "2021-11-01T10:00Z", "2021-11-01T09:00"],
    ])("not on an end at %s", (_, from, to) => {
      expect(
        problems(`title: Parade\nstart: "${from}"\nend: "${to}"`).warnings
      ).toEqual([]);
    });

    test.each([
      [
        "startTimeZone: America/Los_Angeles",
        "Only startTimeZone is set, so end is read in the itinerary's time zone.",
      ],
      [
        "endTimeZone: America/Montreal\ntimeZone: Europe/London",
        "Only endTimeZone is set, so start is read in timeZone (Europe/London).",
      ],
    ])("on only one of the start and end zones: %j", (zones, warning) => {
      expect(
        problems(
          `title: Flight\nstart: 2022-08-07T10:30\nend: 2022-08-07T20:49\n${zones}`
        ).warnings
      ).toEqual([warning]);
    });

    test("not on a start zone when the end names its own offset", () => {
      expect(
        problems(
          'title: Flight\nstart: 2022-08-07T10:30\nstartTimeZone: America/Los_Angeles\nend: "2022-08-08T00:49Z"'
        ).warnings
      ).toEqual([]);
    });

    test("not on a start zone for an event without an end", () => {
      expect(
        problems(
          "title: Flight\nstart: 2022-08-07T10:30\nstartTimeZone: America/Los_Angeles"
        ).warnings
      ).toEqual([]);
    });

    test("not on a zone for an all-day event, which ignores it", () => {
      expect(
        problems(
          "title: Trip\nstart: 2022-08-07\nend: 2022-08-09\nstartTimeZone: America/Los_Angeles"
        ).warnings
      ).toEqual([]);
    });
  });
});

describe("suggestField", () => {
  test("leaves fields resembling nothing alone", () => {
    expect(suggestField("confirmation")).toBeUndefined();
  });

  test("picks the closest field", () => {
    expect(suggestField("endTim")).toBe("endTime");
  });
});

describe("editDistance", () => {
  test.each([
    ["title", "title", 0],
    ["titel", "title", 1],
    ["tile", "title", 1],
    ["colour", "color", 1],
    ["", "abc", 3],
    ["kitten", "sitting", 3],
  ])("from %j to %j is %i", (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});
