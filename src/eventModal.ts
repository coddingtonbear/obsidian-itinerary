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
  defaultTimeZone,
  emptyEventForm,
  setEndTimeZone,
  setStartTimeZone,
  suggestTags,
  suggestTimeZones,
  switchAllDay,
  tagFieldText,
  tagsFromField,
  validateEventForm,
} from "./eventForm";

/** Suggests from a list of values, replacing a text field's value with
 * what `complete` makes of the chosen one. Setting the value fires no
 * `input` event, so the field's `onChange` is invoked directly. */
class ListSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private text: TextComponent,
    private suggest: (query: string) => string[],
    private complete: (query: string, value: string) => string
  ) {
    super(app, text.inputEl);
  }

  protected getSuggestions(query: string): string[] {
    return this.suggest(query);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string): void {
    this.text.setValue(this.complete(this.text.getValue(), value));
    this.text.onChanged();
    this.close();
  }
}

let zoneList: string[] | null = null;

function timeZones(): string[] {
  if (zoneList === null) {
    const zones = Intl.supportedValuesOf("timeZone");
    zoneList = zones.includes("UTC") ? zones : [...zones, "UTC"];
  }
  return zoneList;
}

/** How the form is used when editing an event rather than inserting one. */
export interface EventModalOptions {
  heading: string;
  submitText: string;
  values: EventFormValues;
}

/** The "Insert itinerary event" form, also used to edit an event.
 * `onSubmit` receives the form's values once they're valid. */
export class EventModal extends Modal {
  private values: EventFormValues;
  private readonly initialTags: string[];
  private readonly heading: string;
  private readonly submitText: string;
  private startInput!: TextComponent;
  private endInput!: TextComponent;
  private endSetting!: Setting;
  private startTimeZoneSetting!: Setting;
  private endTimeZoneSetting!: Setting;
  private endTimeZoneInput!: TextComponent;
  private problemsEl!: HTMLElement;

  constructor(
    app: App,
    private knownTags: string[],
    private onSubmit: (values: EventFormValues) => void,
    options?: EventModalOptions
  ) {
    super(app);
    this.heading = options?.heading ?? "Insert itinerary event";
    this.submitText = options?.submitText ?? "Insert";
    this.values = options?.values ?? emptyEventForm(defaultTimeZone());
    this.initialTags = this.values.tags;
  }

  onOpen(): void {
    this.setTitle(this.heading);
    const { contentEl } = this;
    contentEl.addClass("itinerary-event-form");

    new Setting(contentEl).setName("Title").addText((text) => {
      text.setValue(this.values.title);
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

    this.startTimeZoneSetting = new Setting(contentEl)
      .setName("Start time zone")
      .setDesc(
        "The zone the start is in. Type a city to find it. Leave empty for " +
          "the zone the event is displayed in."
      )
      .addText((text) => {
        text.setValue(this.values.startTimeZone);
        text.onChange((value) => {
          this.values = setStartTimeZone(this.values, value);
          this.endTimeZoneInput.setValue(this.values.endTimeZone);
        });
        this.addTimeZoneSuggest(text);
      });

    this.endTimeZoneSetting = new Setting(contentEl)
      .setName("End time zone")
      .setDesc(
        "Follows the start's zone; change it for an event that ends " +
          "somewhere else, such as a flight."
      )
      .addText((text) => {
        this.endTimeZoneInput = text;
        text.setValue(this.values.endTimeZone);
        text.onChange(
          (value) => (this.values = setEndTimeZone(this.values, value))
        );
        this.addTimeZoneSuggest(text);
      });

    new Setting(contentEl)
      .setName("Tags")
      .setDesc("Separate tags with commas, as in: hotel, flight.")
      .addText((text) => {
        text.setValue(tagFieldText(this.values.tags));
        text.onChange(
          (value) => (this.values.tags = tagsFromField(value, this.initialTags))
        );
        new ListSuggest(
          this.app,
          text,
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
        text.setValue(this.values.color);
        text.onChange((value) => (this.values.color = value));
      });

    this.problemsEl = contentEl.createDiv({ cls: "itinerary-event-form-problems" });

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText(this.submitText)
          .setCta()
          .onClick(() => this.submit())
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      );

    // Enter in a field submits the form; on a button or the toggle it does
    // what it does there (so Enter on Cancel cancels). instanceOf, unlike
    // instanceof, also works when the modal is in a popout window.
    this.scope.register([], "Enter", (evt) => {
      const target = evt.targetNode;
      if (
        target?.instanceOf(HTMLInputElement) &&
        target.type !== "checkbox" &&
        !evt.isComposing
      ) {
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
    this.values = switchAllDay(this.values, allDay);
    const type = allDay ? "date" : "datetime-local";
    this.startInput.inputEl.type = type;
    this.startInput.setValue(this.values.start);
    this.endInput.inputEl.type = type;
    this.endInput.setValue(this.values.end);
    // Problems from the last attempt are worded for the other kind of time.
    this.problemsEl.empty();

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
    this.startTimeZoneSetting.settingEl.toggle(!allDay);
    this.endTimeZoneSetting.settingEl.toggle(!allDay);
  }

  private addTimeZoneSuggest(text: TextComponent): void {
    new ListSuggest(
      this.app,
      text,
      (query) => suggestTimeZones(query, timeZones()),
      (_, zone) => zone
    );
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
    this.onSubmit(this.values);
    this.close();
  }
}
