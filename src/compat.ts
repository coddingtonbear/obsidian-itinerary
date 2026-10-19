import { CalendarOptions } from "fullcalendar";

import { isRecord } from "./util";

/** The toolbar FullCalendar 5 and 6 showed when `headerToolbar` was left
 * unset.
 * FullCalendar 7 shows no toolbar by default; itineraries written before
 * the upgrade expect this one. */
export const DefaultHeaderToolbar = {
  start: "title",
  center: "",
  end: "today prev,next",
};

/** Options from FullCalendar 5 and 6 (which version 1 of this plugin used)
 * that FullCalendar 7 renamed without changing what they accept. */
const RenamedOptions: Record<string, string> = {
  stickyHeaderDates: "tableHeaderSticky",
  stickyFooterScrollbar: "footerScrollbarSticky",
  dayPopoverFormat: "popoverFormat",
  slotLabelFormat: "slotHeaderFormat",
  slotLabelInterval: "slotHeaderInterval",
  listDaySideFormat: "listDayAltFormat",
  eventBackgroundColor: "eventColor",
  eventTextColor: "eventContrastColor",
  customButtons: "buttons",
  weekText: "weekTextShort",
  allDayContent: "allDayHeaderContent",
  slotLabelContent: "slotHeaderContent",
  weekNumberContent: "weekNumberHeaderContent",
  dayCellContent: "dayCellTopContent",
};

/** The views whose switching button FullCalendar 5 and 6 labelled with
 * `buttonText[unit]`. FullCalendar 7 reads `buttons[view].text` instead. */
const ViewsByButtonTextUnit: Record<string, string[]> = {
  month: ["dayGridMonth"],
  week: ["dayGridWeek", "timeGridWeek"],
  day: ["dayGridDay", "timeGridDay"],
  list: ["listDay", "listWeek", "listMonth", "listYear"],
};

/** Options from FullCalendar 5 and 6 that FullCalendar 7 removed outright. */
const RemovedOptions = new Set([
  "handleWindowResize",
  "windowResizeDelay",
  "titleRangeSeparator",
  "defaultRangeSeparator",
  "buttonIcons",
  "themeSystem",
  // FullCalendar 7 colors an event with a single color; there is no
  // separate border color to give it.
  "eventBorderColor",
]);

export interface TranslatedOptions {
  options: CalendarOptions;
  /** What was changed, for an itinerary's debug output. */
  notes: string[];
}

/** Merges `field` of each entry in `values` into the matching button of
 * `options.buttons`: `{today: "Now"}` becomes `buttons.today.text`. */
function mergeIntoButtons(
  options: Record<string, unknown>,
  values: Record<string, unknown>,
  field: string
): void {
  const buttons: Record<string, unknown> = isRecord(options.buttons)
    ? { ...options.buttons }
    : {};
  for (const [name, value] of Object.entries(values)) {
    const existing = buttons[name];
    buttons[name] = { ...(isRecord(existing) ? existing : {}), [field]: value };
  }
  options.buttons = buttons;
}

/** Gives each view button the text `buttonText` set for its unit, unless
 * a view-specific text is set already. */
function labelViewButtons(
  options: Record<string, unknown>,
  buttonText: Record<string, unknown>
): void {
  const buttons: Record<string, unknown> = isRecord(options.buttons)
    ? { ...options.buttons }
    : {};
  for (const [unit, views] of Object.entries(ViewsByButtonTextUnit)) {
    if (!(unit in buttonText)) {
      continue;
    }
    for (const view of views) {
      const existing = isRecord(buttons[view]) ? buttons[view] : {};
      if (existing.text === undefined) {
        buttons[view] = { ...existing, text: buttonText[unit] };
      }
    }
  }
  options.buttons = buttons;
}

/** Renames and drops options in place; used for the calendar's options and
 * for each view's under `views`. `path` prefixes option names in notes. */
function translateRenamedAndRemoved(
  options: Record<string, unknown>,
  path: string,
  notes: string[]
): void {
  for (const [legacy, current] of Object.entries(RenamedOptions)) {
    if (!(legacy in options)) {
      continue;
    }
    const value = options[legacy];
    delete options[legacy];
    if (current in options) {
      notes.push(
        `Option '${path}${legacy}' is now called '${current}'; ignored it because '${current}' is also set.`
      );
      continue;
    }
    options[current] = value;
    notes.push(
      `Option '${path}${legacy}' is now called '${current}'; used it as that.`
    );
  }

  for (const removed of RemovedOptions) {
    if (removed in options) {
      delete options[removed];
      notes.push(`Option '${path}${removed}' no longer exists; ignored it.`);
    }
  }
}

/** Translates FullCalendar 5 and 6 options in an itinerary into their
 * FullCalendar 7 equivalents, so itineraries written for earlier versions
 * of this plugin keep working. */
export function translateLegacyOptions(
  input: Record<string, unknown>
): TranslatedOptions {
  const options: Record<string, unknown> = { ...input };
  const notes: string[] = [];

  if (!("headerToolbar" in options)) {
    options.headerToolbar = DefaultHeaderToolbar;
  } else if (options.headerToolbar === null || options.headerToolbar === "") {
    // `headerToolbar:` with no value hid the toolbar before FullCalendar 7.
    options.headerToolbar = false;
  }

  translateRenamedAndRemoved(options, "", notes);

  // `buttonText: {today: "Now"}` became `buttons: {today: {text: "Now"}}`,
  // and `buttonHints` likewise became each button's `hint`.
  for (const [legacy, field] of [
    ["buttonText", "text"],
    ["buttonHints", "hint"],
  ] as const) {
    if (!(legacy in options)) {
      continue;
    }
    const values = options[legacy];
    delete options[legacy];
    if (isRecord(values)) {
      mergeIntoButtons(options, values, field);
      if (legacy === "buttonText") {
        labelViewButtons(options, values);
      }
      notes.push(`Option '${legacy}' is now part of 'buttons'; used it as that.`);
    }
  }

  // Options for one view: the same renames apply, and a view's
  // `buttonText` (the label of the button that switches to it) moved to
  // `buttons[view].text`.
  if (isRecord(options.views)) {
    const views: Record<string, unknown> = {};
    for (const [name, viewInput] of Object.entries(options.views)) {
      if (!isRecord(viewInput)) {
        views[name] = viewInput;
        continue;
      }
      const view: Record<string, unknown> = { ...viewInput };
      translateRenamedAndRemoved(view, `views.${name}.`, notes);
      if ("buttonText" in view) {
        mergeIntoButtons(options, { [name]: view.buttonText }, "text");
        delete view.buttonText;
        notes.push(
          `Option 'views.${name}.buttonText' is now part of 'buttons'; used it as that.`
        );
      }
      views[name] = view;
    }
    options.views = views;
  }

  // Options in an itinerary are passed through to FullCalendar, which
  // validates them itself.
  return { options, notes };
}
