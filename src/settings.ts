import {
  App,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  SettingDefinitionPage,
  TextComponent,
  debounce,
} from "obsidian";

import {
  EventRule,
  checkWhen,
  compileRules,
  parseRulePatch,
  readRuleField,
  writeRuleField,
} from "./rules";
import { errorMessage } from "./util";

/** What the settings tab edits. */
export interface RuleSettingsHost extends Plugin {
  rules: EventRule[];
  /** Saves `rules` and applies them to open itineraries and summaries. */
  saveRules(): Promise<void>;
}

/** Obsidian 1.14 finds an open page by its `id`, or its name without one,
 * but doesn't declare `id`. Rule pages need it: a rule's name changes as
 * it's typed, and two rules can share one. */
type RulePage = SettingDefinitionPage & { id: string };

/** Shown for a rule until it's given a name. */
const UnnamedRule = "Unnamed rule";

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
        name: "Event rules",
        desc: "An event rule sets options on every event matching a filter expression, so you can make every hotel brown, or list it first on its day, without writing color or order in each one. Every matching rule applies: where two set the same option, the higher one in the list wins, and options written in an event win over any rule.",
      },
      {
        type: "list",
        heading: "Rules",
        emptyState: "No rules yet.",
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
      // rewrite "Set" from the saved options mid-edit. The list catches up
      // when the rule's page is left (see the Name row).
      this.listStale = true;
      this.saveSoon();
    }
  }

  /** Typing in a rule re-renders every open itinerary; wait for a pause. */
  private readonly saveSoon = debounce(
    () => void this.host.saveRules(),
    500,
    true
  );

  /** Whether a rule changed since the list was last drawn. */
  private listStale = false;

  private rulePage(rule: EventRule, index: number): RulePage {
    return {
      type: "page",
      id: `rule-${index}`,
      name: rule.name.trim() !== "" ? rule.name : UnnamedRule,
      desc: rule.when,
      // Also catches options saved before they were checked.
      status: () =>
        compileRules([rule])[0].error === undefined ? null : "warning",
      items: [
        {
          name: "Name",
          desc: "Shown in this list and in an itinerary's debug output.",
          // Not a control, so leaving the page can redraw the list (and
          // this page's title, next time) with the rule as edited: the list
          // is drawn from definitions made before the edit. Any row would
          // do; this one is torn down along with the page.
          render: (setting) => {
            setting.addText((text: TextComponent) =>
              text
                .setPlaceholder("Hotels")
                .setValue(rule.name)
                .onChange((value) => {
                  rule.name = value;
                  this.listStale = true;
                  this.saveSoon();
                })
            );
            return () => {
              if (this.listStale) {
                this.listStale = false;
                // After Obsidian finishes leaving the page, which draws
                // the list from the definitions it has.
                window.setTimeout(() => this.update());
              }
            };
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
