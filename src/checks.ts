import { Temporal } from "temporal-polyfill";

import { CalendarIsoPattern, readEventFields, toEventSpec } from "./extractor";
import { EventSpec } from "./types";

/** What's likely wrong with an `itinerary-event` block. Errors mean the
 * event can't appear on any calendar; warnings mean it can, but probably
 * not as the user meant. */
export interface EventProblems {
  errors: string[];
  warnings: string[];
}

/** Parses an event block as parseEventSpec does, and checks it for likely
 * mistakes. Throws for blocks parseEventSpec rejects. */
export function readEventBlock(
  source: string
): EventProblems & { event: EventSpec } {
  const spec = readEventFields(source);
  const event = toEventSpec(spec);
  return { event, ...checkEvent(spec, event) };
}

/** The event fields FullCalendar 7 reads: its event refiners
 * (`EVENT_UI_REFINERS`, `EVENT_NON_DATE_REFINERS`, `EVENT_DATE_REFINERS`,
 * `EVENT_REFINERS`) and the simple recurrence plugin's
 * (`SIMPLE_RECURRING_REFINERS`). Kept by hand; checks.test.ts compares it
 * with FullCalendar's source, so an upgrade that changes them fails there. */
export const FullCalendarEventFields: readonly string[] = [
  "display",
  "editable",
  "startEditable",
  "durationEditable",
  "constraint",
  "overlap",
  "allow",
  "class",
  "className",
  "color",
  "contrastColor",
  "id",
  "groupId",
  "title",
  "url",
  "interactive",
  "start",
  "end",
  "date",
  "allDay",
  "extendedProps",
  "daysOfWeek",
  "startTime",
  "endTime",
  "duration",
  "startRecur",
  "endRecur",
];

/** The event fields this plugin reads itself, including FullCalendar 6
 * names it translates (see toEventInput). */
export const PluginEventFields: readonly string[] = [
  "tag",
  "timeZone",
  "startTimeZone",
  "endTimeZone",
  "hidden",
  "backgroundColor",
  "borderColor",
  "textColor",
  "classNames",
];

const KnownFields = [...PluginEventFields, ...FullCalendarEventFields];

/** Other names people write for a known field, normalized (see normalize),
 * that are too far from it to be caught as a typo. */
const Aliases: Readonly<Record<string, string>> = {
  tz: "timeZone",
  starttz: "startTimeZone",
  endtz: "endTimeZone",
  colour: "color",
  backgroundcolour: "backgroundColor",
  bordercolour: "borderColor",
  textcolour: "textColor",
  tags: "tag",
};

/** Fields that start a recurring event, which needs no `start`. */
const RecurrenceFields = [
  "daysOfWeek",
  "startTime",
  "endTime",
  "startRecur",
  "endRecur",
];

/** Lower case, without the separators people put between words. */
function normalize(field: string): string {
  return field.toLowerCase().replace(/[-_ ]/g, "");
}

/** The number of single-character insertions, deletions, substitutions or
 * swaps of neighbouring characters turning one text into the other. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** How many edits from a known field still read as a typo of it. Short
 * names get less room, since many short custom fields (`is`, `fee`) are
 * a couple of edits from one. */
function typoAllowance(field: string): number {
  if (field.length <= 2) {
    return 0;
  }
  return field.length <= 5 ? 1 : 2;
}

/** The known field an unknown one was probably meant to be, if any.
 * Fields that resemble none are left alone: they may be custom fields
 * used in filters. */
export function suggestField(field: string): string | undefined {
  const written = normalize(field);
  const alias = Aliases[written];
  if (alias !== undefined) {
    return alias;
  }
  let best: { field: string; distance: number } | undefined;
  for (const known of KnownFields) {
    const distance = editDistance(written, normalize(known));
    if (
      distance <= typoAllowance(known) &&
      (best === undefined || distance < best.distance)
    ) {
      best = { field: known, distance };
    }
  }
  return best?.field;
}

/** An event time as something comparable: an instant if it names its
 * offset, otherwise a wall-clock time. */
function readComparable(
  time: string
): Temporal.Instant | Temporal.PlainDateTime | null {
  try {
    return Temporal.Instant.from(time);
  } catch {
    // No offset.
  }
  try {
    return Temporal.PlainDateTime.from(time);
  } catch {
    return null;
  }
}

/** Whether an event's end is before its start. Unknown when one names an
 * offset and the other doesn't: the other is read in the calendar's zone,
 * which differs between itineraries. */
function endsBeforeStart(start: string, end: string): boolean {
  const from = readComparable(start);
  const to = readComparable(end);
  if (from instanceof Temporal.Instant && to instanceof Temporal.Instant) {
    return Temporal.Instant.compare(to, from) < 0;
  }
  if (
    from instanceof Temporal.PlainDateTime &&
    to instanceof Temporal.PlainDateTime
  ) {
    return Temporal.PlainDateTime.compare(to, from) < 0;
  }
  return false;
}

/** Looks for likely mistakes in an event block: `spec` is the block's
 * fields as written, `event` what parseEventSpec made of them. */
export function checkEvent(
  spec: Record<string, unknown>,
  event: EventSpec
): EventProblems {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isSet = (field: string): boolean =>
    spec[field] !== undefined && spec[field] !== null;

  if (event.start === undefined) {
    // FullCalendar also reads `date` as the start, and recurring events
    // have none.
    if (!isSet("date") && !RecurrenceFields.some(isSet)) {
      errors.push("No start, so this event can't appear on any calendar.");
    }
  } else if (!CalendarIsoPattern.test(event.start)) {
    errors.push(
      `Can't read start "${event.start}" as a date, so this event can't appear on any calendar.`
    );
  }

  for (const field of Object.keys(spec)) {
    if (KnownFields.includes(field)) {
      continue;
    }
    const suggestion = suggestField(field);
    if (suggestion !== undefined) {
      warnings.push(`Unknown field "${field}": did you mean "${suggestion}"?`);
    }
  }

  // The cases parseEventSpec gives the default title.
  if (!isSet("title") || spec.title === "") {
    warnings.push(`No title, so this event is shown as "${event.title}".`);
  }

  if (
    event.start !== undefined &&
    event.end !== undefined &&
    endsBeforeStart(event.start, event.end)
  ) {
    warnings.push(
      `end (${event.end}) is before start (${event.start}), so calendars ignore the end.`
    );
  }

  if (!event.allDay) {
    const zoneOnlyOn = isSet("startTimeZone") !== isSet("endTimeZone")
      ? isSet("startTimeZone")
        ? { set: "startTimeZone", other: "end" }
        : { set: "endTimeZone", other: "start" }
      : undefined;
    if (zoneOnlyOn && isSet(zoneOnlyOn.other)) {
      const fallback =
        event.timeZone === undefined
          ? "the itinerary's time zone"
          : `timeZone (${event.timeZone})`;
      warnings.push(
        `Only ${zoneOnlyOn.set} is set, so ${zoneOnlyOn.other} is read in ${fallback}.`
      );
    }
  }

  return { errors, warnings };
}
