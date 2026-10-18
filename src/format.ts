import { DateTime } from "luxon";

import { EventSpec } from "./types";

/** The time-of-day part of DateTime.DATETIME_FULL. */
const TimeWithZone: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

function parseTime(time: string | undefined, zone: string | undefined) {
  if (time === undefined) {
    return null;
  }
  const parsed = DateTime.fromISO(time);
  if (!parsed.isValid) {
    return null;
  }
  return zone ? parsed.setZone(zone) : parsed;
}

/** Describes when an event takes place, for display beside its title.
 *
 * Times are shown in the zone they were written in (`startTimeZone` or
 * `endTimeZone`, falling back to `timeZone`), so a flight reads in the
 * local time at each end, matching how the event was entered. */
export function describeEventTime(event: EventSpec): string {
  if (event.allDay) {
    const start = parseTime(event.start, undefined);
    // FullCalendar treats an all-day event's end date as exclusive (an
    // event ending on the 4th is drawn through the 3rd), so describe the
    // last day it is actually shown on.
    const end = parseTime(event.end, undefined)?.minus({ days: 1 }) ?? null;
    if (!start) {
      return "All day";
    }
    if (!end || end <= start) {
      return `${start.toLocaleString(DateTime.DATE_FULL)} (all day)`;
    }
    return `${start.toLocaleString(DateTime.DATE_FULL)} - ${end.toLocaleString(
      DateTime.DATE_FULL
    )} (all day)`;
  }

  const start = parseTime(event.start, event.startTimeZone ?? event.timeZone);
  const end = parseTime(event.end, event.endTimeZone ?? event.timeZone);
  const first = start ?? end;
  if (!first) {
    return "";
  }
  if (!start || !end || start.equals(end)) {
    return first.toLocaleString(DateTime.DATETIME_FULL);
  }
  // Leave the date off the end of a range that finishes the same day, in
  // the same zone, as it began.
  const sameDay =
    start.hasSame(end, "day") && start.zoneName === end.zoneName;
  return `${start.toLocaleString(DateTime.DATETIME_FULL)} - ${end.toLocaleString(
    sameDay ? TimeWithZone : DateTime.DATETIME_FULL
  )}`;
}
