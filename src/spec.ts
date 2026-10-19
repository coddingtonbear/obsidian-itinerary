import { CalendarOptions } from "fullcalendar";
import { parseYaml } from "obsidian";

import { TranslatedOptions, translateLegacyOptions } from "./compat";
import { ItinerarySpec } from "./types";
import { errorMessage, isRecord, readBooleanValue } from "./util";

/** Reads the `source` option into a list of source strings.
 *
 * An unquoted `[[My Note]]` is valid YAML -- a list containing a list
 * containing "My Note" -- so a one-item nested list is read back as the
 * link it was meant to be rather than rejected. */
export function normalizeSources(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    // `- [[My Note]]` in a block list nests one level deeper still.
    let unwrapped: unknown = item;
    while (Array.isArray(unwrapped) && unwrapped.length === 1) {
      unwrapped = unwrapped[0];
    }
    if (unwrapped !== item && typeof unwrapped === "string") {
      return `[[${unwrapped}]]`;
    }
    throw new Error(
      'Itinerary option "source" must be a note link (e.g. "[[My Note]]"), a path, or a list of them.'
    );
  });
}

function normalizeFilters(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  const items: unknown[] = Array.isArray(value) ? value : [value];
  return items.map((item) => {
    if (typeof item !== "string") {
      throw new Error(
        'Itinerary option "filter" must be an expression or a list of expressions.'
      );
    }
    return item;
  });
}

/** Parses the YAML body of an `itinerary` block. */
export function parseItinerarySpec(text: string): ItinerarySpec {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    throw new Error(`Could not parse itinerary spec: ${errorMessage(e)}`);
  }
  const spec = parsed ?? {};
  if (!isRecord(spec)) {
    throw new Error(
      "Could not parse itinerary spec: expected a set of `key: value` options."
    );
  }

  const { source, filter, debug, ...calendarOptions } = spec;
  const debugFlag =
    debug === undefined || debug === null ? false : readBooleanValue(debug);
  if (debugFlag === null) {
    throw new Error('Itinerary option "debug" must be true or false.');
  }

  return {
    // Everything else is passed through to FullCalendar, which validates
    // its own options (and warns about ones it doesn't recognise).
    ...(calendarOptions as CalendarOptions),
    source: normalizeSources(source),
    filter: normalizeFilters(filter),
    debug: debugFlag,
  };
}

/** The FullCalendar options in an itinerary spec, without the options only
 * this plugin understands (which FullCalendar would warn about), and with
 * options written for FullCalendar 5 and 6 translated for FullCalendar 7. */
export function getCalendarOptions(spec: ItinerarySpec): TranslatedOptions {
  const { source, filter, debug, ...calendarOptions } = spec;
  return translateLegacyOptions(calendarOptions);
}
