import { parseYaml, stringifyYaml } from "obsidian";
import { Temporal } from "temporal-polyfill";

import { EventFormValues, serializeEventForm } from "./eventForm";
import {
  hasOnlyDates,
  readBoolean,
  readInstant,
  readString,
  readTags,
  readTime,
  toCalendarDate,
  withoutDateAnnotation,
} from "./extractor";
import { getArrayForArrayOrObject, isRecord } from "./util";

/** An existing event, read for the form: the values the form shows, and
 * every other field in the block, which the form leaves as it was. */
export interface EventEdit {
  values: EventFormValues;
  kept: Record<string, unknown>;
  /** Whether the block said `allDay` outright. The form only writes
   * `allDay: true`; a block that said `false` keeps saying so, since a
   * filter on `allDay` can tell `false` from leaving it out. */
  saidAllDay: boolean;
}

/** The fields the form reads and writes; everything else is kept. */
const FormFields = new Set([
  "title",
  "allDay",
  "start",
  "end",
  "timeZone",
  "startTimeZone",
  "endTimeZone",
  "tag",
  "color",
]);

/** Reads an `itinerary-event` block's body for the form. Times are shown
 * as the event means them: one written with an offset or a zone becomes
 * the same moment as a clock time in the event's zone (or, without one,
 * the zone it was written in), so saving the form unchanged describes the
 * same event. Throws if the block isn't a set of fields. */
export function readEventForEdit(source: string): EventEdit {
  const parsed: unknown = parseYaml(source);
  const spec = parsed ?? {};
  if (!isRecord(spec)) {
    throw new Error("Event must be a set of `key: value` fields.");
  }

  const timeZone = readString(spec, "timeZone");
  const startZone = readString(spec, "startTimeZone") ?? timeZone;
  const endZone = readString(spec, "endTimeZone") ?? timeZone;
  const start = withoutDateAnnotation(readTime(spec, "start"));
  const end = withoutDateAnnotation(readTime(spec, "end"));
  // As the extractor decides it, so the form shows what the calendar does.
  const allDay = readBoolean(spec, "allDay") ?? hasOnlyDates(start, end);

  const common = {
    title: readString(spec, "title") ?? "",
    allDay,
    tags: getArrayForArrayOrObject(readTags(spec)),
    color: readString(spec, "color") ?? "",
  };
  const kept = Object.fromEntries(
    Object.entries(spec).filter(([field]) => !FormFields.has(field))
  );
  const saidAllDay = readBoolean(spec, "allDay") !== undefined;

  if (allDay) {
    const startDate = start === undefined ? "" : toCalendarDate("start", start);
    const startTimeZone = startZone ?? "";
    const endTimeZone = endZone ?? "";
    return {
      values: {
        ...common,
        start: startDate,
        end: end === undefined ? "" : toLastDay(toCalendarDate("end", end), startDate),
        startTimeZone,
        endTimeZone,
        endTimeZoneFollows: startTimeZone === endTimeZone,
      },
      kept,
      saidAllDay,
    };
  }

  const startTime = toFormTime(start, startZone);
  const endTime =
    end === undefined
      ? { time: "", zone: startTime.zone }
      : toFormTime(end, endZone);
  return {
    values: {
      ...common,
      start: startTime.time,
      end: endTime.time,
      startTimeZone: startTime.zone,
      endTimeZone: endTime.zone,
      endTimeZoneFollows: startTime.zone === endTime.zone,
    },
    kept,
    saidAllDay,
  };
}

/** The body of an edited event's block: the form's fields, then the ones
 * it kept. */
export function serializeEditedEvent(edit: EventEdit): string {
  const lines = serializeEventForm(edit.values).split("\n");
  if (edit.saidAllDay && !edit.values.allDay) {
    // Where the form writes `allDay: true`: after the title.
    lines.splice(1, 0, "allDay: false");
  }
  if (Object.keys(edit.kept).length > 0) {
    lines.push(stringifyYaml(edit.kept).trimEnd());
  }
  return lines.join("\n");
}

/** An all-day event's exclusive end as the form's inclusive last day. A
 * zero-length event (end on its start) keeps its one day. */
function toLastDay(end: string, start: string): string {
  try {
    const lastDay = Temporal.PlainDate.from(end).subtract({ days: 1 });
    if (start !== "" && Temporal.PlainDate.compare(lastDay, start) < 0) {
      return start;
    }
    return lastDay.toString();
  } catch {
    return end;
  }
}

interface FormTime {
  time: string;
  zone: string;
}

