import { MarkdownPostProcessorContext, Plugin, TFile } from "obsidian";

import { getEventInformation, parseEventSpec } from "./extractor";
import { ItineraryRenderer, renderErrorPre, renderEvent } from "./render";
import { SourceLookup, resolveSourcePath } from "./sources";
import { parseItinerarySpec } from "./spec";
import { EventStore } from "./store";
import { DocumentPath, EventSpec } from "./types";
import { errorMessage, getArrayForArrayOrObject } from "./util";

export default class Itinerary extends Plugin {
  private store = new EventStore((path) => this.readEvents(path));

  onload(): void {
    // Keep rendered itineraries current as the notes they draw from change.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.store.scheduleRefresh(file.path);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.store.forget(file.path))
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) =>
        this.store.rename(oldPath, file.path)
      )
    );
    // A source given as a path may not exist until later. Obsidian also
    // fires `create` for every file while it loads the vault, so listen
    // only once that's done.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) {
            this.store.scheduleRefresh(file.path);
          }
        })
      );
    });

    this.register(() => this.store.dispose());

    this.registerMarkdownCodeBlockProcessor("itinerary", (source, el, ctx) =>
      this.renderItinerary(source, el, ctx)
    );
    this.registerMarkdownCodeBlockProcessor("itinerary-event", (source, el) =>
      this.renderEvent(source, el)
    );
  }

  private async readEvents(path: DocumentPath): Promise<EventSpec[]> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      return [];
    }
    return getEventInformation(await this.app.vault.cachedRead(file));
  }

  private get sourceLookup(): SourceLookup {
    return {
      resolveLink: (linkpath, fromPath) =>
        this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)
          ?.path ?? null,
      fileExists: (path) => this.app.vault.getFileByPath(path) !== null,
    };
  }

  private renderItinerary(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    try {
      const spec = parseItinerarySpec(source);
      const sources = getArrayForArrayOrObject(spec.source);

      // If no explicit sources were specified, *this* page is the
      // event source
      const sourcePaths =
        sources.length > 0
          ? sources.map((entry) =>
              resolveSourcePath(entry, ctx.sourcePath, this.sourceLookup)
            )
          : [ctx.sourcePath];

      ctx.addChild(
        new ItineraryRenderer(
          el,
          spec,
          sourcePaths,
          this.store,
          (path) => this.app.vault.getFileByPath(path) !== null
        )
      );
    } catch (e) {
      renderErrorPre(el, errorMessage(e));
    }
  }

  private renderEvent(source: string, el: HTMLElement): void {
    try {
      renderEvent(el, parseEventSpec(source));
    } catch (e) {
      renderErrorPre(el, errorMessage(e));
    }
  }
}
