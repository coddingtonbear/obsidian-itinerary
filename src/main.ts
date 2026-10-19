import { MarkdownPostProcessorContext, Notice, Plugin, TFile } from "obsidian";

import {
  EventEdit,
  readEventForEdit,
  replaceEventBlock,
  serializeEditedEvent,
} from "./eventEdit";
import { eventBlock, padForInsertion, tagsInNote } from "./eventForm";
import { EventModal } from "./eventModal";
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
    // fires `create` for every file while it loads the vault, so those are
    // ignored; instead, once loading is done, everything shown is re-read,
    // which catches itineraries rendered before their sources had loaded.
    let vaultLoaded = false;
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (vaultLoaded && file instanceof TFile) {
          this.store.scheduleRefresh(file.path);
        }
      })
    );
    this.app.workspace.onLayoutReady(() => {
      vaultLoaded = true;
      void this.store.refreshAll();
    });

    this.register(() => this.store.dispose());

    this.registerMarkdownCodeBlockProcessor("itinerary", (source, el, ctx) =>
      this.renderItinerary(source, el, ctx)
    );
    this.registerMarkdownCodeBlockProcessor(
      "itinerary-event",
      (source, el, ctx) => this.renderEvent(source, el, ctx)
    );

    this.addCommand({
      id: "insert-event",
      name: "Insert event",
      editorCallback: (editor) => {
        new EventModal(this.app, tagsInNote(editor.getValue()), (values) => {
          const from = editor.getCursor("from");
          const to = editor.getCursor("to");
          editor.replaceSelection(
            padForInsertion(
              eventBlock(values),
              editor.getLine(from.line).slice(0, from.ch),
              editor.getLine(to.line).slice(to.ch)
            )
          );
        }).open();
      },
    });
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

  private renderEvent(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    try {
      renderEvent(el, parseEventSpec(source), () =>
        this.editEvent(source, el, ctx)
      );
    } catch (e) {
      renderErrorPre(el, errorMessage(e));
    }
  }

  /** Opens the event form on a rendered event, and rewrites its block in
   * place when the form is saved. */
  private editEvent(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    let edit: EventEdit;
    try {
      edit = readEventForEdit(source);
    } catch (e) {
      new Notice(errorMessage(e));
      return;
    }
    const noteText = ctx.getSectionInfo(el)?.text ?? "";
    new EventModal(
      this.app,
      tagsInNote(noteText),
      (values) => {
        void this.rewriteEvent(source, el, ctx, { ...edit, values });
      },
      { heading: "Edit itinerary event", submitText: "Save", values: edit.values }
    ).open();
  }

  private async rewriteEvent(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    edit: EventEdit
  ): Promise<void> {
    // Looked up now rather than when the form opened, since the note may
    // have changed (and been re-rendered) while it was open.
    const at = ctx.getSectionInfo(el);
    const file = this.app.vault.getFileByPath(ctx.sourcePath);
    if (!at || !file) {
      new Notice("Couldn't find this event in its note to change it.");
      return;
    }
    let replaced = true;
    await this.app.vault.process(file, (data) => {
      const next = replaceEventBlock(data, at, source, serializeEditedEvent(edit));
      if (next === null) {
        replaced = false;
        return data;
      }
      return next;
    });
    if (!replaced) {
      new Notice(
        "This event changed in its note while the form was open, so it was left as it is."
      );
    }
  }
}
