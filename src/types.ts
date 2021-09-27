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
  start?: string;
  end?: string;
  hidden?: boolean;
}
