import { DateTime } from "luxon";

import { EventSpec } from "./types";

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
    const end = parseTime(event.end, undefined);
    const first = start ?? end;
    if (!first) {
      return "All day";
    }
    if (!start || !end || start.equals(end)) {
      return `${first.toLocaleString(DateTime.DATE_FULL)} (all day)`;
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
  return `${start.toLocaleString(
    DateTime.DATETIME_FULL
  )} - ${end.toLocaleString(DateTime.DATETIME_FULL)}`;
}
