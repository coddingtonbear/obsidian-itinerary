import { Plugin, parseYaml, TAbstractFile, TFile } from "obsidian";

import { parseEventSpec } from "./extractor";
import { ItineraryRenderer, EventRenderer, renderErrorPre } from "./render";
import { DocumentPath, ItinerarySpec, EventSpec } from "./types";
import { getEventInformation } from "./extractor";

import { getArrayForArrayOrObject } from "./util";

import "./main.css";

export default class Itinerary extends Plugin {
  /** Map of documents containing itineraries to pages their events
   * are sourced from */
  private eventSources: Record<DocumentPath, DocumentPath[]> = {};
  /** Map of documents containing itineraries to all itineraries
   * rendered on that page */
  private itineraries: Record<DocumentPath, ItineraryRenderer[]> = {};
  /** Map of documents used as events ources to all the rendered
   * events */
  private events: Record<DocumentPath, EventSpec[]> = {};
  /** Map of documents having a debounced refresn scheduled to the
   * relevant setTimeout timer */
  private refreshDebouncers: Record<
    DocumentPath,
    ReturnType<typeof setTimeout>
  > = {};

  /** Receives incoming file change events (for updating events/itineraries) */
  async onFileChange(change: TAbstractFile) {
    if (change instanceof TFile) {
      const documentPath = change.path;

      // If this incoming change event was for a document that we're using
      // as an event source, reload events from that source and instruct
      // dependent itineraries to update themselves.
      if (this.eventSources[documentPath]) {
        await this.loadEventsFromSource(documentPath);
        this.refreshDependentItineraries(documentPath);
      }
    }
  }

  /** Refreshes displayed itineraries when displayed events have changed.
   *
   * For a path on which an event was sourced (and possibly rendered),
   * refresh any displayed itineraries that may have sourced events
   * from said page. **/
  refreshDependentItineraries(path: DocumentPath): void {
    for (const page of this.eventSources[path] ?? []) {
      if (this.refreshDebouncers[page]) {
        clearTimeout(this.refreshDebouncers[page]);
      }
      this.refreshDebouncers[page] = setTimeout(() => {
        delete this.refreshDebouncers[page];

        for (const itinerary of this.itineraries[page] ?? []) {
          if (!itinerary.isLoaded()) {
            this.itineraries[page].remove(itinerary);
            continue;
          }

          this.refreshItinerary(itinerary);
        }
      }, 5000);
    }
  }

  /** Updates event content for a given itinerary (& re-render if changed) */
  refreshItinerary(itinerary: ItineraryRenderer) {
    let rerender = false;

    for (const sourcePath in this.events) {
      if (itinerary.updateSource(sourcePath, this.events[sourcePath])) {
        rerender = true;
      }
    }

    if (rerender) {
      itinerary.render();
    }
  }

  /** Loads file content to update cached set of events found in said file. */
  async loadEventsFromSource(sourcePath: string) {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (file instanceof TFile) {
      const fileContents = await this.app.vault.cachedRead(file);

      this.events[sourcePath] = getEventInformation(fileContents);
    }
  }

  async onload() {
    this.registerEvent(
      this.app.vault.on("modify", this.onFileChange.bind(this))
    );

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

          // Update the plugin mapping between event sources and dependent
          // itineraries so we can know which itineraries to refresh
          // when page contents have changed
          const allFiles = this.app.vault.getFiles();
          const eventSources = getArrayForArrayOrObject(tableSpec.source);
          const resolvedEventSources: string[] = [];
          for (const source of eventSources) {
            var sourcePath: string = undefined;
            if (source.startsWith("[[") && source.endsWith("]]")) {
              const sourceName = source.slice(2, -2);
              const match = allFiles.find((f) => {
                // Fully-qualified matches (ones in subfolders)
                if (f.parent.path + "/" + f.basename === sourceName) {
                  return true;
                  // Non-fully-qualified (in the project root); note that
                  // this isn't in conflict with the above as files in
                  // the root folder will _still_ have a parent with a
                  // path of '/', so if a slash is in the source name
                  // in any way whatsoever, this conditional will not match
                } else if (f.basename === sourceName) {
                  return true;
                }

                return false;
              });
              if (!match) {
                throw new Error(`Could not resolve ${source} to a path`);
              }
              sourcePath = match.path;
            } else {
              sourcePath = source;
            }
            resolvedEventSources.push(sourcePath);
            if (!this.eventSources[sourcePath]) {
              this.eventSources[sourcePath] = [];
            }
            if (!this.eventSources[sourcePath].includes(ctx.sourcePath)) {
              this.eventSources[sourcePath].push(ctx.sourcePath);
            }
          }

          const itinerary = new ItineraryRenderer(
            tableSpec,
            resolvedEventSources,
            el
          );

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

          // Load events from the sources that our itinerary depends upon
          // (if those events aren't already loaded), and then ask tell
          // our itinerary to update itself.
          const loaderPromises: Promise<void>[] = [];
          for (const source of resolvedEventSources) {
            if (!this.events[source]) {
              loaderPromises.push(this.loadEventsFromSource(source));
            }
          }
          Promise.all(loaderPromises).then(() =>
            this.refreshItinerary(itinerary)
          );
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

          ctx.addChild(new EventRenderer(evt, el));
        } catch (e) {
          renderErrorPre(el, e.message);
        }
      }
    );
  }
}
