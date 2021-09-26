import { parseYaml } from "obsidian";
import { EventSpec } from "./types";

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
        // Nothing
      }
    }
  } while (match);

  return matches;
}

export function parseEventSpec(eventSpec: string): EventSpec {
  const event: unknown = parseYaml(eventSpec);

  return event;
}
