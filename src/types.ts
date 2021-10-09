import { EventInput, CalendarOptions } from "@fullcalendar/core";

export type DocumentPath = string;

export interface ItinerarySpec extends CalendarOptions {
  source?: string | string[];
  filter?: string | string[];
  debug?: boolean;
}

// See https://fullcalendar.io/docs/event-parsing for details
export interface EventSpec extends EventInput {
  tag?: string | string[];
  timeZone?: string;
  start?: string;
  startTimeZone?: string;
  end?: string;
  endTimeZone?: string;
  hidden?: boolean;
  title: string;
  backgoundColor: string;
  textColor: string;
}
