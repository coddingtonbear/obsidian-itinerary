import {
  App,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  SettingDefinitionPage,
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

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (typeof value === "string" && writeRuleField(this.host.rules, key, value)) {
      await this.save();
    }
  }

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

  /** Saves and redraws, so names and warnings in the list stay current. */
  private async save(): Promise<void> {
    await this.host.saveRules();
    this.update();
  }
}
