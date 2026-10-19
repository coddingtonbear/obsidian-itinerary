import { CalendarOptions } from "fullcalendar";
import { parseYaml } from "obsidian";

import { TranslatedOptions, translateLegacyOptions } from "./compat";
import { DefaultEventOrder } from "./order";
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

  const { source, filter, debug, rules, ...calendarOptions } = spec;

  return {
    // Everything else is passed through to FullCalendar, which validates
    // its own options (and warns about ones it doesn't recognise).
    ...(calendarOptions as CalendarOptions),
    source: normalizeSources(source),
    filter: normalizeFilters(filter),
    debug: readFlag("debug", debug, false),
    rules: readFlag("rules", rules, true),
  };
}

function readFlag(name: string, value: unknown, fallback: boolean): boolean {
  const flag =
    value === undefined || value === null ? fallback : readBooleanValue(value);
  if (flag === null) {
    throw new Error(`Itinerary option "${name}" must be true or false.`);
  }
  return flag;
}

/** The FullCalendar options in an itinerary spec, without the options only
 * this plugin understands (which FullCalendar would warn about), and with
 * options written for FullCalendar 5 and 6 translated for FullCalendar 7.
 *
 * Events are ordered by their `order` and drawn strictly in that order,
 * unless the itinerary sets `eventOrder` or `eventOrderStrict` itself, in
 * which case its own setting wins. */
export function getCalendarOptions(spec: ItinerarySpec): TranslatedOptions {
  const { source, filter, debug, rules, ...calendarOptions } = spec;
  const translated = translateLegacyOptions(calendarOptions);
  const options: CalendarOptions = { ...translated.options };
  if (options.eventOrder === undefined) {
    // FullCalendar's parser takes a list mixing field names and compare
    // functions (`parseFieldSpecs`), though its types only allow one kind.
    options.eventOrder =
      DefaultEventOrder as unknown as CalendarOptions["eventOrder"];
  }
  if (options.eventOrderStrict === undefined) {
    options.eventOrderStrict = true;
  }
  return { options, notes: translated.notes };
}
