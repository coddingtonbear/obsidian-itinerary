/** A value FullCalendar sorts events by: its compare object for an event
 * holds the event's extended props, which is where `order` ends up. */
interface Sortable {
  order?: unknown;
}

function readOrder(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sorts events by their `order`: lowest first, and events without one
 * after every event that has one. FullCalendar's own field comparison can't
 * be used for this: it treats `0` and a missing value as equal. */
export function compareByOrder(a: Sortable, b: Sortable): number {
  const first = readOrder(a.order);
  const second = readOrder(b.order);
  if (first === null || second === null) {
    return first === second ? 0 : first === null ? 1 : -1;
  }
  return first - second;
}

/** The order events are drawn in within a day unless an itinerary sets its
 * own `eventOrder`: by `order`, then FullCalendar's default. */
export const DefaultEventOrder: readonly (
  | string
  | ((a: Sortable, b: Sortable) => number)
)[] = [
  compareByOrder,
  "start",
  "-duration",
  "allDay",
  "title",
];
