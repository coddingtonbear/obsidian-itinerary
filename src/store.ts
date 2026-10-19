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
  private pendingRefreshes = new Set<DocumentPath>();
  private refreshTimer: number | null = null;

  /** @param refreshDelay How long `scheduleRefresh` waits for changes to
   * stop before re-reading, in milliseconds. */
  constructor(
    private readonly read: EventReader,
    private readonly refreshDelay = 1000
  ) {}

  /** Re-reads a changed document once it has stopped changing.
   *
   * Obsidian saves every couple of seconds while a note is being typed in;
   * redrawing every dependent calendar on each save is wasted work. */
  scheduleRefresh(path: DocumentPath): void {
    if (!this.events.has(path) && this.dependentsOf(path).length === 0) {
      return;
    }
    this.pendingRefreshes.add(path);
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      const paths = [...this.pendingRefreshes];
      this.pendingRefreshes.clear();
      for (const pending of paths) {
        // A failed read has already been reported to the dependents, which
        // show it when they re-request their events.
        this.refresh(pending).catch(() => undefined);
      }
    }, this.refreshDelay);
  }

  /** Cancels any scheduled refresh. */
  dispose(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.pendingRefreshes.clear();
  }

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
    try {
      await this.load(path);
    } finally {
      // Tell dependents even if the read failed: they re-request their
      // events, which retries the read and shows its error.
      for (const subscriber of dependents) {
        subscriber.onEventsChanged();
      }
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
