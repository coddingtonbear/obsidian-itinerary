import { MarkdownRenderChild, setIcon } from "obsidian";

import { Calendar, CalendarOptions, EventInput } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import listPlugin from "fullcalendar/list";
import timeGridPlugin from "fullcalendar/timegrid";
import classicTheme from "fullcalendar/themes/classic";
import luxonFormatPlugin from "@fullcalendar/format-luxon3";

import { EventFilter, compileFilter } from "./filter";
import { describeEventTime } from "./format";
import { RuleBook, ruleLabel } from "./rules";
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
  private noticeEl: HTMLElement | null = null;
  private paths: readonly DocumentPath[];
  /** Counts refreshes, so one that finishes after a later one is dropped. */
  private generation = 0;
  private readonly filters: EventFilter[];
  private readonly filterExpressions: string[];
  private readonly calendarOptions: CalendarOptions;
  private readonly optionNotes: string[];

  constructor(
    containerEl: HTMLElement,
    private readonly spec: ItinerarySpec,
    paths: readonly DocumentPath[],
    private readonly store: EventStore,
    /** Whether a source note exists, to say which ones don't yet. */
    private readonly sourceExists: (path: DocumentPath) => boolean = () =>
      true,
    private readonly ruleBook: RuleBook = new RuleBook()
  ) {
    super(containerEl);
    // A note listed twice (as a link and as a path, say) is shown once.
    this.paths = [...new Set(paths)];
    this.filterExpressions = getArrayForArrayOrObject(spec.filter);
    this.filters = this.filterExpressions.map((expression) =>
      compileFilter(expression)
    );
    const { options, notes } = getCalendarOptions(spec);
    this.calendarOptions = options;
    this.optionNotes = notes;
  }


  onload(): void {
    const calendarEl = this.containerEl.createDiv({
      cls: ["itinerary", "itinerary-calendar"],
    });
    this.noticeEl = this.containerEl.createDiv({ cls: "itinerary-notice" });
    this.statusEl = this.containerEl.createDiv();

    try {
      this.calendar = new Calendar(calendarEl, {
        // The luxon formatter reads string formats (`titleFormat: "MMMM
        // yyyy"`), which version 1 supported through @fullcalendar/luxon.
        plugins: [
          classicTheme,
          dayGridPlugin,
          timeGridPlugin,
          listPlugin,
          luxonFormatPlugin,
        ],
        ...this.calendarOptions,
        // Popovers ("+3 more") are attached to the end of the document,
        // outside the calendar; this class lets styles.css theme them.
        popoverClass: joinClasses(
          "itinerary-popover",
          this.calendarOptions.popoverClass
        ),
      });
      this.calendar.render();
    } catch (e) {
      // FullCalendar rejects some options outright (an unknown
      // `initialView`, say); show why instead of an empty block.
      try {
        this.calendar?.destroy();
      } catch {
        // A half-built calendar may fail to tear down; it's removed below.
      }
      this.calendar = null;
      calendarEl.remove();
      this.showStatus(errorMessage(e), "itinerary-error");
      return;
    }

    this.register(this.store.subscribe(this));
    if (this.spec.rules !== false) {
      this.register(this.ruleBook.subscribe(() => void this.refresh()));
    }
    void this.refresh();
  }

  onunload(): void {
    this.calendar?.destroy();
    this.calendar = null;
  }

  get sourcePaths(): readonly DocumentPath[] {
    return this.paths;
  }

  renameSource(oldPath: DocumentPath, newPath: DocumentPath): void {
    this.paths = [
      ...new Set(this.paths.map((path) => (path === oldPath ? newPath : path))),
    ];
  }

  onEventsChanged(): void {
    void this.refresh();
  }

  /** Reloads the displayed events from the itinerary's sources. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    // Before loading, so it's current even if loading fails.
    const missing = this.paths.filter((path) => !this.sourceExists(path));
    this.noticeEl?.setText(
      missing.map((path) => `No note at ${path} yet.`).join(" ")
    );
    let events: EventSpec[];
    try {
      events = await this.store.getEvents(this.sourcePaths);
    } catch (e) {
      if (generation === this.generation) {
        this.showStatus(errorMessage(e), "itinerary-error");
      }
      return;
    }

    const calendar = this.calendar;
    if (!calendar || generation !== this.generation) {
      // Unloaded, or superseded by a later refresh, while loading.
      return;
    }

    // Debug messages are only collected when they'll be shown.
    const messages: string[] | null = this.spec.debug
      ? [
          ...this.optionNotes,
          ...this.filterExpressions.map(
            (expression, idx) => `Filter #${idx} '${expression}' compiled`
          ),
          ...this.describeRules(),
        ]
      : null;
    // Rules run before filters, so filters see the colors and orders rules
    // set.
    const shown = events
      .map((evt) => this.applyRules(evt, messages))
      .filter((evt) => this.matchesFilters(evt, messages));

    calendar.batchRendering(() => {
      calendar.removeAllEventSources();
      calendar.addEventSource(shown.map(toEventInput));
    });

    if (messages) {
      this.showStatus(messages.join("\n"), "itinerary-debug");
    } else {
      this.statusEl?.empty();
    }
  }

  private matchesFilters(evt: EventSpec, messages: string[] | null): boolean {
    for (const [idx, filter] of this.filters.entries()) {
      const result = filter(evt);
      if (!result.matched) {
        messages?.push(
          result.error === undefined
            ? `Event '${evt.title}' failed filter #${idx}`
            : `Event '${evt.title}' failed filter #${idx}: ${result.error}`
        );
        return false;
      }
    }
    messages?.push(`Event '${evt.title}' passed all filters`);
    return true;
  }

  private describeRules(): string[] {
    if (this.spec.rules === false) {
      return ["Event rules are off for this itinerary"];
    }
    return this.ruleBook.rules.flatMap(({ rule, error }, index) =>
      error === undefined
        ? []
        : [`Rule '${ruleLabel(rule, index)}' was skipped: ${error}`]
    );
  }

  private applyRules(evt: EventSpec, messages: string[] | null): EventSpec {
    if (this.spec.rules === false) {
      return evt;
    }
    const { event, matches, errors } = this.ruleBook.apply(evt);
    for (const { name, error } of errors) {
      messages?.push(
        `Event '${evt.title}' couldn't be checked against rule '${name}': ${error}`
      );
    }
    for (const { name, fields } of matches) {
      messages?.push(
        fields.length > 0
          ? `Event '${evt.title}' matched rule '${name}', which set ${fields.join(", ")}`
          : `Event '${evt.title}' matched rule '${name}', which changed nothing (the event or a higher rule sets the same fields)`
      );
    }
    return event;
  }


  private showStatus(message: string, cls: string): void {
    if (!this.statusEl) {
      return;
    }
    this.statusEl.empty();
    renderErrorPre(this.statusEl, message, cls);
  }
}

function joinClasses(base: string, extra: unknown): string {
  return typeof extra === "string" && extra.trim() !== ""
    ? `${base} ${extra}`
    : base;
}

/** The FullCalendar 7 input for an event. FullCalendar 7 replaced
 * `backgroundColor`/`borderColor` with a single `color` (there is no
 * separate border color), `textColor` with `contrastColor`, and the
 * `classNames` list with a `className` string. Colors an event doesn't set
 * are left out, so the itinerary's `eventColor` and the theme apply. */
