import { parseYaml } from "obsidian";
import { Temporal } from "temporal-polyfill";

import { EventSpec } from "./types";
import { errorMessage, isRecord, readBooleanValue } from "./util";

const DefaultTitle = "Untitled event";

const EventBlockPattern =
  /^[ \t]*```itinerary-event[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;

/** Finds and parses every `itinerary-event` block in a document.
 *
 * Blocks that fail to parse are skipped. Their error is shown where the
 * block itself is rendered; this runs outside any render, so there is
 * nowhere useful to report it from here. */
export function getEventInformation(fileData: string): EventSpec[] {
  const events: EventSpec[] = [];

  for (const match of fileData.matchAll(EventBlockPattern)) {
    try {
      events.push(parseEventSpec(match[1]));
    } catch {
      // See above.
    }
  }

  return events;
}

/** Reads `start` or `end`: text, or a number of milliseconds since 1970,
 * which FullCalendar accepted in version 1. */
function readTime(
  spec: Record<string, unknown>,
  field: string
): string | undefined {
  const value = spec[field];
  if (typeof value === "number") {
    return Temporal.Instant.fromEpochMilliseconds(value).toString();
  }
  return readString(spec, field);
}

function readString(
  spec: Record<string, unknown>,
  field: string
): string | undefined {
  const value = spec[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`Event field "${field}" must be text.`);
}

function readBoolean(
  spec: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = spec[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  const result = readBooleanValue(value);
  if (result === null) {
    throw new Error(`Event field "${field}" must be true or false.`);
  }
  return result;
}

function readTags(
  spec: Record<string, unknown>
): string | string[] | undefined {
  const value = spec.tag;
  if (Array.isArray(value)) {
    return value
      .filter((tag) => tag !== null && tag !== undefined)
      .map((tag) => {
        if (typeof tag === "object") {
          throw new Error(`Event field "tag" must be text or a list of text.`);
        }
        return String(tag as string | number | boolean);
      });
  }
  return readString(spec, "tag");
}

const DateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

/** A date with a zone annotation but no time, e.g. `2021-11-01[Europe/Paris]`. */
const AnnotatedDatePattern = /^(\d{4}-\d{2}-\d{2})\[[^\]]*\]$/;

/** The ISO forms FullCalendar 7's own date parser accepts (its `ISO_RE`,
 * restricted to full dates). */
export const CalendarIsoPattern =
  /^\s*\d{4}-?\d{2}-?\d{2}(?:[T ]\d{2}:?\d{2}(?::?\d{2}(?:\.\d+)?)?(?:Z|[-+]\d{2}(?::?\d{2})?)?)?$/;

/** Whether an ISO time is a date without a time of day. */
export function isDateOnly(time: string | undefined): boolean {
  return time !== undefined && DateOnlyPattern.test(time.trim());
}

/** Reads an ISO time as an instant, if it names its own offset (`Z`,
 * `+05:00`, ...) or zone (`[Europe/Paris]`). */
export function readInstant(time: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(time);
  } catch {
    // No offset; it may still name a zone.
  }
  try {
    return Temporal.ZonedDateTime.from(time).toInstant();
  } catch {
    return null;
  }
}

/** Whether an event's times are all dates without times of day, which
 * FullCalendar draws as an all-day event. */
export function hasOnlyDates(start?: string, end?: string): boolean {
  return isDateOnly(start) && (end === undefined || isDateOnly(end));
}

/** Fixes spellings FullCalendar's parser rejects but that differ from a
 * form it accepts only in letter case, a decimal comma, or a zero seconds
 * field on the offset; the date, time and offset written are kept. */
function respell(time: string): string {
  return time
    .replace(/^(\s*\d{4}-?\d{2}-?\d{2})t/, "$1T")
    .replace(/z$/, "Z")
    .replace(/(\d),(\d+)/, "$1.$2")
    .replace(/([-+]\d{2}:?\d{2}):?00$/, "$1");
}

/** Throws for a time naming a zone (in brackets) that Temporal couldn't
 * read: reading the rest as wall-clock time would put the event somewhere
 * the user didn't ask for. Other annotations (`[u-ca=iso8601]`) are fine. */
function rejectUnknownZone(field: string, time: string): void {
  for (const [, annotation] of time.matchAll(/\[!?([^\]]*)\]/g)) {
    if (!annotation.includes("=")) {
      throw new Error(
        `Could not interpret event ${field} "${time}": unknown time zone "${annotation}".`
      );
    }
  }
}

/** Rewrites a time FullCalendar's own parser would reject into one it
 * accepts. Times it accepts, and respellable ones, keep the date, time and
 * offset written, so filters comparing them as text see what the user
 * wrote; a time naming a zone in brackets is written with that zone's
 * offset; any other time with an offset becomes UTC; and a wall-clock time
 * only Temporal reads (`2021-11-01T12`) is written out in full. */
function toCalendarTime(field: string, time: string): string {
  if (CalendarIsoPattern.test(time)) {
    return time;
  }
  const respelled = respell(time);
  if (CalendarIsoPattern.test(respelled)) {
    return respelled;
  }
  try {
    return Temporal.ZonedDateTime.from(time).toString({
      timeZoneName: "never",
      calendarName: "never",
    });
  } catch {
    // Names no zone.
  }
  const instant = readInstant(time);
  if (instant) {
    return instant.toString();
  }
  rejectUnknownZone(field, time);
  try {
    return Temporal.PlainDateTime.from(time).toString({
      calendarName: "never",
    });
  } catch {
    return time;
  }
}

/** The date an all-day event's time was written on. FullCalendar would
 * convert a time with an offset into the calendar's zone before taking its
 * date, which can move it a day; an all-day event means the date written. */
function toCalendarDate(
  field: string,
  time: string,
  zone: string | undefined
): string {
  if (isDateOnly(time)) {
    return time;
  }
  try {
    // Accepts offsets and bracketed zones, and keeps the date as written.
    return Temporal.PlainDate.from(respell(time)).toString({
      calendarName: "never",
    });
  } catch {
    // `Z` times, or forms only toCalendarTime can read.
  }
  const instant = readInstant(time);
  if (instant) {
    // A `Z` time names no local date; take it in the event's zone.
    return instant
      .toZonedDateTimeISO(zone ?? "UTC")
      .toPlainDate()
      .toString();
  }
  return toCalendarTime(field, time);
}

/** Interprets a wall-clock time in the given zone as an absolute ISO time.
 * A time that already names its offset or zone is the same instant, shown
 * in that zone. Without a zone, the time is only rewritten if FullCalendar
 * couldn't read it as written (see toCalendarTime). Used for timed events
 * only: a date without a time becomes midnight in the zone. */
function applyZone(
  field: string,
  time: string | undefined,
  zone: string | undefined
): string | undefined {
  if (time === undefined) {
    return time;
  }
  if (zone === undefined) {
    return toCalendarTime(field, time);
  }
  const instant = readInstant(time);
  if (!instant) {
    rejectUnknownZone(field, time);
  }
  try {
    const zoned =
      instant?.toZonedDateTimeISO(zone) ??
      Temporal.PlainDateTime.from(time).toZonedDateTime(zone);
    return zoned.toString({ timeZoneName: "never", calendarName: "never" });
  } catch (e) {
    throw new Error(
      `Could not interpret event ${field} "${time}" in time zone "${zone}": ${errorMessage(e)}`
    );
  }
}

/** A zone on a date without a time means nothing (the event is all-day),
 * and would otherwise make the date read as a timed instant. */
function withoutDateAnnotation(time: string | undefined): string | undefined {
  return time?.trim().replace(AnnotatedDatePattern, "$1");
}

export function parseEventSpec(eventSpec: string): EventSpec {
  const parsed: unknown = parseYaml(eventSpec);
  const spec = parsed ?? {};
  if (!isRecord(spec)) {
    throw new Error("Event must be a set of `key: value` fields.");
  }

  const timeZone = readString(spec, "timeZone");
  const startTimeZone = readString(spec, "startTimeZone");
  const endTimeZone = readString(spec, "endTimeZone");
  let start = withoutDateAnnotation(readTime(spec, "start"));
  let end = withoutDateAnnotation(readTime(spec, "end"));
  // An event whose times are all dates is all-day unless it says
  // otherwise, as FullCalendar would infer; recording that here lets
  // filters on `allDay` agree with the calendar. `allDay: false` asks for
  // such dates as midnight in the event's zone.
  const allDay =
    readBoolean(spec, "allDay") ?? (hasOnlyDates(start, end) || undefined);

  // Apply timezones to start/end times if provided
  if (allDay) {
    start =
      start === undefined
        ? start
        : toCalendarDate("start", start, startTimeZone ?? timeZone);
    end =
      end === undefined
        ? end
        : toCalendarDate("end", end, endTimeZone ?? timeZone);
  } else {
    start = applyZone("start", start, startTimeZone ?? timeZone);
    end = applyZone("end", end, endTimeZone ?? timeZone);
  }

  const color = readString(spec, "color");

  return withoutUndefined({
    ...spec,
    allDay,
    start,
    end,
    timeZone,
    startTimeZone,
    endTimeZone,
    tag: readTags(spec),
    hidden: readBoolean(spec, "hidden"),
    title: readString(spec, "title") || DefaultTitle,
    // Colors are left unset unless given, so the itinerary's eventColor
    // and the theme's accent apply to the rest.
    backgroundColor: readString(spec, "backgroundColor") ?? color,
    borderColor: readString(spec, "borderColor") ?? color,
    textColor: readString(spec, "textColor"),
  });
}

/** Drops options that weren't set. FullCalendar treats an option that is
 * present but undefined as set (`allDay: undefined` reads as `false`). */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}
