import { parseYaml } from "obsidian";
import { Temporal } from "temporal-polyfill";

import { getEventInformation } from "./extractor";
import { getArrayForArrayOrObject } from "./util";

/** What the "Insert itinerary event" form collects. Times are as the
 * form's inputs give them: `YYYY-MM-DD` for an all-day event, and
 * `YYYY-MM-DDTHH:mm` otherwise. */
export interface EventFormValues {
  title: string;
  allDay: boolean;
  start: string;
  /** For an all-day event, the last day it covers (inclusive); see
   * toExclusiveEnd. */
  end: string;
  /** The zones the start and end are in; they differ for a flight that
   * crosses zones. Empty means the zone the event is displayed in. */
  startTimeZone: string;
  endTimeZone: string;
  /** Whether the end's zone still follows the start's: true until the
   * end's zone is set to something else; see setStartTimeZone. */
  endTimeZoneFollows: boolean;
  tags: string[];
  color: string;
}

/** An empty form, with both ends in `timeZone` (the user's own zone, from
 * defaultTimeZone, when the form opens). */
export function emptyEventForm(timeZone = ""): EventFormValues {
  return {
    title: "",
    allDay: false,
    start: "",
    end: "",
    startTimeZone: timeZone,
    endTimeZone: timeZone,
    endTimeZoneFollows: true,
    tags: [],
    color: "",
  };
}

/** The zone the system is set to, or empty if it can't be told. */
export function defaultTimeZone(): string {
  try {
    const zone = Temporal.Now.timeZoneId();
    return isKnownTimeZone(zone) ? zone : "";
  } catch {
    return "";
  }
}

/** The form's values after the start's zone changes. The end's zone
 * follows it until the end's is set to something else, so only an event
 * that ends somewhere else (a flight) needs both set. */
export function setStartTimeZone(
  values: EventFormValues,
  zone: string
): EventFormValues {
  return {
    ...values,
    startTimeZone: zone,
    endTimeZone: values.endTimeZoneFollows ? zone : values.endTimeZone,
  };
}

/** The form's values after the end's zone changes. Setting it back to the
 * start's makes it follow the start's again. */
export function setEndTimeZone(
  values: EventFormValues,
  zone: string
): EventFormValues {
  return {
    ...values,
    endTimeZone: zone,
    endTimeZoneFollows: zone.trim() === values.startTimeZone.trim(),
  };
}

/** The form's values after the all-day toggle changes, with the times
 * entered converted to the other kind of input. The start keeps its date
 * (a date becomes midnight). The end is converted so the event covers the
 * same days: a timed end is exclusive, while an all-day event's last day
 * is inclusive, so a timed end at midnight becomes the day before, and a
 * last day becomes midnight after it. */
export function switchAllDay(
  values: EventFormValues,
  allDay: boolean
): EventFormValues {
  if (values.allDay === allDay) {
    return values;
  }
  const start = values.start === "" ? "" : values.start.slice(0, 10);
  return {
    ...values,
    allDay,
    start: allDay || start === "" ? start : `${start}T00:00`,
    end: allDay ? toLastDay(values.end, values.start) : toTimedEnd(values.end),
  };
}

function isSameTime(a: string, b: string): boolean {
  try {
    return Temporal.PlainDateTime.compare(a, b) === 0;
  } catch {
    return false;
  }
}

function toLastDay(end: string, start: string): string {
  if (end === "") {
    return end;
  }
  const date = end.slice(0, 10);
  try {
    const time = Temporal.PlainDateTime.from(end);
    // A zero-length event at midnight keeps its one day.
    if (
      time.hour === 0 &&
      time.minute === 0 &&
      time.second === 0 &&
      !isSameTime(end, start)
    ) {
      return time.toPlainDate().subtract({ days: 1 }).toString();
    }
  } catch {
    // Not a complete date-time; keep what date there is.
  }
  return date;
}

function toTimedEnd(lastDay: string): string {
  if (lastDay === "") {
    return lastDay;
  }
  try {
    return `${toExclusiveEnd(lastDay)}T00:00`;
  } catch {
    return `${lastDay.slice(0, 10)}T00:00`;
  }
}

/** An all-day event's `end` is exclusive (the day after the last day it
 * covers), which surprises people; the form asks for the last day and
 * writes the day after. */
