import { parseYaml, stringifyYaml } from "obsidian";

import { readBoolean, readNumber, readString } from "./extractor";
import { EventFilter, compileFilter } from "./filter";
import { EventSpec } from "./types";
import { errorMessage, isRecord } from "./util";

/** A vault-wide rule: event options to apply to every event matching an
 * expression. */
export interface EventRule {
  /** A label for the settings UI and debug output. */
  name: string;
  /** A filter expression (see filter.ts) matched against each event. */
  when: string;
  /** A JSON Merge Patch (RFC 7386) of event options. */
  set: Record<string, unknown>;
}

export interface CompiledRule {
  rule: EventRule;
  /** Null when `when` doesn't compile or `set` is invalid; the rule then
   * matches nothing. */
  filter: EventFilter | null;
  /** `set`, read as an event's options would be, with `color` spread to
   * the background and border colors it implies. */
  patch: Record<string, unknown>;
  error?: string;
}

/** A rule an event matched, and the fields it decided. */
export interface RuleMatch {
  name: string;
  /** Fields of the rule's `set` that weren't overridden by the event itself
   * or by a rule higher in the list. */
  fields: string[];
}

export interface RuledEvent {
  event: EventSpec;
  matches: RuleMatch[];
  /** Rules whose `when` couldn't be evaluated for this event, and why. A
   * rule whose `when` doesn't compile at all isn't listed: see
   * CompiledRule.error. */
  errors: { name: string; error: string }[];
}

/** Applies a JSON Merge Patch (RFC 7386) to a value: objects merge key by
 * key, a `null` removes a key, and anything else (lists included) replaces
 * the value outright. Neither argument is modified. */
export function mergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key];
    } else {
      result[key] = mergePatch(result[key], value);
    }
  }
  return result;
}

/** Checks a rule's `when` expression; returns why it's invalid, or null. */
export function checkWhen(expression: string): string | null {
  if (expression.trim() === "") {
    return "Enter an expression.";
  }
  try {
    compileFilter(expression);
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}

/** Reads a rule's `set` patch from YAML; throws if it isn't a set of
 * `key: value` options. */
export function parseRulePatch(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (e) {
    throw new Error(`Could not parse YAML: ${errorMessage(e)}`);
  }
  return readRulePatch(parsed ?? {});
}

/** Options a rule can't set: an event's times are interpreted (and its
 * title defaulted) while the event is read, before any rule applies, so a
 * rule's value would never take effect. */
const UnsettableOptions = [
  "title",
  "start",
  "end",
  "timeZone",
  "startTimeZone",
  "endTimeZone",
];

/** Checks a rule's `set` patch and reads its values the way the same
 * options are read from an event (`hidden: "no"` is false, `order: "2"` is
 * 2), so a rule means what the option means when written on an event. A
 * `null` is kept: it removes the option. Throws if the patch is invalid. */
export function readRulePatch(patch: unknown): Record<string, unknown> {
  if (!isRecord(patch)) {
    throw new Error("Expected a set of `key: value` event options.");
  }
  for (const field of UnsettableOptions) {
    if (field in patch) {
      throw new Error(`"${field}" can't be set by a rule.`);
    }
  }
  const result: Record<string, unknown> = { ...patch };
  const readers: [string[], (spec: Record<string, unknown>, field: string) => unknown][] = [
    [["hidden", "allDay"], readBoolean],
    [["order"], readNumber],
    [["color", "backgroundColor", "borderColor", "textColor"], readString],
  ];
  for (const [fields, read] of readers) {
    for (const field of fields) {
      if (patch[field] !== undefined && patch[field] !== null) {
        result[field] = read(patch, field);
      }
    }
  }
  return result;
}

/** Reads rules from saved settings, dropping any that aren't well formed
 * rather than failing to load the plugin. */
export function normalizeRules(value: unknown): EventRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((rule) => ({
    name: typeof rule.name === "string" ? rule.name : "",
    when: typeof rule.when === "string" ? rule.when : "",
    set: isRecord(rule.set) ? rule.set : {},
  }));
}

/** Reads `rules.<index>.<field>` as the settings tab shows it: `set` as
 * YAML text. Returns undefined for a key naming no rule. */
export function readRuleField(
  rules: readonly EventRule[],
  key: string
): string | undefined {
  const target = parseRuleKey(rules, key);
  if (target === null) {
    return undefined;
  }
  const { rule, field } = target;
  if (field === "set") {
    return Object.keys(rule.set).length > 0 ? stringifyYaml(rule.set) : "";
  }
  return rule[field];
}

