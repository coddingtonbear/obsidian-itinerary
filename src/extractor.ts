import { parseYaml } from "obsidian";
import { EventSpec } from "./types";
import { DateTime } from "luxon";

const DefaultTextColor = "white";
const DefaultColor = "blue";

export function getEventInformation(fileData: string): EventSpec[] {
  const matcher = /```itinerary-event\n([^`]*)\n```/g;
  const matches: EventSpec[] = [];
  let match;

  do {
    match = matcher.exec(fileData);
    if (match) {
      try {
        matches.push(parseEventSpec(match[1]));
      } catch (e) {
        // Although you're probably tempted to raise an error here, it
        // won't help you -- this isn't called from within a render loop.
      }
    }
  } while (match);

  return matches;
}

export function parseEventSpec(eventSpec: string): EventSpec {
  const parsed = parseYaml(eventSpec);

  // Apply timezones to start/end times if provided
  if (!parsed.allDay) {
    if (parsed.start && (parsed.startTimeZone || parsed.timeZone)) {
      parsed.start = DateTime.fromISO(parsed.start, {
        zone: parsed.startTimeZone || parsed.timeZone,
      }).toISO();
    }
    if (parsed.end && (parsed.endTimeZone || parsed.timeZone)) {
      parsed.end = DateTime.fromISO(parsed.end, {
        zone: parsed.endTimeZone || parsed.timeZone,
      }).toISO();
    }
  }

  if (!parsed.backgroundColor) {
    parsed.backgroundColor = parsed.color ?? DefaultColor;
  }
  if (!parsed.borderColor) {
    parsed.borderColor = parsed.color ?? DefaultColor;
  }
  if (!parsed.textColor) {
    parsed.textColor = DefaultTextColor;
  }
  if (!parsed.title) {
    parsed.title = "Untitled Event";
  }

  return parsed;
}