export function toExclusiveEnd(lastDay: string): string {
  return Temporal.PlainDate.from(lastDay).add({ days: 1 }).toString();
}

export function isKnownTimeZone(zone: string): boolean {
  try {
    Temporal.PlainDate.from("2000-01-01").toZonedDateTime(zone);
    return true;
  } catch {
    return false;
  }
}

/** The forms a date input and a date-time input give their value in. */
const FormDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const FormDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function isValidTime(time: string, allDay: boolean): boolean {
  if (!(allDay ? FormDatePattern : FormDateTimePattern).test(time)) {
    return false;
  }
  try {
    if (allDay) {
      Temporal.PlainDate.from(time);
    } else {
      Temporal.PlainDateTime.from(time);
    }
    return true;
  } catch {
    return false;
  }
}

/** Problems that keep the form from writing an event; empty when it can. */
export function validateEventForm(values: EventFormValues): string[] {
  const problems: string[] = [];
  if (values.title.trim() === "") {
    problems.push("Enter a title.");
  }
  const kind = values.allDay ? "date" : "date and time";
  const startValid = isValidTime(values.start, values.allDay);
  if (values.start === "") {
    problems.push(`Enter a start ${kind}.`);
  } else if (!startValid) {
    problems.push(`The start isn't a valid ${kind}.`);
  }
  if (values.end !== "") {
    if (!isValidTime(values.end, values.allDay)) {
      problems.push(`The end isn't a valid ${kind}.`);
    } else if (startValid && compareTimes(values) < 0) {
      problems.push(
        values.allDay
          ? "The last day is before the start."
          : "The end is before the start."
      );
    }
  }
  if (!values.allDay) {
    for (const zone of usedZones(values)) {
      if (zone !== "" && !isKnownTimeZone(zone)) {
        problems.push(`"${zone}" isn't a time zone Obsidian knows.`);
      }
    }
  }
  return problems;
}

/** The zones a timed event's block will name, without repeats: the end's
 * only matters when there is an end. */
function usedZones(values: EventFormValues): string[] {
  const zones = [values.startTimeZone.trim()];
  if (values.end !== "") {
    zones.push(values.endTimeZone.trim());
  }
  return [...new Set(zones)];
}

/** Compares the end with the start. A timed event's ends may be in
 * different zones, so they're compared as instants: a flight that lands
 * at an earlier clock time than it took off is fine. While a zone is
 * unknown (reported on its own) the order can't be told, so it passes. */
function compareTimes(values: EventFormValues): number {
  if (values.allDay) {
    return Temporal.PlainDate.compare(values.end, values.start);
  }
  if (values.startTimeZone.trim() === values.endTimeZone.trim()) {
    // One zone: the clock times say it, even in a daylight-saving gap.
    return Temporal.PlainDateTime.compare(values.end, values.start);
  }
  const start = toInstant(values.start, values.startTimeZone);
  const end = toInstant(values.end, values.endTimeZone);
  if (start === null || end === null) {
    return 0;
  }
  return Temporal.Instant.compare(end, start);
}

function toInstant(time: string, zone: string): Temporal.Instant | null {
  const trimmed = zone.trim();
  try {
    return Temporal.PlainDateTime.from(time)
      .toZonedDateTime(trimmed === "" ? Temporal.Now.timeZoneId() : trimmed)
      .toInstant();
  } catch {
    return null;
  }
}

/** Writes a YAML scalar, quoting it only when it wouldn't read back as
 * the same text unquoted (`true`, `12`, `a: b`, `# x`, ...). */
function yamlScalar(value: string): string {
  if (value.trim() === value && !/[\r\n]/.test(value)) {
    try {
      const parsed: unknown = parseYaml(`v: ${value}`);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as Record<string, unknown>).v === value
      ) {
        return value;
      }
    } catch {
      // Needs quoting.
    }
  }
  return JSON.stringify(value);
}

/** The body of an `itinerary-event` block for the form's values, which
 * must have passed validateEventForm. */
