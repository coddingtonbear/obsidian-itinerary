import { MarkdownRenderChild } from "obsidian";

import { Calendar, CalendarOptions, EventInput } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import listPlugin from "fullcalendar/list";
import timeGridPlugin from "fullcalendar/timegrid";
import classicTheme from "fullcalendar/themes/classic";

import { EventFilter, compileFilter } from "./filter";
import { describeEventTime } from "./format";
import { getCalendarOptions } from "./spec";
import { EventStore, EventSubscriber } from "./store";
import { DocumentPath, EventSpec, ItinerarySpec } from "./types";
import { errorMessage, getArrayForArrayOrObject } from "./util";

export class ItineraryRenderer
  extends MarkdownRenderChild
  implements EventSubscriber
{
  private calendar: Calendar | null = null;
  private statusEl: HTMLElement | null = null;
  /** Counts refreshes, so one that finishes after a later one is dropped. */
  private generation = 0;
  private readonly filters: EventFilter[];
  private readonly filterExpressions: string[];
  private readonly calendarOptions: CalendarOptions;
  private readonly optionNotes: string[];

  constructor(
    containerEl: HTMLElement,
    private readonly spec: ItinerarySpec,
    private paths: readonly DocumentPath[],
    private readonly store: EventStore
  ) {
    super(containerEl);
    this.filterExpressions = getArrayForArrayOrObject(spec.filter);
    this.filters = this.filterExpressions.map((expression) =>
      compileFilter(expression)
    );
    const { options, notes } = getCalendarOptions(spec);
    this.calendarOptions = options;
    this.optionNotes = notes;
  }


  onload(): void {
    const calendarEl = this.containerEl.createDiv({
      cls: ["itinerary", "itinerary-calendar"],
    });
    this.statusEl = this.containerEl.createDiv();

    try {
      this.calendar = new Calendar(calendarEl, {
        plugins: [classicTheme, dayGridPlugin, timeGridPlugin, listPlugin],
        ...this.calendarOptions,
      });
      this.calendar.render();
    } catch (e) {
      // FullCalendar rejects some options outright (an unknown
      // `initialView`, say); show why instead of an empty block.
      try {
        this.calendar?.destroy();
      } catch {
        // A half-built calendar may fail to tear down; it's removed below.
      }
      this.calendar = null;
      calendarEl.remove();
      this.showStatus(errorMessage(e), "itinerary-error");
      return;
    }

    this.register(this.store.subscribe(this));
    void this.refresh();
  }

  onunload(): void {
    this.calendar?.destroy();
    this.calendar = null;
  }

  get sourcePaths(): readonly DocumentPath[] {
    return this.paths;
  }

  renameSource(oldPath: DocumentPath, newPath: DocumentPath): void {
    this.paths = this.paths.map((path) => (path === oldPath ? newPath : path));
  }

  onEventsChanged(): void {
    void this.refresh();
  }

  /** Reloads the displayed events from the itinerary's sources. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    let events: EventSpec[];
    try {
      events = await this.store.getEvents(this.sourcePaths);
    } catch (e) {
      if (generation === this.generation) {
        this.showStatus(errorMessage(e), "itinerary-error");
      }
      return;
    }

    const calendar = this.calendar;
    if (!calendar || generation !== this.generation) {
      // Unloaded, or superseded by a later refresh, while loading.
      return;
    }

    const messages: string[] = [
      ...this.optionNotes,
      ...this.filterExpressions.map(
        (expression, idx) => `Filter #${idx} '${expression}' compiled`
      ),
    ];
    const shown = events.filter((evt) => this.matchesFilters(evt, messages));

    calendar.batchRendering(() => {
      calendar.removeAllEventSources();
      calendar.addEventSource(shown.map(toEventInput));
    });

    if (this.spec.debug) {
      this.showStatus(messages.join("\n"), "itinerary-debug");
    } else {
      this.statusEl?.empty();
    }
  }

  private matchesFilters(evt: EventSpec, messages: string[]): boolean {
    for (const [idx, filter] of this.filters.entries()) {
      const result = filter(evt);
      if (!result.matched) {
        messages.push(
          result.error === undefined
            ? `Event '${evt.title}' failed filter #${idx}`
            : `Event '${evt.title}' failed filter #${idx}: ${result.error}`
        );
        return false;
      }
    }
    messages.push(`Event '${evt.title}' passed all filters`);
    return true;
  }

  private showStatus(message: string, cls: string): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();
    renderErrorPre(this.statusEl, message, cls);
  }
}

/** The FullCalendar 7 input for an event. FullCalendar 7 replaced
 * `backgroundColor`/`borderColor` with a single `color` (there is no
 * separate border color), `textColor` with `contrastColor`, and the
 * `classNames` list with a `className` string. Colors an event doesn't set
 * are left out, so the itinerary's `eventColor` and the theme apply. */
export function toEventInput(event: EventSpec): EventInput {
  const { backgroundColor, borderColor, textColor, classNames, ...input } =
    event;
  const result: EventInput = { ...input };
  if (backgroundColor !== undefined) {
    result.color = backgroundColor;
  }
  if (textColor !== undefined) {
    result.contrastColor = textColor;
  }
  const classes = getArrayForArrayOrObject<unknown>(classNames).filter(
    (name): name is string => typeof name === "string"
  );
  if (classes.length > 0 && result.className === undefined) {
    result.className = classes.join(" ");
  }
  return result;
}

/** Renders an event's summary where its `itinerary-event` block appears. */
export function renderEvent(container: HTMLElement, event: EventSpec): void {
  if (event.hidden) {
    return;
  }

  const element = container.createDiv({
    cls: ["itinerary", "itinerary-event"],
  });
  const colors: Record<string, string> = {};
  if (event.backgroundColor !== undefined) {
    colors["--itinerary-event-background"] = event.backgroundColor;
  }
  if (event.borderColor !== undefined) {
    colors["--itinerary-event-border"] = event.borderColor;
  }
  if (event.textColor !== undefined) {
    colors["--itinerary-event-text"] = event.textColor;
  }
  element.setCssProps(colors);

  element.createDiv({ cls: "name", text: event.title });
  element.createDiv({ cls: "date", text: describeEventTime(event) });

  const tags = getArrayForArrayOrObject(event.tag);
  if (tags.length > 0) {
    const tagList = element.createDiv({ cls: "tags" });
    for (const tagName of tags) {
      tagList.createDiv({ cls: "tag", text: tagName });
    }
  }
}

export function renderErrorPre(
  container: HTMLElement,
  error: string,
  cls?: string
): HTMLElement {
  return container.createEl("pre", {
    cls: ["itinerary", cls ?? "itinerary-error"],
    text: error,
  });
}
