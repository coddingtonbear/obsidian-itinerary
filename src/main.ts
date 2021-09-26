import { Plugin, parseYaml } from "obsidian";

import { parseEventSpec } from "./extractor";
import { ItineraryRenderer, EventRenderer, renderErrorPre } from "./render";
import { ItinerarySpec } from "./types";

import { getArrayForArrayOrObject } from "./util";

import "./main.css";

type DocumentPath = string;

export default class Itinerary extends Plugin {
  /** Map of documents containing itineraries to pages their events
   * are sourced from */
  private eventSources: Record<DocumentPath, DocumentPath[]> = {};
  /** Map of documents containing itineraries to all itineraries
   * rendered on that page */
  private itineraries: Record<DocumentPath, ItineraryRenderer[]> = {};
  /** Map of documents used as events ources to all the rendered
   * events */
  private events: Record<DocumentPath, EventRenderer[]> = {};
  /** Map of documents having a debounced refresn scheduled to the
   * relevant setTimeout timer */
  private refreshDebouncers: Record<
    DocumentPath,
    ReturnType<typeof setTimeout>
  > = {};

  /** Refreshes displayed itineraries when displayed events have changed.
   *
   * For a path on which an event was sourced (and possibly rendered),
   * refresh any displayed itineraries that may have sourced events
   * from said page. **/
  refreshDependentItineraries(path: DocumentPath): void {
    for (const page of this.eventSources[path] ?? []) {
      for (const itinerary of this.itineraries[page] ?? []) {
        if (this.refreshDebouncers[page]) {
          clearTimeout(this.refreshDebouncers[page]);
        }
        this.refreshDebouncers[page] = setTimeout(() => {
          delete this.refreshDebouncers[page];

          itinerary.render();
        }, 250);
      }
    }
  }

  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      "itinerary",
      async (itinerarySpecString: string, el, ctx) => {
        try {
          let tableSpec: ItinerarySpec = {};
          try {
            tableSpec = parseYaml(itinerarySpecString) || {};

            if (!(tableSpec instanceof Object)) {
              throw new Error();
            }
          } catch (e) {
            throw new Error(`Could not parse itinerary spec: ${e.message}`);
          }

          // If no explicit sources were specified, *this* page is the
          // event source
          if (!tableSpec.source) {
            tableSpec.source = [ctx.sourcePath];
          }

          // Collect references to events displayed on the relevant source
          // pages so we can hand those arrays to the ItineraryRenderer
          // object.  It's important that we hand the arrays directly,
          // because the contents of those arrays may change!
          const events: EventRenderer[][] = [];
          for (const source of getArrayForArrayOrObject(tableSpec.source)) {
            if (!this.eventSources[source]) {
              this.eventSources[source] = [];
            }
            if (!this.eventSources[source].includes(ctx.sourcePath)) {
              this.eventSources[source].push(ctx.sourcePath);
            }
            if (!this.events[source]) {
              this.events[source] = [];
            }

            events.push(this.events[source]);
          }

          const itinerary = new ItineraryRenderer(tableSpec, events, el);

          // Store the ItineraryRenderer object so we can refresh it later
          // if its events have been changed.
          if (!this.itineraries[ctx.sourcePath]) {
            this.itineraries[ctx.sourcePath] = [];
          } else {
            // We might have stale itineraries in our list; let's remove
            // the ones that are no longer rendered.  We have to schedule
            // this for the next event loop because it won't be unloaded
            // until we return from this function.
            setTimeout(() => {
              for (const itinerary of this.itineraries[ctx.sourcePath]) {
                if (!itinerary.isLoaded()) {
                  this.itineraries[ctx.sourcePath].remove(itinerary);
                }
              }
            }, 1);
          }
          this.itineraries[ctx.sourcePath].push(itinerary);

          ctx.addChild(itinerary);
        } catch (e) {
          renderErrorPre(el, e.message);
          return;
        }
      }
    );
    this.registerMarkdownCodeBlockProcessor(
      "itinerary-event",
      async (eventSpecString: string, el, ctx) => {
        try {
          const evt = parseEventSpec(eventSpecString);

          const renderer = new EventRenderer(evt, el);

          // Store the EventRenderer object within the plugin context
          // so ItineraryRenderers that are sourcing events from this
          // page will see this updated event.
          if (!this.events[ctx.sourcePath]) {
            this.events[ctx.sourcePath] = [];
          } else {
            // We might have stale events in our list; let's remove
            // the ones that are no longer rendered.  We have to schedule
            // this for the next event loop because it won't be unloaded
            // until we return from this function.
            setTimeout(() => {
              for (const rendered of this.events[ctx.sourcePath]) {
                if (!rendered.isLoaded()) {
                  this.events[ctx.sourcePath].remove(rendered);
                }
              }
            }, 1);
          }
          this.events[ctx.sourcePath].push(renderer);

          ctx.addChild(renderer);

          // Since we've changed events on this page, we need to
          // tell itineraries that are sourcing their events from
          // this page that they need to refresh themselves.
          this.refreshDependentItineraries(ctx.sourcePath);
        } catch (e) {
          renderErrorPre(el, e.message);
        }
      }
    );
  }
}
