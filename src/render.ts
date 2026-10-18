import { MarkdownRenderChild } from "obsidian";

import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import luxonPlugin from "@fullcalendar/luxon3";

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
  private readonly filters: EventFilter[];
  private readonly filterExpressions: string[];

  constructor(
    containerEl: HTMLElement,
    private readonly spec: ItinerarySpec,
    readonly sourcePaths: readonly DocumentPath[],
    private readonly store: EventStore
  ) {
    super(containerEl);
    this.filterExpressions = getArrayForArrayOrObject(spec.filter);
    this.filters = this.filterExpressions.map((expression) =>
      compileFilter(expression)
    );
  }

  onload(): void {
    const calendarEl = this.containerEl.createDiv({
      cls: ["itinerary", "itinerary-calendar"],
    });
    this.statusEl = this.containerEl.createDiv();

    this.calendar = new Calendar(calendarEl, {
      plugins: [dayGridPlugin, timeGridPlugin, listPlugin, luxonPlugin],
      ...getCalendarOptions(this.spec),
    });
    this.calendar.render();

    // The calendar sizes itself when rendered, but a note pane can be
    // resized (or the block first shown) later; keep it fitting its pane.
    const observer = new ResizeObserver(() => this.calendar?.updateSize());
    observer.observe(calendarEl);
    this.register(() => observer.disconnect());

    this.register(this.store.subscribe(this));
    void this.refresh();
  }

  onunload(): void {
    this.calendar?.destroy();
    this.calendar = null;
  }

  onEventsChanged(): void {
    void this.refresh();
  }

  /** Reloads the displayed events from the itinerary's sources. */
  async refresh(): Promise<void> {
    let events: EventSpec[];
    try {
      events = await this.store.getEvents(this.sourcePaths);
    } catch (e) {
      this.showStatus(errorMessage(e), "itinerary-error");
      return;
    }

    const calendar = this.calendar;
    if (!calendar) {
      // Unloaded while the events were loading.
      return;
    }

    const messages: string[] = this.filterExpressions.map(
      (expression, idx) => `Filter #${idx} '${expression}' compiled`
    );
    const shown = events.filter((evt) => this.matchesFilters(evt, messages));

    calendar.batchRendering(() => {
      calendar.removeAllEventSources();
      calendar.addEventSource(shown);
    });

    if (this.spec.debug) {
      this.showStatus(messages.join("\n"), "itinerary-debug");
    } else {
      this.statusEl?.empty();
    }
  }

  private matchesFilters(evt: EventSpec, messages: string[]): boolean {
    for (const [idx, filter] of this.filters.entries()) {
      if (!filter(evt)) {
        messages.push(`Event '${evt.title}' failed filter #${idx}`);
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

/** Renders an event's summary where its `itinerary-event` block appears. */
export function renderEvent(container: HTMLElement, event: EventSpec): void {
  if (event.hidden) {
    return;
  }

  const element = container.createDiv({
    cls: ["itinerary", "itinerary-event"],
  });
  element.setCssProps({
    "--itinerary-event-background": event.backgroundColor,
    "--itinerary-event-border": event.borderColor,
    "--itinerary-event-text": event.textColor,
  });

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
