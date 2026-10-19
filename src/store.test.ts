import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { EventStore, EventSubscriber } from "./store";
import { EventSpec } from "./types";

function event(title: string): EventSpec {
  return {
    title,
    backgroundColor: "blue",
    borderColor: "blue",
    textColor: "white",
  };
}

function subscriber(sourcePaths: string[]): EventSubscriber & {
  onEventsChanged: Mock;
} {
  return { sourcePaths, onEventsChanged: vi.fn(), renameSource: vi.fn() };
}

describe("EventStore", () => {
  let contents: Record<string, EventSpec[]>;
  let read: Mock<(path: string) => Promise<EventSpec[]>>;
  let store: EventStore;

  beforeEach(() => {
    contents = { "a.md": [event("A")], "b.md": [event("B")] };
    read = vi.fn((path: string) => Promise.resolve(contents[path] ?? []));
    store = new EventStore(read);
  });

  test("gathers events from every requested document", async () => {
    const events = await store.getEvents(["a.md", "b.md"]);
    expect(events.map((e) => e.title)).toEqual(["A", "B"]);
  });

  test("reads each document once", async () => {
    await store.getEvents(["a.md"]);
    await store.getEvents(["a.md"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("re-reads a cached document when it changes", async () => {
    await store.getEvents(["a.md"]);
    contents["a.md"] = [event("A2")];
    await store.refresh("a.md");
    const events = await store.getEvents(["a.md"]);
    expect(events.map((e) => e.title)).toEqual(["A2"]);
  });

  test("notifies only subscribers depending on the changed document", async () => {
    const onA = subscriber(["a.md"]);
    const onB = subscriber(["b.md"]);
    store.subscribe(onA);
    store.subscribe(onB);

    await store.refresh("a.md");

    expect(onA.onEventsChanged).toHaveBeenCalledTimes(1);
    expect(onB.onEventsChanged).not.toHaveBeenCalled();
  });

  test("ignores changes to documents nobody uses", async () => {
    await store.refresh("c.md");
    expect(read).not.toHaveBeenCalled();
  });

  test("stops notifying an unsubscribed subscriber", async () => {
    const onA = subscriber(["a.md"]);
    const unsubscribe = store.subscribe(onA);
    unsubscribe();

    await store.getEvents(["a.md"]);
    await store.refresh("a.md");

    expect(onA.onEventsChanged).not.toHaveBeenCalled();
  });

  test("forgets a deleted document and notifies its dependents", async () => {
    const onA = subscriber(["a.md"]);
    store.subscribe(onA);
    await store.getEvents(["a.md"]);

    store.forget("a.md");

    expect(onA.onEventsChanged).toHaveBeenCalledTimes(1);
    await store.getEvents(["a.md"]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("moves a renamed document's events and tells its dependents", async () => {
    const renamed: [string, string][] = [];
    let paths = ["a.md"];
    const onA = {
      get sourcePaths() {
        return paths;
      },
      onEventsChanged: vi.fn(),
      renameSource(oldPath: string, newPath: string) {
        renamed.push([oldPath, newPath]);
        paths = [newPath];
      },
    };
    store.subscribe(onA);
    await store.getEvents(["a.md"]);

    store.rename("a.md", "trips/a.md");

    expect(renamed).toEqual([["a.md", "trips/a.md"]]);
    expect(onA.onEventsChanged).toHaveBeenCalledTimes(1);
    const events = await store.getEvents(["trips/a.md"]);
    expect(events.map((e) => e.title)).toEqual(["A"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("drops a cached document nobody uses any more instead of re-reading it", async () => {
    await store.getEvents(["a.md"]);
    await store.refresh("a.md");
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("keeps a newer read when an older one fails", async () => {
    const reads: { resolve: (e: EventSpec[]) => void; reject: (e: Error) => void }[] = [];
    store = new EventStore(
      () => new Promise<EventSpec[]>((resolve, reject) => reads.push({ resolve, reject }))
    );
    store.subscribe(subscriber(["a.md"]));
    const first = store.getEvents(["a.md"]);
    const refreshing = store.refresh("a.md");
    reads[1].resolve([event("Newer")]);
    await refreshing;
    reads[0].reject(new Error("stale"));
    await expect(first).rejects.toThrow("stale");

    const events = await store.getEvents(["a.md"]);
    expect(events.map((e) => e.title)).toEqual(["Newer"]);
    expect(reads).toHaveLength(2);
  });

  test("retries a read that failed", async () => {
    read.mockRejectedValueOnce(new Error("busy"));
    await expect(store.getEvents(["a.md"])).rejects.toThrow("busy");
    const events = await store.getEvents(["a.md"]);
    expect(events.map((e) => e.title)).toEqual(["A"]);
  });
});

describe("EventStore.scheduleRefresh", () => {
  let contents: Record<string, EventSpec[]>;
  let read: Mock<(path: string) => Promise<EventSpec[]>>;
  let store: EventStore;

  beforeEach(() => {
    vi.useFakeTimers();
    contents = { "a.md": [event("A")] };
    read = vi.fn((path: string) => Promise.resolve(contents[path] ?? []));
    store = new EventStore(read, 1000);
  });

  afterEach(() => {
    store.dispose();
    vi.useRealTimers();
  });

  test("refreshes once after a burst of changes", async () => {
    const onA = subscriber(["a.md"]);
    store.subscribe(onA);

    store.scheduleRefresh("a.md");
    vi.advanceTimersByTime(500);
    store.scheduleRefresh("a.md");
    vi.advanceTimersByTime(500);
    store.scheduleRefresh("a.md");
    expect(read).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(read).toHaveBeenCalledTimes(1);
    expect(onA.onEventsChanged).toHaveBeenCalledTimes(1);
  });

  test("refreshes every document changed during the burst", async () => {
    store.subscribe(subscriber(["a.md", "b.md"]));

    store.scheduleRefresh("a.md");
    store.scheduleRefresh("b.md");
    await vi.advanceTimersByTimeAsync(1000);

    expect(read.mock.calls.map(([path]) => path).sort()).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  test("ignores documents nobody uses", async () => {
    store.scheduleRefresh("c.md");
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
  });

  test("tells dependents about a refresh whose read failed", async () => {
    const onA = subscriber(["a.md"]);
    store.subscribe(onA);
    read.mockRejectedValueOnce(new Error("busy"));

    store.scheduleRefresh("a.md");
    await vi.advanceTimersByTimeAsync(1000);

    expect(onA.onEventsChanged).toHaveBeenCalledTimes(1);
  });

  test("cancels a pending refresh when disposed", async () => {
    store.subscribe(subscriber(["a.md"]));
    store.scheduleRefresh("a.md");
    store.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
  });
});
