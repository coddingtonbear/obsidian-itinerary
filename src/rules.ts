import { parseYaml, stringifyYaml } from "obsidian";

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
  /** Null when `when` doesn't compile; the rule then matches nothing. */
  filter: EventFilter | null;
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
  const patch = parsed ?? {};
  if (!isRecord(patch)) {
    throw new Error("Expected a set of `key: value` event options.");
  }
  if (
    patch.order !== undefined &&
    patch.order !== null &&
    (typeof patch.order !== "number" || !Number.isFinite(patch.order))
  ) {
    throw new Error('"order" must be a number.');
  }
  return patch;
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
    return error === null
      ? { rule, filter: compileFilter(rule.when) }
      : { rule, filter: null, error };
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
  const matched: { rule: EventRule; index: number }[] = [];
  const errors: RuledEvent["errors"] = [];
  rules.forEach(({ rule, filter }, index) => {
    if (filter === null) {
      // Reported once, by whatever shows the rules, not for every event.
      return;
    }
    const result = filter(event);
    if (result.error !== undefined) {
      errors.push({ name: ruleLabel(rule, index), error: result.error });
    } else if (result.matched) {
      matched.push({ rule, index });
    }
  });
  if (matched.length === 0) {
    return { event, matches: [], errors };
  }

  // Lowest priority first, so higher rules' fields land on top.
  let options: unknown = {};
  for (const { rule } of [...matched].reverse()) {
    options = mergePatch(options, rule.set);
  }
  const fromRules = withColorFallbacks(isRecord(options) ? options : {});
  const merged = mergePatch(fromRules, event) as EventSpec;

  const decided = new Set(Object.keys(event));
  const matches = matched.map(({ rule, index }) => {
    const fields = Object.keys(rule.set).filter(
      (field) => rule.set[field] !== null && !decided.has(field)
    );
    for (const field of fields) {
      decided.add(field);
    }
    return { name: ruleLabel(rule, index), fields };
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
