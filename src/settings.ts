import {
  App,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  SettingDefinitionPage,
  debounce,
} from "obsidian";

import {
  EventRule,
  checkWhen,
  parseRulePatch,
  readRuleField,
  ruleLabel,
  writeRuleField,
} from "./rules";
import { errorMessage } from "./util";

/** What the settings tab edits. */
export interface RuleSettingsHost extends Plugin {
  rules: EventRule[];
  /** Saves `rules` and applies them to open itineraries and summaries. */
  saveRules(): Promise<void>;
}

/** Settings tab listing the vault's event rules, one page per rule. The
 * list order is their priority, so rules can be dragged to reorder them.
 * Reading and validating rules lives in rules.ts; this is Obsidian glue. */
export class ItinerarySettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: RuleSettingsHost
  ) {
    super(app, host);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const rules = this.host.rules;
    return [
      {
        type: "list",
        heading: "Event rules",
        emptyState:
          "No rules yet. A rule sets options on every event matching an expression, such as one color for every hotel.",
        items: rules.map((rule, index) => this.rulePage(rule, index)),
        addItem: {
          name: "Add rule",
          action: () => {
            rules.push({ name: "", when: "", set: {} });
            void this.save();
          },
        },
        onReorder: (from, to) => {
          const [moved] = rules.splice(from, 1);
          rules.splice(to, 0, moved);
          void this.save();
        },
        onDelete: (index) => {
          rules.splice(index, 1);
          void this.save();
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return readRuleField(this.host.rules, key);
  }

  setControlValue(key: string, value: unknown): void {
    if (typeof value === "string" && writeRuleField(this.host.rules, key, value)) {
      // Not update(): that would re-render the field being typed in, and
      // rewrite "Set" from the saved options mid-edit. The list's names and
      // warnings catch up the next time it's shown.
      this.refreshDomState();
      this.saveSoon();
    }
  }

  /** Typing in a rule re-renders every open itinerary; wait for a pause. */
  private readonly saveSoon = debounce(
    () => void this.host.saveRules(),
    500,
    true
  );

  private rulePage(rule: EventRule, index: number): SettingDefinitionPage {
    return {
      type: "page",
      name: ruleLabel(rule, index),
      desc: rule.when,
      status: () => (checkWhen(rule.when) === null ? null : "warning"),
      items: [
        {
          name: "Name",
          desc: "Shown in this list and in an itinerary's debug output.",
          control: {
            type: "text",
            key: `rules.${index}.name`,
            placeholder: "Hotels",
          },
        },
        {
          name: "When",
          desc: 'A filter expression the event must match, e.g. "hotel" in tag. Events are matched as written, before any rule applies.',
          control: {
            type: "text",
            key: `rules.${index}.when`,
            placeholder: '"hotel" in tag',
            validate: (value) => checkWhen(value) ?? undefined,
          },
        },
        {
          name: "Set",
          desc: "Event options to apply, as YAML. Options written in an event win over these, and so do rules higher in the list.",
          control: {
            type: "textarea",
            key: `rules.${index}.set`,
            placeholder: "color: brown\norder: 1",
            rows: 4,
            validate: (value) => {
              try {
                parseRulePatch(value);
                return undefined;
              } catch (e) {
                return errorMessage(e);
              }
            },
          },
        },
      ],
    };
  }

  hide(): void {
    // Don't lose an edit made just before the settings were closed.
    this.saveSoon.run();
    super.hide();
  }

  /** Saves and redraws the list after a rule is added, moved or removed. */
  private async save(): Promise<void> {
    // Any edit still waiting to be saved is in `rules` already.
    this.saveSoon.cancel();
    await this.host.saveRules();
    this.update();
  }
}
