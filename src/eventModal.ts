import {
  AbstractInputSuggest,
  App,
  Modal,
  Setting,
  TextComponent,
} from "obsidian";

import {
  EventFormValues,
  completeTag,
  convertFormTime,
  emptyEventForm,
  eventBlock,
  parseTagInput,
  suggestTags,
  suggestTimeZones,
  validateEventForm,
} from "./eventForm";

/** Suggests from a fixed list of values, replacing the input's text with
 * what `complete` makes of the chosen one. */
class ListSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private suggest: (query: string) => string[],
    private complete: (query: string, value: string) => string
  ) {
    super(app, inputEl);
  }

  protected getSuggestions(query: string): string[] {
    return this.suggest(query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.setValue(this.complete(this.getValue(), value));
    this.inputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}

function timeZones(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

/** The "Insert itinerary event" form. `onSubmit` receives the finished
 * `itinerary-event` block. */
export class EventModal extends Modal {
  private values: EventFormValues = emptyEventForm();
  private startInput!: TextComponent;
  private endInput!: TextComponent;
  private endSetting!: Setting;
  private timeZoneSetting!: Setting;
  private problemsEl!: HTMLElement;

  constructor(
    app: App,
    private knownTags: string[],
    private onSubmit: (block: string) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Insert itinerary event");
    const { contentEl } = this;
    contentEl.addClass("itinerary-event-form");

    new Setting(contentEl).setName("Title").addText((text) => {
      text.onChange((value) => (this.values.title = value));
      window.setTimeout(() => text.inputEl.focus(), 0);
    });

    new Setting(contentEl)
      .setName("All day")
      .setDesc("Whether the event takes whole days rather than a set time.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.values.allDay)
          .onChange((allDay) => this.setAllDay(allDay))
      );

    new Setting(contentEl).setName("Start").addText((text) => {
      this.startInput = text;
      text.onChange((value) => (this.values.start = value));
    });

    this.endSetting = new Setting(contentEl).addText((text) => {
      this.endInput = text;
      text.onChange((value) => (this.values.end = value));
    });

    this.timeZoneSetting = new Setting(contentEl)
      .setName("Time zone")
      .setDesc(
        "The zone the times are in. Type a city to find it. Leave empty for your own."
      )
      .addText((text) => {
        text.onChange((value) => (this.values.timeZone = value));
        new ListSuggest(
          this.app,
          text.inputEl,
          (query) => suggestTimeZones(query, timeZones()),
          (_, zone) => zone
        );
      });

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Separate tags with commas, as in: hotel, flight.")
      .addText((text) => {
        text.onChange((value) => (this.values.tags = parseTagInput(value)));
        new ListSuggest(
          this.app,
          text.inputEl,
          (query) => suggestTags(query, this.knownTags),
          completeTag
        );
      });

    new Setting(contentEl)
      .setName("Color")
      .setDesc(
        "Any CSS color, such as red or #3a7bd5. Leave empty for the theme's accent color."
      )
      .addText((text) => {
        text.onChange((value) => (this.values.color = value));
      });

    this.problemsEl = contentEl.createDiv({ cls: "itinerary-event-form-problems" });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Insert")
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      );

    this.scope.register([], "Enter", (evt) => {
      if (!evt.isComposing) {
        evt.preventDefault();
        this.submit();
      }
    });

    this.setAllDay(this.values.allDay);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private setAllDay(allDay: boolean): void {
    this.values.allDay = allDay;
    const type = allDay ? "date" : "datetime-local";
    for (const input of [this.startInput, this.endInput]) {
      const converted = convertFormTime(input.getValue(), allDay);
      input.inputEl.type = type;
      input.setValue(converted);
    }
    this.values.start = this.startInput.getValue();
    this.values.end = this.endInput.getValue();

    if (allDay) {
      this.endSetting
        .setName("Last day")
        .setDesc(
          "The last day the event covers. It's written as the day after, " +
            "because an all-day event's end date is exclusive."
        );
    } else {
      this.endSetting.setName("End").setDesc("");
    }
    // A time zone means nothing for whole days.
    this.timeZoneSetting.settingEl.toggle(!allDay);
  }

  private submit(): void {
    const problems = validateEventForm(this.values);
    this.problemsEl.empty();
    if (problems.length > 0) {
      for (const problem of problems) {
        this.problemsEl.createDiv({ text: problem });
      }
      return;
    }
    this.onSubmit(eventBlock(this.values));
    this.close();
  }
}