export function toEventInput(event: EventSpec): EventInput {
  const { backgroundColor, borderColor, textColor, classNames, ...input } =
    event;
  const result: EventInput = { ...input };
  if (backgroundColor !== undefined) {
    result.color = backgroundColor;
  }
  if (textColor !== undefined) {
    result.contrastColor = textColor;
  }
  const classes = getArrayForArrayOrObject<unknown>(classNames).filter(
    (name): name is string => typeof name === "string"
  );
  if (classes.length > 0 && result.className === undefined) {
    result.className = classes.join(" ");
  }
  return result;
}

/** An event's summary, redrawn when the vault's event rules change. */
export class EventSummaryRenderer extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly event: EventSpec,
    private readonly ruleBook: RuleBook,
    private readonly onEdit?: () => void
  ) {
    super(containerEl);
  }

  onload(): void {
    this.draw();
    this.register(this.ruleBook.subscribe(() => this.draw()));
  }

  private draw(): void {
    this.containerEl.empty();
    renderEvent(
      this.containerEl,
      this.ruleBook.apply(this.event).event,
      this.onEdit
    );
  }
}

/** Renders an event's summary where its `itinerary-event` block appears,
 * with an edit button when there's an `onEdit` to call. */
export function renderEvent(
  container: HTMLElement,
  event: EventSpec,
  onEdit?: () => void
): void {
  if (event.hidden) {
    return;
  }

  const element = container.createDiv({
    cls: ["itinerary", "itinerary-event"],
  });
  const colors: Record<string, string> = {};
  if (event.backgroundColor !== undefined) {
    colors["--itinerary-event-background"] = event.backgroundColor;
  }
  if (event.borderColor !== undefined) {
    colors["--itinerary-event-border"] = event.borderColor;
  }
  if (event.textColor !== undefined) {
    colors["--itinerary-event-text"] = event.textColor;
  }
  element.setCssProps(colors);

  element.createDiv({ cls: "name", text: event.title });
  element.createDiv({ cls: "date", text: describeEventTime(event) });

  // Tags and the edit button wrap onto the next line together.
  const tags = getArrayForArrayOrObject(event.tag);
  if (tags.length === 0 && !onEdit) {
    return;
  }
  const end = element.createDiv({ cls: "itinerary-event-end" });
  if (tags.length > 0) {
    const tagList = end.createDiv({ cls: "tags" });
    for (const tagName of tags) {
      tagList.createDiv({ cls: "tag", text: tagName });
    }
  }

  if (onEdit) {
    const button = end.createEl("button", {
      cls: ["clickable-icon", "itinerary-event-edit"],
    });
    button.setAttribute("aria-label", "Edit event");
    setIcon(button, "pencil");
    // Otherwise live preview takes the press as one to edit the block's
    // source, which it does on mousedown, before any click.
    button.addEventListener("mousedown", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    button.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onEdit();
    });
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
