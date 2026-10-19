import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";

import { Completion, Suggestion, complete, tagsInNote } from "./completion";

let timeZones: readonly string[] | null = null;

function supportedTimeZones(): readonly string[] {
  // Some engines list only named zones, leaving out UTC.
  timeZones ??= [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])];
  return timeZones;
}

/** Suggests field names and values inside `itinerary` and
 * `itinerary-event` blocks while a note is edited. The logic lives in
 * completion.ts; this connects it to Obsidian's editor. */
export class BlockSuggest extends EditorSuggest<Suggestion> {
  private completion: Completion | null = null;

  onTrigger(
    cursor: EditorPosition,
    editor: Editor,
    _file: TFile | null
  ): EditorSuggestTriggerInfo | null {
    this.completion = complete(
      {
        lineCount: editor.lineCount(),
        getLine: (line) => editor.getLine(line),
      },
      cursor,
      {
        timeZones: supportedTimeZones,
        noteTags: () => tagsInNote(editor.getValue()),
      }
    );
    if (this.completion === null) {
      return null;
    }
    return {
      start: { line: cursor.line, ch: this.completion.from },
      end: { line: cursor.line, ch: this.completion.to },
      query: this.completion.query,
    };
  }

  getSuggestions(_context: EditorSuggestContext): Suggestion[] {
    return this.completion?.suggestions ?? [];
  }

  renderSuggestion(suggestion: Suggestion, el: HTMLElement): void {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: suggestion.label });
    if (suggestion.description !== undefined) {
      content.createDiv({
        cls: "suggestion-note",
        text: suggestion.description,
      });
    }
  }

  selectSuggestion(suggestion: Suggestion, _evt: MouseEvent | KeyboardEvent): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    context.editor.replaceRange(suggestion.text, context.start, context.end);
    context.editor.setCursor({
      line: context.start.line,
      ch: context.start.ch + suggestion.text.length,
    });
    this.close();
  }
}
