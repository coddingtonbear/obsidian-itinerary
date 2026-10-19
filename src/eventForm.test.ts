import { describe, test, expect } from "vitest";

import {
  EventFormValues,
  completeTag,
  emptyEventForm,
  eventBlock,
  padForInsertion,
  parseTagInput,
  serializeEventForm,
  suggestTags,
  suggestTimeZones,
  switchAllDay,
  tagsInNote,
  toExclusiveEnd,
  validateEventForm,
} from "./eventForm";
import { getEventInformation, parseEventSpec } from "./extractor";

function form(values: Partial<EventFormValues>): EventFormValues {
  return { ...emptyEventForm(), ...values };
}

describe("serializeEventForm", () => {
  test("writes a timed event", () => {
    expect(
      serializeEventForm(
        form({
          title: "Volaris Flight 765",
          start: "2021-11-04T12:31",
          end: "2021-11-04T13:49",
          timeZone: "America/Mexico_City",
          tags: ["flight"],
          color: "green",
        })
      )
    ).toBe(
      [
        "title: Volaris Flight 765",
        "start: 2021-11-04T12:31",
        "end: 2021-11-04T13:49",
        "timeZone: America/Mexico_City",
        "color: green",
        "tag:",
        "- flight",
      ].join("\n")
    );
  });

  test("writes an all-day event's last day as the exclusive end", () => {
    expect(
      serializeEventForm(
        form({
          title: "Oaxaca",
          allDay: true,
          start: "2021-10-31",
          end: "2021-11-03",
          timeZone: "America/Mexico_City",
        })
      )
    ).toBe(
      ["title: Oaxaca", "allDay: true", "start: 2021-10-31", "end: 2021-11-04"].join(
        "\n"
      )
    );
  });

  test("leaves out fields left empty", () => {
    expect(
      serializeEventForm(form({ title: "Parade", start: "2021-11-01T12:00" }))
    ).toBe("title: Parade\nstart: 2021-11-01T12:00");
  });

  test("quotes text YAML would read as something else", () => {
    const tricky = [
      "true",
      "12",
      "null",
      "Drinks: Tom",
      "# hashtag",
      "- dash",
      "[bracketed]",
      "{curly}",
      "quote's",
      '"quoted"',
      "*star",
      "&anchor",
      "a #b",
      "@at",
      "%pct",
      "`tick",
    ];
    for (const title of tricky) {
      const text = serializeEventForm(
        form({ title, start: "2021-11-01", allDay: true, tags: [title] })
      );
      const event = parseEventSpec(text);
      expect(event.title).toBe(title);
      expect(event.tag).toEqual([title]);
    }
  });

  test("trims the title, zone, color and tags, and drops repeated tags", () => {
    expect(
      serializeEventForm(
        form({
          title: "  Hotel ",
          start: "2021-10-31T17:00",
          timeZone: " Europe/Paris ",
          color: " brown ",
          tags: [" hotel", "", "hotel ", "paris"],
        })
      )
    ).toBe(
      [
        "title: Hotel",
        "start: 2021-10-31T17:00",
        "timeZone: Europe/Paris",
        "color: brown",
        "tag:",
        "- hotel",
        "- paris",
      ].join("\n")
    );
  });

  test("reads back as the event the form described", () => {
    const allDay = parseEventSpec(
      serializeEventForm(
        form({
          title: "Mexico City",
          allDay: true,
          start: "2021-11-04",
          end: "2021-11-07",
          color: "red",
        })
      )
    );
    expect(allDay).toMatchObject({
      title: "Mexico City",
      allDay: true,
      start: "2021-11-04",
      end: "2021-11-08",
      backgroundColor: "red",
    });

    const timed = parseEventSpec(
      serializeEventForm(
        form({
          title: "New Years Eve",
          start: "2021-12-31T18:00",
          end: "2022-01-01T04:00",
          timeZone: "America/New_York",
        })
      )
    );
    expect(timed).toMatchObject({
      start: "2021-12-31T18:00:00-05:00",
      end: "2022-01-01T04:00:00-05:00",
      timeZone: "America/New_York",
    });
  });
});

describe("eventBlock", () => {
  test("is found by the extractor", () => {
    const note = `# Trip\n\n${eventBlock(
      form({ title: "Parade", start: "2021-11-01T12:00", tags: ["outing"] })
    )}\n`;
    expect(getEventInformation(note)).toEqual([
      { title: "Parade", start: "2021-11-01T12:00", tag: ["outing"] },
    ]);
  });
});

describe("validateEventForm", () => {
  test("accepts a complete event", () => {
    expect(
      validateEventForm(
        form({
          title: "Parade",
          start: "2021-11-01T12:00",
          end: "2021-11-01T14:00",
          timeZone: "America/Mexico_City",
        })
      )
    ).toEqual([]);
  });

  test("requires a title and a start", () => {
    expect(validateEventForm(form({ title: " " }))).toEqual([
      "Enter a title.",
      "Enter a start date and time.",
    ]);
    expect(validateEventForm(form({ title: "A", allDay: true }))).toEqual([
      "Enter a start date.",
    ]);
  });

  test("rejects times the inputs couldn't have produced", () => {
    expect(
      validateEventForm(form({ title: "A", start: "2021-11-01", end: "soon" }))
    ).toEqual([
      "The start isn't a valid date and time.",
      "The end isn't a valid date and time.",
    ]);
  });

  test("rejects an end before the start", () => {
    expect(
      validateEventForm(
        form({ title: "A", start: "2021-11-01T12:00", end: "2021-11-01T11:00" })
      )
    ).toEqual(["The end is before the start."]);
    expect(
      validateEventForm(
        form({ title: "A", allDay: true, start: "2021-11-02", end: "2021-11-01" })
      )
    ).toEqual(["The last day is before the start."]);
  });

  test("allows a one-day all-day event whose last day is its start", () => {
    expect(
      validateEventForm(
        form({ title: "A", allDay: true, start: "2021-11-01", end: "2021-11-01" })
      )
    ).toEqual([]);
  });

  test("rejects an unknown time zone, unless the event is all-day", () => {
    expect(
      validateEventForm(
        form({ title: "A", start: "2021-11-01T12:00", timeZone: "Mars/Olympus" })
      )
    ).toEqual(['"Mars/Olympus" isn\'t a time zone Obsidian knows.']);
    expect(
      validateEventForm(
        form({
          title: "A",
          allDay: true,
          start: "2021-11-01",
          timeZone: "Mars/Olympus",
        })
      )
    ).toEqual([]);
  });
});

