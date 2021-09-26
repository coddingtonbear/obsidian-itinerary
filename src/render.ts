import { MarkdownRenderChild } from "obsidian";

import { Calendar } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import { compileExpression } from "filtrex";

import { EventSpec, ItinerarySpec } from "./types";
import { getArrayForArrayOrObject } from "./util";

export class ItineraryRenderer extends MarkdownRenderChild {
  private messages: string[] = [];

  constructor(
    public spec: ItinerarySpec,
    public events: EventSpec[],
    public container: HTMLElement
  ) {
    super(container);
  }

  async onload() {
    await this.render();
  }

  eventMatchesFilters(
    evt: EventSpec,
    filters: ((item: Record<string, any>) => any)[]
  ): boolean {
    for (const [idx, filter] of filters.entries()) {
      if (!filter(evt)) {
        this.log(`Event '${evt.title}' failed filter ${idx}`);
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
      const filters = getArrayForArrayOrObject(this.spec.filter);

      const compiledFilters: ((item: Record<string, any>) => any)[] = [];
      for (const [idx, filter] of filters.entries()) {
        compiledFilters.push(compileExpression(filter));
        this.log(`Filter #${idx} '${filter}' compiled`);
      }

      const events = this.events.filter((evt) =>
        this.eventMatchesFilters(evt, compiledFilters)
      );

      const calendarProps = { ...this.spec };
      delete calendarProps.source;
      delete calendarProps.filter;
      delete calendarProps.debug;

      const calendar = new Calendar(this.container, {
        plugins: [dayGridPlugin, timeGridPlugin, listPlugin],
        events: events,
        ...calendarProps,
      });
      calendar.render();
      if (this.spec.debug) {
        renderErrorPre(
          this.container,
          this.messages.join("\n"),
          "itinerary-debug"
        );
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
  let pre = container.createEl("pre", {
    cls: ["itinerary", cls ?? "itinerary-error"],
  });
  pre.appendText(error);
  return pre;
}
