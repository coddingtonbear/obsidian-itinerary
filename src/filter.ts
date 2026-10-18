import { compileExpression } from "filtrex";

import { EventSpec } from "./types";
import { getArrayForArrayOrObject } from "./util";

export type EventFilter = (evt: EventSpec) => boolean;

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
 * event is treated as not matching rather than letting the truthy error
 * object through.
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
  });
  return (evt: EventSpec): boolean => {
    const result: unknown = compiled({
      ...evt,
      tag: getArrayForArrayOrObject(evt.tag),
      allDay: evt.allDay ?? false,
      hidden: evt.hidden ?? false,
    });
    return !(result instanceof Error) && Boolean(result);
  };
}
