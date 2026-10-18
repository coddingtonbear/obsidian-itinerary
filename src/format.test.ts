import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Settings } from "luxon";

import { describeEventTime } from "./format";
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

describe("describeEventTime", () => {
  beforeAll(() => {
    Settings.defaultLocale = "en-US";
    Settings.defaultZone = "America/Los_Angeles";
  });

  afterAll(() => {
    Settings.defaultLocale = "";
    Settings.defaultZone = "system";
  });

  test("describes a single all-day date", () => {
    expect(describeEventTime(event({ allDay: true, start: "2021-11-01" }))).toBe(
      "November 1, 2021 (all day)"
    );
  });

  test("describes an all-day range through the day before its end", () => {
    expect(
      describeEventTime(
        event({ allDay: true, start: "2021-10-31", end: "2021-11-04" })
      )
    ).toBe("October 31, 2021 - November 3, 2021 (all day)");
  });

  test("describes an all-day event ending the next day as one day", () => {
    expect(
      describeEventTime(
        event({ allDay: true, start: "2021-11-01", end: "2021-11-02" })
      )
    ).toBe("November 1, 2021 (all day)");
  });

  test("describes an all-day event without a start as undated", () => {
    expect(describeEventTime(event({ allDay: true, end: "2021-11-04" }))).toBe(
      "All day"
    );
  });

  test("describes an all-day event without dates", () => {
    expect(describeEventTime(event({ allDay: true }))).toBe("All day");
  });

  test("describes a start time", () => {
    expect(describeEventTime(event({ start: "2021-11-01T12:00" }))).toMatch(
      /^November 1, 2021(,| at) 12:00\sPM PDT$/
    );
  });

  test("describes a same-day time range without repeating the date", () => {
    expect(
      describeEventTime(
        event({ start: "2021-11-01T19:00", end: "2021-11-01T21:00" })
      )
    ).toMatch(/^November 1, 2021(,| at) 7:00\sPM PDT - 9:00\sPM PDT$/);
  });

  test("describes a range across days with both dates", () => {
    expect(
      describeEventTime(
        event({ start: "2021-10-31T17:00", end: "2021-11-04T11:00" })
      )
    ).toMatch(/^October 31, 2021.* - November 4, 2021(,| at) 11:00\sAM PDT$/);
  });

  test("shows each end of the event in its own zone", () => {
    const text = describeEventTime(
      event({
        start: "2021-11-04T12:31:00.000-07:00",
        startTimeZone: "America/Los_Angeles",
        end: "2021-11-04T13:49:00.000-06:00",
        endTimeZone: "America/Mexico_City",
        timeZone: "Asia/Tokyo",
      })
    );
    expect(text).toMatch(/12:31\sPM PDT - .*1:49\sPM CST$/);
  });

  test("falls back to timeZone for both ends", () => {
    const text = describeEventTime(
      event({
        start: "2021-12-31T18:00:00.000-05:00",
        timeZone: "America/New_York",
      })
    );
    expect(text).toMatch(/6:00\sPM EST$/);
  });

  test("describes nothing for an event without times", () => {
    expect(describeEventTime(event({}))).toBe("");
  });
});
