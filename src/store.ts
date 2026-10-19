import { DocumentPath, EventSpec } from "./types";

/** Loads the events found in the document at a path. */
export type EventReader = (path: DocumentPath) => Promise<EventSpec[]>;

/** Something displaying events from a set of documents. */
export interface EventSubscriber {
  readonly sourcePaths: readonly DocumentPath[];
  onEventsChanged(): void;
  /** A document this subscriber displays was renamed or moved. */
  renameSource(oldPath: DocumentPath, newPath: DocumentPath): void;
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
    this.events.delete(path);
    if (dependents.length === 0) {
      // Nothing shows it any more; it is read again if something does.
      return;
    }
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

  /** Re-reads every document a subscriber shows that came back empty or
   * failed, e.g. once the vault has finished loading and notes that weren't
   * there yet may be. Sources that loaded are left alone. */
  async refreshAll(): Promise<void> {
    const paths = new Set(
      [...this.subscribers].flatMap((subscriber) => subscriber.sourcePaths)
    );
    await Promise.all(
      [...paths].map(async (path) => {
        const cached = this.events.get(path);
        const loaded = cached
          ? await cached.catch(() => null)
          : null;
        if (loaded === null || loaded.length === 0) {
          await this.refresh(path).catch(() => undefined);
        }
      })
    );
  }

  /** Follows a document that was renamed or moved: its cached events move
   * with it, and subscribers displaying it switch to the new path. */
  rename(oldPath: DocumentPath, newPath: DocumentPath): void {
    const events = this.events.get(oldPath);
    this.events.delete(oldPath);
    this.events.delete(newPath);
    if (events) {
      this.events.set(newPath, events);
    }
    // An edit waiting to be read follows the note.
    if (this.pendingRefreshes.delete(oldPath)) {
      this.pendingRefreshes.add(newPath);
    }
    const moved = this.dependentsOf(oldPath);
    for (const subscriber of moved) {
      subscriber.renameSource(oldPath, newPath);
    }
    // Includes subscribers waiting for a note at the new path: Obsidian
    // makes a note by creating "Untitled.md" and renaming it, which fires
    // `rename` but no `create` for the path it ends up at.
    for (const subscriber of this.dependentsOf(newPath)) {
      subscriber.onEventsChanged();
    }
  }

  /** Drops a document that was deleted. */
  forget(path: DocumentPath): void {
    // Notify even if nothing was cached: a failed read isn't, and its
    // dependents should stop showing that error.
    this.events.delete(path);
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
      const loading: Promise<EventSpec[]> = this.read(path).catch(
        (error: unknown) => {
          // Don't cache a failure; the next request should try again. A
          // refresh may have replaced this read with a newer one already,
          // and a rename may have moved it to another path.
          for (const [cachedPath, cached] of this.events) {
            if (cached === loading) {
              this.events.delete(cachedPath);
            }
          }
          throw error;
        }
      );
      events = loading;
      this.events.set(path, events);
    }
    return events;
  }
}
