import { compileExpression } from "filtrex";

import { EventSpec } from "./types";

export type EventFilter = (evt: EventSpec) => boolean;

/** Compiles a filtrex expression into a predicate over events.
 *
 * Filtrex reports runtime failures (an unknown function, a value of the
 * wrong type) by returning an `Error` rather than throwing one; such an
 * event is treated as not matching rather than letting the truthy error
 * object through. */
export function compileFilter(expression: string): EventFilter {
  const compiled = compileExpression(expression);
  return (evt: EventSpec): boolean => {
    const result: unknown = compiled(evt);
    return !(result instanceof Error) && Boolean(result);
  };
}
