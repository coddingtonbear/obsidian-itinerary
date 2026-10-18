import { parseYaml } from "obsidian";
import { DateTime } from "luxon";

import { EventSpec } from "./types";
import { isRecord } from "./util";

const DefaultTextColor = "white";
const DefaultColor = "blue";
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

/** Interprets a wall-clock time in the given zone as an absolute ISO time. */
function applyZone(
  field: string,
  time: string | undefined,
  zone: string | undefined
): string | undefined {
  if (time === undefined || zone === undefined) {
    return time;
  }
  const zoned = DateTime.fromISO(time, { zone });
  const iso = zoned.toISO();
  if (iso === null) {
    throw new Error(
      `Could not interpret event ${field} "${time}" in time zone "${zone}": ${
        zoned.invalidExplanation ?? zoned.invalidReason ?? "invalid"
      }`
    );
  }
  return iso;
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
    backgroundColor:
      readString(spec, "backgroundColor") ?? color ?? DefaultColor,
    borderColor: readString(spec, "borderColor") ?? color ?? DefaultColor,
    textColor: readString(spec, "textColor") ?? DefaultTextColor,
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