export function serializeEventForm(values: EventFormValues): string {
  const lines = [`title: ${yamlScalar(values.title.trim())}`];
  if (values.allDay) {
    lines.push("allDay: true");
  }
  lines.push(`start: ${values.start}`);
  if (values.end !== "") {
    lines.push(
      `end: ${values.allDay ? toExclusiveEnd(values.end) : values.end}`
    );
  }
  if (!values.allDay) {
    lines.push(...zoneLines(values));
  }
  const color = values.color.trim();
  if (color !== "") {
    lines.push(`color: ${yamlScalar(color)}`);
  }
  const tags = cleanTags(values.tags);
  if (tags.length > 0) {
    lines.push("tag:", ...tags.map((tag) => `- ${yamlScalar(tag)}`));
  }
  return lines.join("\n");
}

/** One `timeZone` when both ends are in the same zone (or there is no
 * end); otherwise `startTimeZone` and `endTimeZone`, leaving out an end
 * left empty (it's then in the zone the event is displayed in). */
function zoneLines(values: EventFormValues): string[] {
  const start = values.startTimeZone.trim();
  const end = values.end === "" ? start : values.endTimeZone.trim();
  if (start === end) {
    return start === "" ? [] : [`timeZone: ${yamlScalar(start)}`];
  }
  const lines: string[] = [];
  if (start !== "") {
    lines.push(`startTimeZone: ${yamlScalar(start)}`);
  }
  if (end !== "") {
    lines.push(`endTimeZone: ${yamlScalar(end)}`);
  }
  return lines;
}

/** A whole fenced `itinerary-event` block for the form's values. */
export function eventBlock(values: EventFormValues): string {
  return "```itinerary-event\n" + serializeEventForm(values) + "\n```";
}

/** Surrounds a block with the line breaks it needs to sit on lines of
 * its own when inserted at the cursor, given the text on the cursor's
 * line before and after it. */
export function padForInsertion(
  block: string,
  lineBefore: string,
  lineAfter: string
): string {
  const before = lineBefore.trim() === "" ? "" : "\n";
  const after = lineAfter.trim() === "" ? "" : "\n";
  return before + block + after;
}

function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed !== "") {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

/** Splits the form's comma-separated tag field into tags. */
export function parseTagInput(text: string): string[] {
  return cleanTags(text.split(","));
}

/** The tag field's text for an event's tags. A tag containing a comma
 * can't be written there, so it's left out, and kept by tagsFromField. */
export function tagFieldText(tags: string[]): string {
  return tags.filter((tag) => !tag.includes(",")).join(", ");
}

/** The tags after the tag field changes to `text`: those entered, then
 * any of the event's `previous` tags the field couldn't show. */
export function tagsFromField(text: string, previous: string[]): string[] {
  return cleanTags([
    ...parseTagInput(text),
    ...previous.filter((tag) => tag.includes(",")),
  ]);
}

/** Every tag used by an event in a note, in order of first use. Tags
 * containing a comma are left out: the form's tag field is
 * comma-separated, so it can't enter them. */
export function tagsInNote(text: string): string[] {
  return cleanTags(
    getEventInformation(text).flatMap((event) =>
      getArrayForArrayOrObject(event.tag)
    )
  ).filter((tag) => !tag.includes(","));
}

/** Tags to suggest for the tag being typed (the text after the last
 * comma), leaving out tags already entered. Both ignore case. */
export function suggestTags(text: string, known: string[]): string[] {
  const parts = text.split(",");
  const typing = parts[parts.length - 1].trim().toLowerCase();
  const entered = new Set(
    parts.slice(0, -1).map((part) => part.trim().toLowerCase())
  );
  return known.filter((tag) => {
    const lower = tag.toLowerCase();
    return !entered.has(lower) && lower.includes(typing);
  });
}

/** The tag field's text after choosing a suggested tag for the tag being
 * typed. */
export function completeTag(text: string, tag: string): string {
  const parts = text.split(",");
  parts[parts.length - 1] = parts.length > 1 ? ` ${tag}` : tag;
  return parts.join(",") + ", ";
}

/** Time zones whose name contains the query, ignoring case and treating
 * spaces as underscores (`new york` finds `America/New_York`). */
export function suggestTimeZones(
  query: string,
  zones: readonly string[],
  limit = 50
): string[] {
  const needle = query.trim().toLowerCase().replace(/ /g, "_");
  return zones
    .filter((zone) => zone.toLowerCase().includes(needle))
    .slice(0, limit);
}
