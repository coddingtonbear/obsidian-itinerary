import { describe, expect, test } from "vitest";

import { DefaultHeaderToolbar, translateLegacyOptions } from "./compat";

describe("translateLegacyOptions", () => {
  test("shows the pre-7 toolbar when none is configured", () => {
    expect(translateLegacyOptions({}).options.headerToolbar).toEqual(
      DefaultHeaderToolbar
    );
  });

  test("hides the toolbar when it is set empty", () => {
    expect(
      translateLegacyOptions({ headerToolbar: null }).options.headerToolbar
    ).toBe(false);
    expect(
      translateLegacyOptions({ headerToolbar: false }).options.headerToolbar
    ).toBe(false);
  });

  test("keeps a configured toolbar", () => {
    const headerToolbar = { start: "prev,next", center: "title", end: "" };
    expect(translateLegacyOptions({ headerToolbar }).options.headerToolbar).toBe(
      headerToolbar
    );
  });

  test("renames options and says so", () => {
    const { options, notes } = translateLegacyOptions({
      slotLabelFormat: "h:mm",
      eventTextColor: "black",
    });
    expect(options.slotHeaderFormat).toBe("h:mm");
    expect(options.eventContrastColor).toBe("black");
    expect(options).not.toHaveProperty("slotLabelFormat");
    expect(options).not.toHaveProperty("eventTextColor");
    expect(notes).toEqual([
      "Option 'slotLabelFormat' is now called 'slotHeaderFormat'; used it as that.",
      "Option 'eventTextColor' is now called 'eventContrastColor'; used it as that.",
    ]);
  });

  test("prefers the new name when both are set", () => {
    const { options, notes } = translateLegacyOptions({
      slotLabelFormat: "h:mm",
      slotHeaderFormat: "HH:mm",
    });
    expect(options.slotHeaderFormat).toBe("HH:mm");
    expect(notes[0]).toMatch(/ignored it because 'slotHeaderFormat'/);
  });

  test("folds buttonText into buttons", () => {
    const { options } = translateLegacyOptions({
      buttonText: { today: "Now" },
      customButtons: { mine: { text: "Mine" } },
    });
    expect(options.buttons).toEqual({
      mine: { text: "Mine" },
      today: { text: "Now" },
    });
  });

  test("translates options set for a single view", () => {
    const { options, notes } = translateLegacyOptions({
      views: {
        timeGridWeek: { slotLabelFormat: "h:mm", buttonText: "7 days" },
      },
    });
    expect(options.views).toEqual({
      timeGridWeek: { slotHeaderFormat: "h:mm" },
    });
    expect(options.buttons).toEqual({ timeGridWeek: { text: "7 days" } });
    expect(notes).toEqual([
      "Option 'views.timeGridWeek.slotLabelFormat' is now called 'slotHeaderFormat'; used it as that.",
      "Option 'views.timeGridWeek.buttonText' is now part of 'buttons'; used it as that.",
    ]);
  });

  test("renames weekText and folds buttonHints into buttons", () => {
    const { options } = translateLegacyOptions({
      weekText: "Wk",
      buttonHints: { prev: "Back" },
    });
    expect(options.weekTextShort).toBe("Wk");
    expect(options.buttons).toEqual({ prev: { hint: "Back" } });
  });

  test("drops eventBorderColor, which has no FullCalendar 7 equivalent", () => {
    const { options, notes } = translateLegacyOptions({
      eventBorderColor: "red",
    });
    expect(options).not.toHaveProperty("eventColor");
    expect(notes).toEqual([
      "Option 'eventBorderColor' no longer exists; ignored it.",
    ]);
  });

  test("drops removed options", () => {
    const { options, notes } = translateLegacyOptions({
      titleRangeSeparator: " to ",
      initialView: "listDay",
    });
    expect(options).not.toHaveProperty("titleRangeSeparator");
    expect(options.initialView).toBe("listDay");
    expect(notes).toEqual([
      "Option 'titleRangeSeparator' no longer exists; ignored it.",
    ]);
  });

  test("leaves current options alone", () => {
    const { options, notes } = translateLegacyOptions({
      initialView: "timeGridWeek",
      timeZone: "America/New_York",
    });
    expect(options).toMatchObject({
      initialView: "timeGridWeek",
      timeZone: "America/New_York",
    });
    expect(notes).toEqual([]);
  });
});
