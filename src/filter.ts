import { compileExpression } from "filtrex";

import { EventSpec } from "./types";
import { getArrayForArrayOrObject } from "./util";

/** Whether an event matched, and if it couldn't be evaluated, why not. */
export interface FilterResult {
  matched: boolean;
  error?: string;
}

export type EventFilter = (evt: EventSpec) => FilterResult;

function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return "a list";
  }
  if (value === undefined || value === null) {
    return "nothing";
  }
  return typeof value === "string" ? "text" : `a ${typeof value}`;
}

/** Orders two numbers or two strings.
 *
 * Filtrex 3 compares only numbers, but filters commonly compare ISO dates
 * (`start >= "2021-11-01"`), which filtrex 2 allowed; such strings sort in
 * date order. */
function compare(a: unknown, b: unknown): number {
  if (
    (typeof a === "number" && typeof b === "number") ||
    (typeof a === "string" && typeof b === "string")
  ) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  throw new TypeError(
    `Cannot compare ${describeType(a)} with ${describeType(b)}.`
  );
}

/** Treats a one-item list as its item, so `tag == "hotel"` matches an
 * event with the single tag `hotel` now that tags are always lists. */
function unwrapSingle(value: unknown): unknown {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

const operators = {
  "==": (a: unknown, b: unknown) => unwrapSingle(a) === unwrapSingle(b),
  "!=": (a: unknown, b: unknown) => unwrapSingle(a) !== unwrapSingle(b),
  "<": (a: unknown, b: unknown) => compare(a, b) < 0,
  "<=": (a: unknown, b: unknown) => compare(a, b) <= 0,
  ">": (a: unknown, b: unknown) => compare(a, b) > 0,
  ">=": (a: unknown, b: unknown) => compare(a, b) >= 0,
};

/** Reads a property, treating one the object lacks as `undefined`. */
function readOptionalProperty(
  name: string,
  get: (name: string) => unknown,
  obj: unknown
): unknown {
  if (
    typeof obj !== "object" ||
    obj === null ||
    !Object.prototype.hasOwnProperty.call(obj, name)
  ) {
    return undefined;
  }
  return get(name);
}

/** Compiles a filtrex expression into a predicate over events.
 *
 * Filtrex reports runtime failures (an unknown function, a value of the
 * wrong type) by returning an `Error` rather than throwing one; such an
 * event is treated as not matching, with the error kept for debug output,
 * rather than letting the truthy error object through.
 *
 * Event properties are optional, so a property an event lacks reads as
 * `undefined` (filtrex 2's behaviour) instead of filtrex 3's default of an
 * "unknown property" error. Filtrex 3 is also strict about operand types,
 * so the fields filters most often test are given their natural empty
 * values: `tag` is always a list and `allDay`/`hidden` are always
 * booleans. Without that, `not allDay` or `"hotel" not in tag` would never
 * match an event that leaves those fields out. */
export function compileFilter(expression: string): EventFilter {
  const compiled = compileExpression(expression, {
    customProp: readOptionalProperty,
    operators,
  });
  return (evt: EventSpec): FilterResult => {
    const result: unknown = compiled({
      ...evt,
      tag: getArrayForArrayOrObject(evt.tag),
      allDay: evt.allDay ?? false,
      hidden: evt.hidden ?? false,
    });
    if (result instanceof Error) {
      return { matched: false, error: result.message };
    }
    return { matched: Boolean(result) };
  };
}
