import { CalendarOptions, EventInput } from "fullcalendar";

export type DocumentPath = string;

export interface ItinerarySpec extends CalendarOptions {
  source?: string | string[];
  filter?: string | string[];
  debug?: boolean;
  /** Whether the vault's event rules apply to this itinerary's events. */
  rules?: boolean;
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
  /** Sorts events within a day: lowest first, unordered events last. */
  order?: number;
  title: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
}
