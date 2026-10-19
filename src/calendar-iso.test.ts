import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

import { isCalendarReadable } from "./checks";
import { CalendarIsoPattern } from "./extractor";

/** FullCalendar's own (unexported) ISO date regex, read from its source.
 * extractor.ts mirrors it to predict which times FullCalendar can read; if
 * an upgrade changes it, this test fails and the mirror needs updating. */
function fullCalendarIsoPattern(): RegExp {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@full-ui/headless-calendar");
  const source = readFileSync(join(dirname(entry), "index.js"), "utf8");
  const match = /ISO_RE = \/(.+)\/;/.exec(source);
  if (!match) {
    throw new Error("FullCalendar's ISO_RE was not found; check extractor.ts");
  }
  return new RegExp(match[1]);
}

describe("CalendarIsoPattern", () => {
  const theirs = fullCalendarIsoPattern();

  test.each([
    "2021-11-01",
    "20211101",
    "2021-11-01T12:00",
    "2021-11-01 12:00",
    "2021-11-01T1200",
    "2021-11-01T12:00:30",
    "2021-11-01T12:00:30.123456",
    "2021-11-01T12:00Z",
    "2021-11-01T12:00+01",
    "2021-11-01T12:00+0100",
    "2021-11-01T12:00-01:00",
    " 2021-11-01T12:00",
    "2021-11-01T12:00 ",
    "2021-11-01t12:00",
    "2021-11-01T12:00z",
    "2021-11-01T12",
    "2021-11-01T12:00+01:00:00",
    "2021-11-01T12:00[Europe/Paris]",
    "2021-11-01T12:00:30,5",
  ])("agrees with FullCalendar on %j", (time) => {
    expect(CalendarIsoPattern.test(time)).toBe(theirs.test(time));
  });
});

describe("isCalendarReadable", () => {
  const theirs = fullCalendarIsoPattern();

  test.each([
    "2021",
    "2021-11",
    "202111",
    "2021-11-01",
    "2021-11-01T12:00Z",
    "2021-11T12:00",
    "21-11-01",
    "next tuesday",
    "2021/11/01",
    " 2021",
  ])("agrees with FullCalendar on %j", (time) => {
    expect(isCalendarReadable(time)).toBe(theirs.test(time));
  });
});
