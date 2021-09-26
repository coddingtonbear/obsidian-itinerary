import { Plugin, parseYaml } from "obsidian";

import { getEventInformation, parseEventSpec } from "./extractor";
import { ItineraryRenderer, renderErrorPre } from "./render";
import { ItinerarySpec, EventSpec } from "./types";

import "./main.css";

const RefreshTimeoutMs = 5000;

export default class Itinerary extends Plugin {
  private eventSources: Record<string, string[]> = {};
  private refreshDebouncers: Record<string, ReturnType<typeof setTimeout>> = {};

  onFileChange(change: any) {
    console.log(`Sources: ${JSON.stringify(this.eventSources)}`);

    const dependentPages = this.eventSources[change.path];
    if (dependentPages) {
      console.log(`File ${change.path} is an event source, re-rendering...`);
      this.refreshPanes(dependentPages);
    } else {
      console.log(`File ${change.path} is not an event source`);
    }
  }

  refreshPanes(dependentPages: string[]) {
    console.log(`Re-rendering for ${JSON.stringify(dependentPages)}`);
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (leaf.getViewState().state.mode.includes("preview")) {
        const filename = leaf.getViewState().state?.file;
        if (dependentPages.includes(filename)) {
          console.log(
            `File ${filename} has a rendered calendar (scheduling refresh)`
          );

          if (this.refreshDebouncers[filename]) {
            clearTimeout(this.refreshDebouncers[filename]);
          }

          this.refreshDebouncers[filename] = setTimeout(() => {
            delete this.refreshDebouncers[filename];
            console.log(`Refreshing preview for ${filename} (from schedule)`);
            // @ts-ignore
            leaf.view.previewMode.rerender(true);
          }, RefreshTimeoutMs);
        } else {
          console.log(`File ${filename} does not have a rendered calendar`);
        }
      }
    });
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

          if (!tableSpec.source) {
            tableSpec.source = [ctx.sourcePath];
          }

          const events: EventSpec[] = [];
          for (const source of Array.isArray(tableSpec.source)
            ? tableSpec.source
            : tableSpec.source) {
            if (!this.eventSources[source]) {
              this.eventSources[source] = [];
            }
            if (!this.eventSources[source].includes(ctx.sourcePath)) {
              this.eventSources[source].push(ctx.sourcePath);
            }
            const exists = await this.app.vault.adapter.exists(source);
            if (!exists) {
              throw new Error(
                `Itinerary source '${tableSpec.source}' could not be found.`
              );
            }
            const fileContents = await this.app.vault.adapter.read(source);
            for (const evt of getEventInformation(fileContents)) {
              events.push(evt);
            }
          }
          ctx.addChild(new ItineraryRenderer(tableSpec, events, el));
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
          parseEventSpec(eventSpecString);
        } catch (e) {
          renderErrorPre(el, e.message);
        }
      }
    );
  }
}
