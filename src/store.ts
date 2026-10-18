import { DocumentPath, EventSpec } from "./types";

/** Loads the events found in the document at a path. */
export type EventReader = (path: DocumentPath) => Promise<EventSpec[]>;

/** Something displaying events from a set of documents. */
export interface EventSubscriber {
  readonly sourcePaths: readonly DocumentPath[];
  onEventsChanged(): void;
}

/** Caches the events found in each document and tells subscribers when the
 * events in a document they display have changed. */
export class EventStore {
  private events = new Map<DocumentPath, Promise<EventSpec[]>>();
  private subscribers = new Set<EventSubscriber>();

  constructor(private readonly read: EventReader) {}

  /** Registers a subscriber; returns a function that unregisters it. */
  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /** Returns the events found in the given documents, loading any that
   * aren't cached yet. */
  async getEvents(paths: readonly DocumentPath[]): Promise<EventSpec[]> {
    const perSource = await Promise.all(paths.map((path) => this.load(path)));
    return perSource.flat();
  }

  /** Re-reads a document that has changed, if anything depends on it. */
  async refresh(path: DocumentPath): Promise<void> {
    const dependents = this.dependentsOf(path);
    if (!this.events.has(path) && dependents.length === 0) {
      return;
    }
    this.events.delete(path);
    await this.load(path);
    for (const subscriber of dependents) {
      subscriber.onEventsChanged();
    }
  }

  /** Drops a document that was deleted or renamed. */
  forget(path: DocumentPath): void {
    if (!this.events.delete(path)) {
      return;
    }
    for (const subscriber of this.dependentsOf(path)) {
      subscriber.onEventsChanged();
    }
  }

  private dependentsOf(path: DocumentPath): EventSubscriber[] {
    return [...this.subscribers].filter((subscriber) =>
      subscriber.sourcePaths.includes(path)
    );
  }

  private load(path: DocumentPath): Promise<EventSpec[]> {
    let events = this.events.get(path);
    if (!events) {
      events = this.read(path).catch((error: unknown) => {
        // Don't cache a failure; the next request should try again.
        this.events.delete(path);
        throw error;
      });
      this.events.set(path, events);
    }
    return events;
  }
}