describe("switchAllDay", () => {
  function times(values: EventFormValues): [string, string] {
    return [values.start, values.end];
  }

  test("keeps the dates when switching to all-day", () => {
    expect(
      times(
        switchAllDay(
          form({ start: "2021-11-01T12:30", end: "2021-11-03T09:00" }),
          true
        )
      )
    ).toEqual(["2021-11-01", "2021-11-03"]);
  });

  test("makes an end at midnight the day before, the last day covered", () => {
    expect(
      times(
        switchAllDay(
          form({ start: "2024-01-01T09:00", end: "2024-01-02T00:00" }),
          true
        )
      )
    ).toEqual(["2024-01-01", "2024-01-01"]);
  });

  test("keeps a zero-length event at midnight on its day", () => {
    expect(
      times(
        switchAllDay(
          form({ start: "2024-01-01T00:00", end: "2024-01-01T00:00" }),
          true
        )
      )
    ).toEqual(["2024-01-01", "2024-01-01"]);
  });

  test("ends at midnight after the last day when switching from all-day", () => {
    const values = switchAllDay(
      form({ allDay: true, start: "2024-01-01", end: "2024-01-03" }),
      false
    );
    expect(times(values)).toEqual(["2024-01-01T00:00", "2024-01-04T00:00"]);
    expect(validateEventForm({ ...values, title: "A" })).toEqual([]);
  });

  test("covers the same days switching there and back", () => {
    const allDay = form({ allDay: true, start: "2024-01-01", end: "2024-01-01" });
    expect(switchAllDay(switchAllDay(allDay, false), true)).toEqual(allDay);
  });

  test("leaves empty fields empty, and an unchanged mode alone", () => {
    expect(times(switchAllDay(form({}), true))).toEqual(["", ""]);
    expect(times(switchAllDay(form({ allDay: true }), false))).toEqual(["", ""]);
    const values = form({ start: "2021-11-01T12:30" });
    expect(switchAllDay(values, false)).toBe(values);
  });
});

describe("toExclusiveEnd", () => {
  test("adds a day, across month and year ends", () => {
    expect(toExclusiveEnd("2021-11-03")).toBe("2021-11-04");
    expect(toExclusiveEnd("2021-12-31")).toBe("2022-01-01");
    expect(toExclusiveEnd("2024-02-28")).toBe("2024-02-29");
  });
});

describe("padForInsertion", () => {
  test("adds nothing on an empty line", () => {
    expect(padForInsertion("B", "", "")).toBe("B");
  });

  test("starts a new line after text before the cursor", () => {
    expect(padForInsertion("B", "Hotel:", "")).toBe("\nB");
  });

  test("ends the block's line before text after the cursor", () => {
    expect(padForInsertion("B", "  ", "rest")).toBe("B\n");
  });
});

describe("tags", () => {
  test("parseTagInput splits on commas", () => {
    expect(parseTagInput("hotel, flight,, hotel ,")).toEqual([
      "hotel",
      "flight",
    ]);
  });

  test("tagsInNote collects the tags of a note's events", () => {
    const note = [
      "```itinerary-event",
      "title: A",
      "start: 2021-11-01",
      "tag: hotel",
      "```",
      "```itinerary-event",
      "title: B",
      "start: 2021-11-02",
      "tag:",
      "- flight",
      "- hotel",
      "```",
    ].join("\n");
    expect(tagsInNote(note)).toEqual(["hotel", "flight"]);
  });

  test("tagsInNote leaves out tags the comma-separated field can't hold", () => {
    const note = [
      "```itinerary-event",
      "title: A",
      "start: 2021-11-01",
      "tag:",
      "- Paris, France",
      "- hotel",
      "```",
    ].join("\n");
    expect(tagsInNote(note)).toEqual(["hotel"]);
  });

  test("suggestTags matches the tag being typed and skips entered ones", () => {
    const known = ["hotel", "flight", "Hostel"];
    expect(suggestTags("", known)).toEqual(known);
    expect(suggestTags("ho", known)).toEqual(["hotel", "Hostel"]);
    expect(suggestTags("hotel, ho", known)).toEqual(["Hostel"]);
    expect(suggestTags("HOSTEL, ho", known)).toEqual(["hotel"]);
  });

  test("completeTag replaces the tag being typed", () => {
    expect(completeTag("ho", "hotel")).toBe("hotel, ");
    expect(completeTag("flight, ho", "hotel")).toBe("flight, hotel, ");
  });
});

describe("suggestTimeZones", () => {
  const zones = ["America/New_York", "America/Mexico_City", "Europe/Paris"];

  test("matches part of a name, ignoring case and spaces", () => {
    expect(suggestTimeZones("new york", zones)).toEqual(["America/New_York"]);
    expect(suggestTimeZones("america", zones)).toEqual([
      "America/New_York",
      "America/Mexico_City",
    ]);
  });

  test("limits how many are suggested", () => {
    expect(suggestTimeZones("", zones, 2)).toHaveLength(2);
  });
});
