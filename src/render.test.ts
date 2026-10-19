import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
// @vitest-environment jsdom
import { parseEventSpec } from "./extractor";
import { parseItinerarySpec } from "./spec";
import {
  EventSummaryRenderer,
  ItineraryRenderer,
  renderEvent,
  toEventInput,
} from "./render";
import { EventRule, RuleBook } from "./rules";
import { EventStore } from "./store";
import { EventSpec, ItinerarySpec } from "./types";

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

  test("follows the vault's event rules as they change", () => {
    const el = document.createElement("div");
    const book = new RuleBook();
    const summary = new EventSummaryRenderer(
      el,
      parseEventSpec("title: Nikko\ntag: hotel"),
      book
    );
    summary.load();
    const background = () =>
      el
        .querySelector<HTMLElement>(".itinerary-event")
        ?.style.getPropertyValue("--itinerary-event-background");
    expect(background()).toBe("");

    book.setRules([
      { name: "Hotels", when: '"hotel" in tag', set: { color: "brown" } },
    ]);
    expect(background()).toBe("brown");
    expect(el.querySelectorAll(".itinerary-event")).toHaveLength(1);

    summary.unload();
    book.setRules([]);
    expect(background()).toBe("brown");
  });

  test("keeps its tags and edit button together, to wrap as one", () => {
    const el = document.createElement("div");
    renderEvent(el, event({ tag: ["hotel"] }), () => undefined);
    const tags = el.querySelector(".tags");
    expect(tags?.parentElement).toBe(el.querySelector("button")?.parentElement);
    expect(tags?.parentElement).not.toBe(el.querySelector(".itinerary-event"));
  });

  test("has no edit button unless given something to call", () => {
    const el = document.createElement("div");
    renderEvent(el, event({}));
    expect(el.querySelector("button")).toBeNull();
  });

  test("calls onEdit from its edit button, keeping the click to itself", () => {
    const el = document.createElement("div");
    const outside = vi.fn();
    el.addEventListener("click", outside);
    el.addEventListener("mousedown", outside);
    const onEdit = vi.fn();
    renderEvent(el, event({}), onEdit);

    const button = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit event"]'
    );
    expect(button?.dataset.icon).toBe("pencil");
    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button?.click();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
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

  /** The list view's event rows. FullCalendar 7's class names are
   * generated, so rows are found through their ARIA roles. */
  function eventRows(): { time: string; title: string; color: string }[] {
    return Array.from(
      el.querySelectorAll('[role="list"][aria-label="Events"] > [role="listitem"]')
    ).map((row) => {
      const body = row.querySelector<HTMLElement>('[style*="--fc-event-color"]');
      const [time, title] = Array.from(body?.lastElementChild?.children ?? []);
      return {
        time: time?.textContent ?? "",
        title: title?.textContent ?? "",
        color: body?.style.getPropertyValue("--fc-event-color") ?? "",
      };
    });
  }

  function shownTitles(): string[] {
    return eventRows().map((row) => row.title);
  }

  beforeEach(() => {
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

    expect(eventRows().map((row) => row.time)).toEqual([
      "All-day",
      "All-day",
      "All-day",
      "All-day",
    ]);
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

  test("draws events in their color", async () => {
    contents["trip.md"] = [
      parseEventSpec("title: Flight\nstart: 2021-11-03T09:00\ncolor: green"),
    ];
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    expect(eventRows().map((row) => row.color)).toEqual(["green"]);
    renderer.unload();
  });

  test("leaves events without a color to the calendar's eventColor", async () => {
    contents["trip.md"] = [
      parseEventSpec("title: Plain\nstart: 2021-11-03T09:00"),
      parseEventSpec("title: Green\nstart: 2021-11-03T10:00\ncolor: green"),
    ];
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, eventColor: "purple" },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(eventRows().map((row) => [row.title, row.color])).toEqual([
      ["Plain", "purple"],
      ["Green", "green"],
    ]);
    renderer.unload();
  });

  test("orders a day's events by their order", async () => {
    contents["trip.md"] = [
      parseEventSpec("title: A\nstart: 2021-11-03\norder: 2"),
      parseEventSpec("title: B\nstart: 2021-11-03"),
      parseEventSpec("title: C\nstart: 2021-11-03\norder: 1"),
    ];
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    expect(shownTitles()).toEqual(["C", "A", "B"]);
    renderer.unload();
  });

  describe("with event rules", () => {
    const hotels: EventRule = {
      name: "Hotels",
      when: '"hotel" in tag',
      set: { color: "brown", order: -1 },
    };

    function render(spec: ItinerarySpec, book: RuleBook): ItineraryRenderer {
      const renderer = new ItineraryRenderer(
        el,
        spec,
        ["trip.md"],
        store,
        () => true,
        book
      );
      renderer.load();
      return renderer;
    }

    beforeEach(() => {
      contents["trip.md"] = [
        parseEventSpec("title: A Parade\nstart: 2021-11-03"),
        parseEventSpec("title: Nikko\nstart: 2021-11-03\ntag: hotel"),
      ];
    });

    test("colors and orders matching events", async () => {
      const renderer = render(listSpec, new RuleBook([hotels]));
      await settle();

      const rows = eventRows();
      expect(rows.map((row) => row.title)).toEqual(["Nikko", "A Parade"]);
      expect(rows[0].color).toBe("brown");
      expect(rows[1].color).not.toBe("brown");
      renderer.unload();
    });

    test("lets filters see what rules set", async () => {
      const renderer = render(
        { ...listSpec, filter: ['color == "brown"'] },
        new RuleBook([hotels])
      );
      await settle();

      expect(shownTitles()).toEqual(["Nikko"]);
      renderer.unload();
    });

    test("ignores rules in an itinerary with rules: false", async () => {
      const book = new RuleBook([hotels]);
      const renderer = render({ ...listSpec, rules: false, debug: true }, book);
      await settle();

      expect(shownTitles()).toEqual(["A Parade", "Nikko"]);
      expect(el.querySelector(".itinerary-debug")?.textContent).toMatch(
        /Event rules are off for this itinerary/
      );
      renderer.unload();
    });

    test("redraws when the rules change", async () => {
      const book = new RuleBook();
      const renderer = render(listSpec, book);
      await settle();
      expect(shownTitles()).toEqual(["A Parade", "Nikko"]);

      book.setRules([hotels]);
      await settle();
      expect(shownTitles()).toEqual(["Nikko", "A Parade"]);

      renderer.unload();
    });

    test("says which rules matched in debug output", async () => {
      const renderer = render(
        { ...listSpec, debug: true },
        new RuleBook([hotels, { name: "Broken", when: "((", set: {} }])
      );
      await settle();

      const debug = el.querySelector(".itinerary-debug")?.textContent ?? "";
      expect(debug).toMatch(
        /Event 'Nikko' matched rule 'Hotels', which set color, order/
      );
      expect(debug).toMatch(/Rule 'Broken' was skipped: .+/);
      renderer.unload();
    });
  });

  test("passes per-event classNames on as className", () => {
    expect(
      toEventInput(
        parseEventSpec("title: X\nclassNames:\n  - one\n  - two")
      ).className
    ).toBe("one two");
  });

  test("notes translated pre-7 options in debug output", async () => {
    const renderer = new ItineraryRenderer(
      el,
      // Parsed from YAML, as FullCalendar 7's option types don't know it.
      {
        ...listSpec,
        ...parseItinerarySpec("debug: true\nslotLabelFormat: h:mm"),
      },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-debug")?.textContent).toContain(
      "Option 'slotLabelFormat' is now called 'slotHeaderFormat'"
    );
    renderer.unload();
  });

  test("accepts luxon format strings, as version 1 did", async () => {
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, eventTimeFormat: "HH:mm" },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-error")).toBeNull();
    expect(eventRows().map((row) => row.time)).toEqual(["15:00", "12:00"]);
    renderer.unload();
  });

  test("labels view buttons with version 1's buttonText", async () => {
    const renderer = new ItineraryRenderer(
      el,
      parseItinerarySpec(
        [
          "initialView: listWeek",
          "initialDate: 2021-11-01",
          "headerToolbar:",
          "  start: dayGridMonth,listWeek",
          "  end: today",
          "buttonText:",
          "  today: Now",
          "  month: Mo",
          "  list: Agenda",
        ].join("\n")
      ),
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    const labels = Array.from(el.querySelectorAll("button")).map(
      (button) => button.textContent
    );
    expect(labels).toEqual(expect.arrayContaining(["Mo", "Agenda", "Now"]));
    renderer.unload();
  });

  test("shows each event once when a note is listed twice", async () => {
    const renderer = new ItineraryRenderer(
      el,
      listSpec,
      ["trip.md", "trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(shownTitles()).toEqual(["Hotel", "Parade"]);
    renderer.unload();
  });

  test("says which source notes don't exist yet", async () => {
    const renderer = new ItineraryRenderer(
      el,
      listSpec,
      ["trip.md", "Trips/Paris.md"],
      store,
      (path) => path === "trip.md"
    );
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-notice")?.textContent).toBe(
      "No note at Trips/Paris.md yet."
    );
    expect(shownTitles()).toEqual(["Hotel", "Parade"]);
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

  test("follows a source note that is renamed", async () => {
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();

    contents["trips/trip.md"] = contents["trip.md"];
    delete contents["trip.md"];
    store.rename("trip.md", "trips/trip.md");
    await settle();

    expect(renderer.sourcePaths).toEqual(["trips/trip.md"]);
    expect(shownTitles()).toEqual(["Hotel", "Parade"]);
    renderer.unload();
  });

  test("stops listening and tears down when unloaded", async () => {
    const renderer = new ItineraryRenderer(el, listSpec, ["trip.md"], store);
    renderer.load();
    await settle();
    const refresh = vi.spyOn(renderer, "refresh");

    renderer.unload();
    await store.refresh("trip.md");

    expect(refresh).not.toHaveBeenCalled();
    expect(eventRows()).toEqual([]);
  });

  test("shows an error when FullCalendar rejects its options", async () => {
    const renderer = new ItineraryRenderer(
      el,
      { ...listSpec, initialView: "dayGridMonht" },
      ["trip.md"],
      store
    );
    renderer.load();
    await settle();

    expect(el.querySelector(".itinerary-error")?.textContent).toMatch(
      /dayGridMonht/
    );
    renderer.unload();
  });

  test("updates the missing-note notice even when loading fails", async () => {
    let exists = false;
    store = new EventStore(() => Promise.reject(new Error("unreadable")));
    const renderer = new ItineraryRenderer(
      el,
      listSpec,
      ["trip.md"],
      store,
      () => exists
    );
    renderer.load();
    await settle();
    expect(el.querySelector(".itinerary-notice")?.textContent).toBe(
      "No note at trip.md yet."
    );

    exists = true;
    await renderer.refresh();
    expect(el.querySelector(".itinerary-notice")?.textContent).toBe("");
    renderer.unload();
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
