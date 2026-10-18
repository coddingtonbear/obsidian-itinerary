/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "require", "default"]}
 */
// jsdom's default "browser" export condition picks the ESM builds of
// FullCalendar's dependencies, which Jest's CommonJS runtime can't load.
import { parseEventSpec } from "./extractor";
import { ItineraryRenderer, renderEvent } from "./render";
import { EventStore } from "./store";
import { EventSpec, ItinerarySpec } from "./types";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
}

function event(fields: Partial<EventSpec>): EventSpec {
  return {
    title: "Event",
    backgroundColor: "blue",
    borderColor: "blue",
    textColor: "white",
    ...fields,
  };
}

/** Waits for pending promise callbacks (the renderer's async refresh). */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("renderEvent", () => {
  test("shows the title, time and tags", () => {
    const el = document.createElement("div");
    renderEvent(
      el,
      event({
        title: "Parade",
        allDay: true,
        start: "2021-11-01",
        tag: ["outing", "festival"],
        backgroundColor: "red",
      })
    );

    expect(el.querySelector(".name")?.textContent).toBe("Parade");
    expect(el.querySelector(".date")?.textContent).toMatch(/\(all day\)$/);
    expect(
      Array.from(el.querySelectorAll(".tag")).map((t) => t.textContent)
    ).toEqual(["outing", "festival"]);
    const chip = el.querySelector<HTMLElement>(".itinerary-event");
    expect(chip?.style.getPropertyValue("--itinerary-event-background")).toBe(
      "red"
    );
  });

  test("renders titles as text, not markup", () => {
    const el = document.createElement("div");
    renderEvent(el, event({ title: "<b>bold</b>" }));
    expect(el.querySelector("b")).toBeNull();
    expect(el.querySelector(".name")?.textContent).toBe("<b>bold</b>");
  });

  test("renders nothing for a hidden event", () => {
    const el = document.createElement("div");
    renderEvent(el, event({ hidden: true }));
    expect(el.childElementCount).toBe(0);
  });
});

describe("ItineraryRenderer", () => {
  let contents: Record<string, EventSpec[]>;
  let store: EventStore;
  let el: HTMLElement;

  const listSpec: ItinerarySpec = {
    initialView: "listYear",
    initialDate: "2021-11-01",
  };

  function shownTitles(): string[] {
    return Array.from(el.querySelectorAll(".fc-list-event-title")).map(
      (title) => title.textContent ?? ""
    );
  }

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    window.ResizeObserver = FakeResizeObserver;
    contents = {
      "trip.md": [
        event({ title: "Hotel", start: "2021-11-01T15:00", tag: "hotel" }),
        event({ title: "Parade", start: "2021-11-02T12:00" }),
      ],
    };
    store = new EventStore((path) => Promise.resolve(contents[path] ?? []));
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  test("shows the events from its sources", async () => {
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    expect(shownTitles()).toEqual(["Hotel", "Parade"]);
    renderer.unload();
  });

  test("shows a date-only event as all-day", async () => {
    contents["trip.md"] = [
      parseEventSpec("title: Oaxaca\nstart: 2021-10-31\nend: 2021-11-04"),
    ];
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    const times = Array.from(el.querySelectorAll(".fc-list-event-time")).map(
      (time) => time.textContent
    );
    expect(times).toEqual(["all-day", "all-day", "all-day", "all-day"]);
    renderer.unload();
  });

  test("explains why an event failed a filter in debug output", async () => {
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, debug: true, filter: ["title > 2"] },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-debug")?.textContent).toMatch(
      /Event 'Hotel' failed filter #0: .+/
    );
    renderer.unload();
  });

  test("shows only events matching its filters", async () => {
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, filter: ['"hotel" not in tag'] },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(shownTitles()).toEqual(["Parade"]);
    renderer.unload();
  });

  test("updates when a source changes", async () => {
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    contents["trip.md"] = [event({ title: "Flight", start: "2021-11-03T09:00" })];
    await store.refresh("trip.md");
    await settle();

    expect(shownTitles()).toEqual(["Flight"]);
    renderer.unload();
  });

  test("keeps the newest events when refreshes finish out of order", async () => {
    const reads: ((events: EventSpec[]) => void)[] = [];
    store = new EventStore(
      () => new Promise<EventSpec[]>((resolve) => reads.push(resolve))
    );
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();

    // A change arrives while the first read is still in flight, and its
    // read finishes first.
    const refreshing = store.refresh("trip.md");
    reads[1]([event({ title: "Newer", start: "2021-11-03T09:00" })]);
    await refreshing;
    await settle();
    reads[0]([event({ title: "Older", start: "2021-11-03T09:00" })]);
    await settle();

    expect(shownTitles()).toEqual(["Newer"]);
    renderer.unload();
  });

  test("stops listening and tears down when unloaded", async () => {
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();
    const refresh = jest.spyOn(renderer, "refresh");

    renderer.unload();
    await store.refresh("trip.md");

    expect(refresh).not.toHaveBeenCalled();
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
    expect(el.querySelector(".fc-list-event-title")).toBeNull();
  });

  test("shows an error when its events can't be loaded", async () => {
    store = new EventStore(() => Promise.reject(new Error("unreadable")));
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-error")?.textContent).toBe(
      "unreadable"
    );
    renderer.unload();
  });

  test("replaces its debug output on each refresh", async () => {
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, debug: true },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();
    await renderer.refresh();

    const debug = el.querySelectorAll(".itinerary-debug");
    expect(debug).toHaveLength(1);
    expect(debug[0].textContent).toContain("Event 'Hotel' passed all filters");
    renderer.unload();
  });

  test("rejects an invalid filter expression", () => {
    expect(
      () =>
        new ItineraryRenderer(el, { ...listSpec, filter: ["((("] }, [], store)
    ).toThrow();
  });
});
