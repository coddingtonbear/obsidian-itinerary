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
  private sources: Record<string, EventSpec[]> = {};

  constructor(
    private spec: ItinerarySpec,
    private sourcePaths: string[],
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

  /** Updates stored event information
   *
   * Returns `false` if source file is *not* an event source for
   *   this particular itinerary.
   * Returns `true` if source file *is*.
   */
  updateSource(source: string, events: EventSpec[]): boolean {
    if (this.sourcePaths.includes(source)) {
      this.sources[source] = events;
      this.render();
      return true;
    }
    return false;
  }

  /** Returns whether selected event matches all provided filter specs. */
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
      const events = Object.values(this.sources)
        .flat()
        .filter((evt) => this.eventMatchesFilters(evt, this.compiledFilters));

      if (!this.calendar) {
        const calendarProps = { ...this.spec };
        // Our itinerary spec extends the CalendarOptions object used by
        // @fullcalendar/core, but there are a handful of properties that
        // are used only by obsidian-itinerary; we need to delete them
        // or @fullcalendar/core will show a warning in the console.
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

      setTimeout(() => this.calendar.updateSize(), 250);
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
  constructor(private event: EventSpec, private container: HTMLElement) {
    super(container);
  }

  async onload() {
    await this.render();
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
        name.style.backgroundColor = this.event.backgroundColor;
        name.style.borderColor = this.event.borderColor;
        name.style.color = this.event.textColor;
        name.innerText = this.event.title;

        const dateStr = element.createEl("div", {
          cls: ["date"],
        });
        let start: DateTime | null = null;
        if (this.event.start) {
          start = DateTime.fromISO(this.event.start);
        }
        let end: DateTime | null = null;
        if (this.event.end) {
          end = DateTime.fromISO(this.event.end);
        }
        if (this.event.allDay) {
          if (!end || end == start) {
            dateStr.innerText = `${end.toLocaleString(
              DateTime.DATE_FULL
            )} (all day)`;
          } else {
            dateStr.innerText = `${start.toLocaleString(
              DateTime.DATE_FULL
            )} - ${end.toLocaleString(DateTime.DATE_FULL)} (all day)`;
          }
        } else {
          if (end) {
            const zone = this.event.timeZone || this.event.endTimeZone;
            if (zone) {
              end = end.setZone(zone);
            }
          }
          if (start) {
            const zone = this.event.timeZone || this.event.startTimeZone;
            if (zone) {
              start = start.setZone(zone);
            }
          }
          if (!end || end == start) {
            dateStr.innerText = `${start.toLocaleString(
              DateTime.DATETIME_FULL
            )}`;
          } else {
            dateStr.innerText = `${start.toLocaleString(
              DateTime.DATETIME_FULL
            )} - ${end.toLocaleString(DateTime.DATETIME_FULL)}`;
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
