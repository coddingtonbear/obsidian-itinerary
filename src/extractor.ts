import { parseYaml } from "obsidian";
import { Temporal } from "temporal-polyfill";

import { EventSpec } from "./types";
import { errorMessage, isRecord } from "./util";

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
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "no") {
      return false;
    }
  }
  throw new Error(`Event field "${field}" must be true or false.`);
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

/** Interprets a wall-clock time in the given zone as an absolute ISO time.
 * A time that already names its offset or zone is the same instant, shown
 * in that zone; without a zone it is written as UTC, a form FullCalendar's
 * own parser accepts (it rejects bracketed zones, offsets with seconds and
 * a few other forms Temporal reads).
 *
 * Dates without a time are left alone when `keepDates` is set (the event's
 * times are all dates): FullCalendar reads such events as all-day, and
 * giving them a zone would make them events at midnight. */
function applyZone(
  field: string,
  time: string | undefined,
  zone: string | undefined,
  keepDates: boolean
): string | undefined {
  if (time === undefined || (keepDates && isDateOnly(time))) {
    return time;
  }
  const instant = readInstant(time);
  if (zone === undefined) {
    return instant ? instant.toString() : time;
  }
  try {
    const zoned =
      instant?.toZonedDateTimeISO(zone) ??
      Temporal.PlainDateTime.from(time).toZonedDateTime(zone);
    return zoned.toString({ timeZoneName: "never" });
  } catch (e) {
    throw new Error(
      `Could not interpret event ${field} "${time}" in time zone "${zone}": ${errorMessage(e)}`
    );
  }
}

export function parseEventSpec(eventSpec: string): EventSpec {
  const parsed: unknown = parseYaml(eventSpec);
  const spec = parsed ?? {};
  if (!isRecord(spec)) {
    throw new Error("Event must be a set of `key: value` fields.");
  }

  const allDay = readBoolean(spec, "allDay");
  const timeZone = readString(spec, "timeZone");
  const startTimeZone = readString(spec, "startTimeZone");
  const endTimeZone = readString(spec, "endTimeZone");
  let start = readString(spec, "start");
  let end = readString(spec, "end");

  // Apply timezones to start/end times if provided
  if (!allDay) {
    const datesOnly = hasOnlyDates(start, end);
    start = applyZone("start", start, startTimeZone ?? timeZone, datesOnly);
    end = applyZone("end", end, endTimeZone ?? timeZone, datesOnly);
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
 * present but undefined as set: `allDay: undefined` reads as `false`, which
 * stops it inferring all-day events from date-only times. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;
}