/** Writes `rules.<index>.<field>` from the settings tab; returns whether
 * anything changed. A `set` that isn't valid YAML options is ignored. */
export function writeRuleField(
  rules: readonly EventRule[],
  key: string,
  value: string
): boolean {
  const target = parseRuleKey(rules, key);
  if (target === null) {
    return false;
  }
  const { rule, field } = target;
  if (field === "set") {
    try {
      rule.set = parseRulePatch(value);
    } catch {
      return false;
    }
  } else {
    rule[field] = value;
  }
  return true;
}

function parseRuleKey(
  rules: readonly EventRule[],
  key: string
): { rule: EventRule; field: "name" | "when" | "set" } | null {
  const match = /^rules\.(\d+)\.(name|when|set)$/.exec(key);
  const rule = match ? rules[Number(match[1])] : undefined;
  if (!match || rule === undefined) {
    return null;
  }
  return { rule, field: match[2] as "name" | "when" | "set" };
}

export function compileRules(rules: readonly EventRule[]): CompiledRule[] {
  return rules.map((rule) => {
    const error = checkWhen(rule.when);
    if (error !== null) {
      return { rule, filter: null, patch: {}, error };
    }
    try {
      // Saved settings may predate a check, or have been edited by hand.
      const patch = withColorFallbacks(readRulePatch(rule.set));
      return { rule, filter: compileFilter(rule.when), patch };
    } catch (e) {
      return { rule, filter: null, patch: {}, error: errorMessage(e) };
    }
  });
}

/** A rule's name for messages; rules don't have to be named. */
export function ruleLabel(rule: EventRule, index: number): string {
  return rule.name.trim() !== "" ? rule.name : `#${index + 1}`;
}

/** The colors an event's options imply, as parseEventSpec reads them:
 * `color` sets the background and border unless they're set themselves. */
function withColorFallbacks(
  options: Record<string, unknown>
): Record<string, unknown> {
  const { color } = options;
  if (typeof color !== "string") {
    return options;
  }
  return {
    ...options,
    backgroundColor: options.backgroundColor ?? color,
    borderColor: options.borderColor ?? color,
  };
}

/** Applies rules to an event.
 *
 * Every rule's `when` sees the event as written, so rules don't depend on
 * one another. Every matching rule applies; where two set the same field,
 * the one higher in the list wins. The event's own fields go on top, field
 * by field, so a value written in the event always beats a rule. */
export function applyRules(
  event: EventSpec,
  rules: readonly CompiledRule[]
): RuledEvent {
  const matched: { rule: EventRule; patch: Record<string, unknown>; index: number }[] = [];
  const errors: RuledEvent["errors"] = [];
  rules.forEach(({ rule, filter, patch }, index) => {
    if (filter === null) {
      // Reported once, by whatever shows the rules, not for every event.
      return;
    }
    const result = filter(event);
    if (result.error !== undefined) {
      errors.push({ name: ruleLabel(rule, index), error: result.error });
    } else if (result.matched) {
      matched.push({ rule, patch, index });
    }
  });
  if (matched.length === 0) {
    return { event, matches: [], errors };
  }

  // Lowest priority first, so higher rules' fields land on top. Each
  // rule's `color` was already spread to its background and border, so a
  // higher rule's `color` beats a lower rule's `backgroundColor`.
  let options: unknown = {};
  for (const { patch } of [...matched].reverse()) {
    options = mergePatch(options, patch);
  }
  const merged = mergePatch(options, event) as EventSpec;

  const decided = new Set(Object.keys(event));
  const matches = matched.map(({ rule, index }) => {
    const fields = Object.keys(rule.set).filter((field) => !decided.has(field));
    for (const field of fields) {
      decided.add(field);
    }
    // A `null` decides the field (it removes it) but sets nothing.
    return {
      name: ruleLabel(rule, index),
      fields: fields.filter((field) => rule.set[field] !== null),
    };
  });
  return { event: merged, matches, errors };
}

/** The vault's rules, compiled, telling subscribers when they change. */
export class RuleBook {
  private compiled: CompiledRule[] = [];
  private listeners = new Set<() => void>();

  constructor(rules: readonly EventRule[] = []) {
    this.compiled = compileRules(rules);
  }

  get rules(): readonly CompiledRule[] {
    return this.compiled;
  }

  setRules(rules: readonly EventRule[]): void {
    this.compiled = compileRules(rules);
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  /** Registers a listener; returns a function that unregisters it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(event: EventSpec): RuledEvent {
    return applyRules(event, this.compiled);
  }
}
