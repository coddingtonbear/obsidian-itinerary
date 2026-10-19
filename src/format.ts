import { Temporal } from "temporal-polyfill";

import { EventSpec } from "./types";

export interface FormatOptions {
  /** Defaults to the system locale. */
  locale?: string;
  /** The zone to show times without one of their own in; defaults to the
   * system's. */
  timeZone?: string;
}

const DateFormat: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
};

const DateTimeFormat: Intl.DateTimeFormatOptions = {
  ...DateFormat,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

/** The time-of-day part of DateTimeFormat. */
const TimeFormat: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

function parseDate(time: string | undefined): Temporal.PlainDate | null {
  if (time === undefined) {
    return null;
  }
  try {
    return Temporal.PlainDate.from(time);
  } catch {
    return null;
  }
}

/** Reads an ISO time as an instant shown in `zone`. A time without an
 * offset is taken as wall-clock time in `zone`. */
function parseTime(
  time: string | undefined,
  zone: string
): Temporal.ZonedDateTime | null {
  if (time === undefined) {
    return null;
  }
  try {
    return Temporal.Instant.from(time).toZonedDateTimeISO(zone);
  } catch {
    // No offset; read it as wall-clock time below.
  }
  try {
    return Temporal.PlainDateTime.from(time).toZonedDateTime(zone);
  } catch {
    return null;
  }
}

/** Describes when an event takes place, for display beside its title.
 *
 * Times are shown in the zone they were written in (`startTimeZone` or
 * `endTimeZone`, falling back to `timeZone`), so a flight reads in the
 * local time at each end, matching how the event was entered. */
export function describeEventTime(
  event: EventSpec,
  { locale, timeZone }: FormatOptions = {}
): string {
  if (event.allDay) {
    const start = parseDate(event.start);
    // FullCalendar treats an all-day event's end date as exclusive (an
    // event ending on the 4th is drawn through the 3rd), so describe the
    // last day it is actually shown on.
    const end = parseDate(event.end)?.subtract({ days: 1 }) ?? null;
    if (!start) {
      return "All day";
    }
    const startText = start.toLocaleString(locale, DateFormat);
    if (!end || Temporal.PlainDate.compare(end, start) <= 0) {
      return `${startText} (all day)`;
    }
    return `${startText} - ${end.toLocaleString(locale, DateFormat)} (all day)`;
  }

  const localZone = timeZone ?? Temporal.Now.timeZoneId();
  const start = parseTime(
    event.start,
    event.startTimeZone ?? event.timeZone ?? localZone
  );
  const end = parseTime(
    event.end,
    event.endTimeZone ?? event.timeZone ?? localZone
  );
  const first = start ?? end;
  if (!first) {
    return "";
  }
  const firstText = first.toLocaleString(locale, DateTimeFormat);
  if (!start || !end || start.equals(end)) {
    return firstText;
  }
  // Leave the date off the end of a range that finishes the same day, in
  // the same zone, as it began.
  const sameDay =
    start.timeZoneId === end.timeZoneId &&
    start.toPlainDate().equals(end.toPlainDate());
  return `${firstText} - ${end.toLocaleString(
    locale,
    sameDay ? TimeFormat : DateTimeFormat
  )}`;
}
