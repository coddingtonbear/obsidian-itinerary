import { MarkdownRenderChild } from "obsidian";

import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import luxonPlugin from "@fullcalendar/luxon";

import { compileExpression } from "filtrex";
import { DateTime } from "luxon";

import { EventSpec, ItinerarySpec } from "./types";
import { getArrayForArrayOrObject } from "./util";

export class ItineraryRenderer extends MarkdownRenderChild {
  private messages: string[] = [];
  private loaded: boolean = false;
  private calendar: Calendar;
  private compiledFilters: ((item: Record<string, any>) => any)[] = [];

  constructor(
    private spec: ItinerarySpec,
    private sources: EventRenderer[][],
    private container: HTMLElement
  ) {
    super(container);
    for (const [idx, filter] of getArrayForArrayOrObject(
      this.spec.filter
    ).entries()) {
      this.compiledFilters.push(compileExpression(filter));
      this.log(`Filter #${idx} '${filter}' compiled`);
    }
  }

  async onload() {
    await this.render();
    this.loaded = true;
  }

  async onunload() {
    this.loaded = false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  eventMatchesFilters(
    evt: EventSpec,
    filters: ((item: Record<string, any>) => any)[]
  ): boolean {
    for (const [idx, filter] of filters.entries()) {
      if (!filter(evt)) {
        this.log(`Event '${evt.title}' failed filter #${idx}`);
        return false;
      }
    }
    this.log(`Event '${evt.title}' passed all filters`);
    return true;
  }

  log(message: any) {
    if (this.spec.debug) {
      console.log(message);
      this.messages.push(message);
    }
  }

  async render() {
    try {
      const events = this.sources
        .map((source) => source.filter((rendered) => rendered.isLoaded()))
        .flat(1)
        .map((renderer) => renderer.getEvent())
        .filter((evt) => this.eventMatchesFilters(evt, this.compiledFilters));

      if (!this.calendar) {
        const calendarProps = { ...this.spec };
        delete calendarProps.source;
        delete calendarProps.filter;
        delete calendarProps.debug;

        this.calendar = new Calendar(this.container, {
          plugins: [dayGridPlugin, timeGridPlugin, listPlugin, luxonPlugin],
          ...calendarProps,
        });
      }
      this.calendar.removeAllEvents();
      this.calendar.addEventSource(events);
      this.calendar.render();

      setTimeout(() => this.calendar.updateSize(), 100);
      if (this.spec.debug) {
        renderErrorPre(
          this.container,
          this.messages.join("\n"),
          "itinerary-debug"
        );
        this.messages = [];
      }
    } catch (e) {
      renderErrorPre(this.container, e);
    }
  }
}

export class EventRenderer extends MarkdownRenderChild {
  private loaded: boolean = false;

  constructor(private event: EventSpec, private container: HTMLElement) {
    super(container);
  }

  async onload() {
    await this.render();
    this.loaded = true;
  }

  async render() {
    try {
      if (this.event.hidden) {
        // Remove all child nodes (in case we rendered them before)
        while (this.container.firstChild) {
          this.container.removeChild(this.container.firstChild);
        }
      } else {
        const element = this.container.createEl("div", {
          cls: ["itinerary", "itinerary-event"],
        });

        const name = element.createEl("div", {
          cls: ["name"],
        });
        const defaultColor = "#3788d8";
        const defaultTextColor = "#ffffff";

        name.style.backgroundColor =
          this.event.backgroundColor ?? this.event.color ?? defaultColor;
        name.style.borderColor =
          this.event.borderColor ?? this.event.borderColor ?? defaultColor;
        name.style.color = this.event.textColor ?? defaultTextColor;

        name.innerText = this.event.title ?? "Untitled Event";

        const dateStr = element.createEl("div", {
          cls: ["date"],
        });
        if (this.event.allDay) {
          if (!this.event.end || this.event.end == this.event.start) {
            dateStr.innerText = `${DateTime.fromISO(
              this.event.start
            ).toLocaleString(DateTime.DATE_FULL)} (all day)`;
          } else {
            dateStr.innerText = `${DateTime.fromISO(
              this.event.start
            ).toLocaleString(DateTime.DATE_FULL)} - ${DateTime.fromISO(
              this.event.end
            ).toLocaleString(DateTime.DATE_FULL)} (all day)`;
          }
        } else {
          if (!this.event.end || this.event.end == this.event.start) {
            dateStr.innerText = `${DateTime.fromISO(
              this.event.start
            ).toLocaleString(DateTime.DATETIME_FULL)}`;
          } else {
            dateStr.innerText = `${DateTime.fromISO(
              this.event.start
            ).toLocaleString(DateTime.DATETIME_FULL)} - ${DateTime.fromISO(
              this.event.end
            ).toLocaleString(DateTime.DATETIME_FULL)}`;
          }
        }

        for (const tagName of getArrayForArrayOrObject(this.event.tag)) {
          const tag = element.createEl("div", {
            cls: ["tag"],
          });
          tag.innerText = tagName;
        }
      }
    } catch (e) {
      renderErrorPre(this.container, e);
    }
  }

  async onunload() {
    this.loaded = false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getEvent(): EventSpec {
    return this.event;
  }
}

export function renderErrorPre(
  container: HTMLElement,
  error: string,
  cls?: string
): HTMLElement {
  const pre = container.createEl("pre", {
    cls: ["itinerary", cls ?? "itinerary-error"],
  });
  pre.appendText(error);
  return pre;
}