/** A timed event's start or end as the form's clock time and zone. */
function toFormTime(time: string | undefined, zone: string | undefined): FormTime {
  if (time === undefined) {
    return { time: "", zone: zone ?? "" };
  }
  try {
    const instant = readInstant(time);
    if (instant) {
      const shownIn = zone ?? writtenZone(time);
      return {
        time: formatClockTime(instant.toZonedDateTimeISO(shownIn).toPlainDateTime()),
        zone: shownIn,
      };
    }
    // A date alone is midnight, as the extractor reads it.
    return {
      time: formatClockTime(Temporal.PlainDateTime.from(time)),
      zone: zone ?? "",
    };
  } catch {
    // Something only FullCalendar reads; shown as written, for the form's
    // validation to point out.
    return { time, zone: zone ?? "" };
  }
}

/** The zone a time with an offset or zone was written in: its bracketed
 * zone, `UTC` for `Z`, or else its offset (`+05:00`), which Temporal and
 * the extractor accept as a zone. */
function writtenZone(time: string): string {
  try {
    return Temporal.ZonedDateTime.from(time).timeZoneId;
  } catch {
    // No bracketed zone.
  }
  const offset = /([-+])(\d{2}):?(\d{2})?(?::?00)?\s*$/.exec(time);
  if (offset) {
    const [, sign, hours, minutes] = offset;
    const zone = `${sign}${hours}:${minutes ?? "00"}`;
    return zone === "+00:00" || zone === "-00:00" ? "UTC" : zone;
  }
  return "UTC";
}

/** The form's `YYYY-MM-DDTHH:mm`, with seconds only when there are some. */
function formatClockTime(time: Temporal.PlainDateTime): string {
  const whole = time.second === 0 && time.millisecond === 0 &&
    time.microsecond === 0 && time.nanosecond === 0;
  return time.toString(
    whole ? { smallestUnit: "minute", calendarName: "never" } : { calendarName: "never" }
  );
}

/** Where a rendered block sits in its note: Obsidian's section info for
 * it, which may span more than the block (a list it's in, say). */
export interface BlockLocation {
  lineStart: number;
  lineEnd: number;
}

const OpeningFence = /^(.*?)(`{3,}|~{3,})[ \t]*itinerary-event[ \t]*$/;
const ClosingFence = /^(.*?)(`{3,}|~{3,})[ \t]*$/;

/** The note's text with the `itinerary-event` block whose body is
 * `source` replaced by `body`, keeping its fences and the indentation or
 * quoting it's written in. Returns null when exactly one such block can't
 * be found within `at`: the note has changed since the block was shown. */
export function replaceEventBlock(
  doc: string,
  at: BlockLocation,
  source: string,
  body: string
): string | null {
  const lines = doc.split("\n");
  const wanted = trimLines(source.split("\n"));
  const last = Math.min(at.lineEnd, lines.length - 1);
  const found: { open: number; close: number; prefix: string }[] = [];

  for (let open = at.lineStart; open <= last; open++) {
    const opening = OpeningFence.exec(stripCr(lines[open]));
    if (!opening) {
      continue;
    }
    const [, linePrefix, fence] = opening;
    const prefix = bodyPrefix(linePrefix);
    const close = findClosingFence(lines, open + 1, last, fence);
    if (close === null) {
      continue;
    }
    const inside = trimLines(
      lines.slice(open + 1, close).map((line) => stripPrefix(stripCr(line), prefix))
    );
    if (inside.join("\n") === wanted.join("\n")) {
      found.push({ open, close, prefix });
    }
    open = close;
  }

  if (found.length !== 1) {
    return null;
  }
  const { open, close, prefix } = found[0];
  const eol = lines[open].endsWith("\r") ? "\r" : "";
  const replacement = body
    .split("\n")
    .map((line) => (line === "" ? prefix.trimEnd() : prefix + line) + eol);
  return [
    ...lines.slice(0, open + 1),
    ...replacement,
    ...lines.slice(close),
  ].join("\n");
}

function findClosingFence(
  lines: string[],
  from: number,
  last: number,
  fence: string
): number | null {
  for (let line = from; line <= last; line++) {
    const closing = ClosingFence.exec(stripCr(lines[line]));
    if (
      closing &&
      closing[2][0] === fence[0] &&
      closing[2].length >= fence.length
    ) {
      return line;
    }
  }
  return null;
}

/** What precedes a block's body lines, from what precedes its opening
 * fence: indentation and `>` stay, while a list marker (`- `, `1. `)
 * becomes the spaces that line up under it. */
function bodyPrefix(linePrefix: string): string {
  return linePrefix.replace(/[-*+]|\d+[.)]/g, (marker) =>
    " ".repeat(marker.length)
  );
}

function stripPrefix(line: string, prefix: string): string {
  if (line.startsWith(prefix)) {
    return line.slice(prefix.length);
  }
  return line.trim() === prefix.trim() ? "" : line;
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/** Lines without trailing whitespace or trailing blank lines, so a body
 * compares equal however Obsidian handed it over. */
function trimLines(lines: string[]): string[] {
  const trimmed = lines.map((line) => line.trimEnd());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
    trimmed.pop();
  }
  return trimmed;
}
