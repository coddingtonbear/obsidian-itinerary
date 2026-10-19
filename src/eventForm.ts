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
  timeZone: string;
  tags: string[];
  color: string;
}

export function emptyEventForm(): EventFormValues {
  return {
    title: "",
    allDay: false,
    start: "",
    end: "",
    timeZone: "",
    tags: [],
    color: "",
  };
}

/** Converts a time entered in the form when the all-day toggle changes:
 * a date-time keeps its date, and a date becomes midnight on that date. */
export function convertFormTime(time: string, allDay: boolean): string {
  if (time === "") {
    return time;
  }
  const date = time.slice(0, 10);
  return allDay ? date : `${date}T00:00`;
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
  const zone = values.timeZone.trim();
  if (!values.allDay && zone !== "" && !isKnownTimeZone(zone)) {
    problems.push(`"${zone}" isn't a time zone Obsidian knows.`);
  }
  return problems;
}

function compareTimes(values: EventFormValues): number {
  return values.allDay
    ? Temporal.PlainDate.compare(values.end, values.start)
    : Temporal.PlainDateTime.compare(values.end, values.start);
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
  const zone = values.timeZone.trim();
  if (!values.allDay && zone !== "") {
    lines.push(`timeZone: ${yamlScalar(zone)}`);
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

/** Every tag used by an event in a note, in order of first use. */
export function tagsInNote(text: string): string[] {
  return cleanTags(
    getEventInformation(text).flatMap((event) =>
      getArrayForArrayOrObject(event.tag)
    )
  );
}

/** Tags to suggest for the tag being typed (the text after the last
 * comma), leaving out tags already entered. */
export function suggestTags(text: string, known: string[]): string[] {
  const parts = text.split(",");
  const typing = parts[parts.length - 1].trim().toLowerCase();
  const entered = new Set(parts.slice(0, -1).map((part) => part.trim()));
  return known.filter(
    (tag) => !entered.has(tag) && tag.toLowerCase().includes(typing)
  );
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
