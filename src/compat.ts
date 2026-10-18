import { CalendarOptions } from "fullcalendar";

import { isRecord } from "./util";

/** The toolbar FullCalendar 6 showed when `headerToolbar` was left unset.
 * FullCalendar 7 shows no toolbar by default; itineraries written before
 * the upgrade expect this one. */
export const DefaultHeaderToolbar = {
  start: "title",
  center: "",
  end: "today prev,next",
};

/** FullCalendar 6 options that FullCalendar 7 renamed without changing
 * what they accept. */
const RenamedOptions: Record<string, string> = {
  stickyHeaderDates: "tableHeaderSticky",
  stickyFooterScrollbar: "footerScrollbarSticky",
  dayPopoverFormat: "popoverFormat",
  slotLabelFormat: "slotHeaderFormat",
  slotLabelInterval: "slotHeaderInterval",
  listDaySideFormat: "listDayAltFormat",
  multiMonthMinWidth: "singleMonthMinWidth",
  multiMonthTitleFormat: "singleMonthTitleFormat",
  eventBackgroundColor: "eventColor",
  eventBorderColor: "eventColor",
  eventTextColor: "eventContrastColor",
  customButtons: "buttons",
};

/** FullCalendar 6 options that FullCalendar 7 removed outright. */
const RemovedOptions = new Set([
  "handleWindowResize",
  "windowResizeDelay",
  "titleRangeSeparator",
  "defaultRangeSeparator",
  "buttonIcons",
]);

export interface TranslatedOptions {
  options: CalendarOptions;
  /** What was changed, for an itinerary's debug output. */
  notes: string[];
}

/** Translates FullCalendar 6 options in an itinerary into their
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
    // `headerToolbar:` with no value hid the toolbar in FullCalendar 6.
    options.headerToolbar = false;
  }

  for (const [legacy, current] of Object.entries(RenamedOptions)) {
    if (!(legacy in options)) {
      continue;
    }
    const value = options[legacy];
    delete options[legacy];
    if (current in options) {
      notes.push(
        `Option '${legacy}' is now called '${current}'; ignored it because '${current}' is also set.`
      );
      continue;
    }
    options[current] = value;
    notes.push(`Option '${legacy}' is now called '${current}'; used it as that.`);
  }

  // `buttonText: {today: "Now"}` became `buttons: {today: {text: "Now"}}`.
  if ("buttonText" in options) {
    const buttonText = options.buttonText;
    delete options.buttonText;
    if (isRecord(buttonText)) {
      const buttons: Record<string, unknown> = isRecord(options.buttons)
        ? { ...options.buttons }
        : {};
      for (const [name, text] of Object.entries(buttonText)) {
        const existing = buttons[name];
        buttons[name] = { ...(isRecord(existing) ? existing : {}), text };
      }
      options.buttons = buttons;
      notes.push("Option 'buttonText' is now part of 'buttons'; used it as that.");
    }
  }

  for (const removed of RemovedOptions) {
    if (removed in options) {
      delete options[removed];
      notes.push(`Option '${removed}' no longer exists; ignored it.`);
    }
  }

  // Options in an itinerary are passed through to FullCalendar, which
  // validates them itself.
  return { options, notes };
}
