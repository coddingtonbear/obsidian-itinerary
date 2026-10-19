import { CalendarOptions } from "fullcalendar";
import { parseYaml } from "obsidian";

import { isRecord } from "./util";

/** The two kinds of fenced block this plugin reads. */
export type BlockKind = "itinerary" | "itinerary-event";

/** What can be written as a field's value, for suggesting it. */
type ValueKind = "boolean" | "timeZone" | "tag" | "view";

export interface FieldInfo {
  name: string;
  description: string;
  values?: ValueKind;
}

/** Fields of an `itinerary-event` block: the ones the Readme documents. */
export const EventFields: readonly FieldInfo[] = [
  { name: "title", description: "Name of the event" },
  { name: "start", description: "When it starts (ISO date or time)" },
  {
    name: "end",
    description: "When it ends; exclusive for all-day events",
  },
  {
    name: "allDay",
    description: "Whether it lasts all day",
    values: "boolean",
  },
  {
    name: "timeZone",
    description: "Time zone its times are written in",
    values: "timeZone",
  },
  {
    name: "startTimeZone",
    description: "Time zone of start, if different",
    values: "timeZone",
  },
  {
    name: "endTimeZone",
    description: "Time zone of end, if different",
    values: "timeZone",
  },
  { name: "tag", description: "A tag, or list of tags", values: "tag" },
  {
    name: "hidden",
    description: "Show only on itineraries, not here",
    values: "boolean",
  },
  { name: "order", description: "Where it's drawn among its day's events" },
  { name: "color", description: "Color to draw it in" },
  { name: "backgroundColor", description: "Fill color" },
  { name: "borderColor", description: "Border color of its summary" },
  { name: "textColor", description: "Text color" },
];

/** FullCalendar options worth suggesting in an itinerary: the common ones,
 * not all of them. Typed against FullCalendar's options, so an upgrade
 * that renames one fails typechecking. */
const CalendarFields: readonly (FieldInfo & {
  name: keyof CalendarOptions;
})[] = [
  { name: "initialDate", description: "Date to show first" },
  {
    name: "initialView",
    description: "Kind of calendar to show",
    values: "view",
  },
  {
    name: "timeZone",
    description: "Time zone to show times in",
    values: "timeZone",
  },
  { name: "duration", description: "Length of a custom view, e.g. days: 4" },
  {
    name: "headerToolbar",
    description: "Buttons above the calendar, or false",
  },
  { name: "eventOrder", description: "Fields to sort events by" },
  {
    name: "eventOrderStrict",
    description: "Always sort by eventOrder",
    values: "boolean",
  },
  { name: "eventColor", description: "Default color for events" },
  { name: "firstDay", description: "First day of the week (0 = Sunday)" },
  { name: "weekends", description: "Show weekends", values: "boolean" },
  { name: "hiddenDays", description: "Days of the week to leave out" },
  {
    name: "weekNumbers",
    description: "Show week numbers",
    values: "boolean",
  },
  {
    name: "nowIndicator",
    description: "Mark the current time",
    values: "boolean",
  },
  { name: "dayMaxEvents", description: "Events per day before +N more" },
  { name: "slotMinTime", description: "Earliest time in time grids" },
  { name: "slotMaxTime", description: "Latest time in time grids" },
  { name: "scrollTime", description: "Time grids scroll to this time" },
  { name: "titleFormat", description: "Format of the calendar's title" },
  { name: "eventTimeFormat", description: "Format of event times" },
];

/** Fields of an `itinerary` block. */
export const ItineraryFields: readonly FieldInfo[] = [
  { name: "source", description: "Note(s) to gather events from" },
  { name: "filter", description: "Expression(s) choosing events to show" },
  {
    name: "debug",
    description: "Explain filters and translations",
    values: "boolean",
  },
  ...CalendarFields,
];

/** The views of the FullCalendar plugins render.ts loads. */
export const CalendarViews: readonly string[] = [
  "dayGridMonth",
  "dayGridWeek",
  "dayGridDay",
  "dayGridYear",
  "dayGrid",
  "timeGridWeek",
  "timeGridDay",
  "timeGrid",
  "listYear",
  "listMonth",
  "listWeek",
  "listDay",
  "list",
];

/** Where a block of this plugin's sits in a document. */
export interface BlockLocation {
  kind: BlockKind;
  /** The line of the opening fence. */
  openLine: number;
  /** The line after the body: the closing fence, or for a block that
   * isn't closed yet (as while it's being written), the next opening
   * fence or the line count. */
  closeLine: number;
  /** The opening fence's indentation, which the body shares. */
  indent: string;
}

/** Read access to a document by line, as the editor offers it. */
export interface DocumentLines {
  lineCount: number;
  getLine(line: number): string;
}

// The fence rule of extractor.ts's EventBlockPattern: an opening fence
// naming the block, closed by the next bare fence. Other fences are not
// tracked, as there.
const OpenFencePattern = /^([ \t]*)```(itinerary|itinerary-event)[ \t]*$/;
const CloseFencePattern = /^[ \t]*```[ \t]*$/;

/** The `itinerary` and `itinerary-event` blocks of a document, in order.
 *
 * This differs from extractor.ts in one way, for blocks being written: an
 * opening fence inside a block that hasn't been closed yet ends it and
 * starts another, rather than being read as part of its body. Otherwise a
 * block started above an existing one would take in that one's fields. */
export function* blocksIn(
  doc: DocumentLines,
  /** Stop once past this line with no block open. */
  until = Infinity
): Generator<BlockLocation> {
  let open: Omit<BlockLocation, "closeLine"> | null = null;
  for (let i = 0; i < doc.lineCount; i++) {
    if (open === null && i > until) {
      return;
    }
    const text = doc.getLine(i);
    if (open !== null && CloseFencePattern.test(text)) {
      yield { ...open, closeLine: i };
      open = null;
      continue;
    }
    const match = OpenFencePattern.exec(text);
    if (match) {
      if (open !== null) {
        yield { ...open, closeLine: i };
      }
      open = { kind: match[2] as BlockKind, openLine: i, indent: match[1] };
    }
  }
  if (open !== null) {
    yield { ...open, closeLine: doc.lineCount };
  }
}

/** Finds the `itinerary` or `itinerary-event` block whose body holds the
 * given line, if any. */
export function findBlock(
  doc: DocumentLines,
  line: number
): BlockLocation | null {
  for (const block of blocksIn(doc, line)) {
    if (block.openLine >= line) {
      return null;
    }
    if (line < block.closeLine) {
      return block;
    }
  }
  return null;
}

/** Splits text into lines, for blocksIn. */
export function textLines(text: string): DocumentLines {
  const lines = text.split(/\r?\n/);
  return { lineCount: lines.length, getLine: (line) => lines[line] };
}

/** A block's body, with the fence's indentation taken off each line, and
 * how much was taken off each. */
function blockBody(
  doc: DocumentLines,
  block: BlockLocation
): { lines: string[]; removed: number[] } {
  const lines: string[] = [];
  const removed: number[] = [];
  for (let i = block.openLine + 1; i < block.closeLine; i++) {
    const line = doc.getLine(i);
    let n = 0;
    while (n < block.indent.length && line[n] === block.indent[n]) {
      n++;
    }
    lines.push(line.slice(n));
    removed.push(n);
  }
  return { lines, removed };
}

const KeyLinePattern = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:/;

/** The fields a block's body sets at the top level. */
export function presentFields(body: readonly string[]): Set<string> {
  const fields = new Set<string>();
  for (const line of body) {
    const match = KeyLinePattern.exec(line);
    if (match) {
      fields.add(match[1]);
    }
  }
  return fields;
}

/** What the text at the cursor is. */
export type CompletionTarget =
  | {
      type: "field";
      /** The part of the field name typed so far. */
      query: string;
      /** The span to replace, on the cursor's line. */
      from: number;
      to: number;
    }
  | {
      type: "value";
      field: string;
      query: string;
      from: number;
      to: number;
      /** Written before the value: a space, if the colon has none after
       * it (`allDay:true` isn't a field, to YAML). */
      prefix: string;
      /** Written after it: a space, if a comment would otherwise touch it. */
      suffix: string;
    };

/** Works out whether the cursor is on a field name or a field's value.
 * Only top-level fields count; nested options (`duration:`'s `days:`) are
 * left alone. A list item's value belongs to the field above it. */
export function findTarget(
  body: readonly string[],
  lineIndex: number,
  ch: number
): CompletionTarget | null {
  const line = body[lineIndex];
  const before = line.slice(0, ch);
  const after = line.slice(ch);

  // A field name being typed on a line of its own.
  const word = /^[A-Za-z][A-Za-z0-9_]*$/.exec(before);
  const rest = /^[A-Za-z0-9_]*[ \t]*$/.exec(after);
  if (word && rest) {
    return {
      type: "field",
      query: before,
      from: 0,
      to: line.trimEnd().length,
    };
  }

  const key = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:([ \t]*)/.exec(line);
  if (key && ch >= key[0].length) {
    const prefix = key[2] === "" ? " " : "";
    return valueTarget(key[1], line, key[0].length, ch, prefix);
  }

  const item = /^[ \t]*-[ \t]+/.exec(line);
  if (item && ch >= item[0].length) {
    const field = listParent(body, lineIndex);
    if (field !== null) {
      return valueTarget(field, line, item[0].length, ch, "");
    }
  }
  return null;
}

/** Where YAML starts a comment in a value: a `#` at its start or after a
 * space, outside the quotes of a quoted value. -1 if there is none. */
export function commentStart(value: string): number {
  let i = 0;
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    // Skip the quoted part; `\"` and `''` don't end it.
    i = 1;
    while (i < value.length) {
      if (quote === '"' && value[i] === "\\") {
        i += 2;
      } else if (quote === "'" && value.startsWith("''", i)) {
        i += 2;
      } else if (value[i] === quote) {
        break;
      } else {
        i++;
      }
    }
    i++;
  }
  for (; i < value.length; i++) {
    if (value[i] === "#" && (i === 0 || /[ \t]/.test(value[i - 1]))) {
      return i;
    }
  }
  return -1;
}

function valueTarget(
  field: string,
  line: string,
  from: number,
  ch: number,
  prefix: string
): CompletionTarget | null {
  const value = line.slice(from);
  const comment = commentStart(value);
  // Flow collections (`[a, b]`, `{...}`) and comments are left alone.
  if (/^[[{]/.test(value) || (comment !== -1 && from + comment < ch)) {
    return null;
  }
  // The value runs to the end of the line, or to a comment after it,
  // which must stay apart from it.
  const end = comment === -1 ? value.length : comment;
  const to = Math.max(ch, from + value.slice(0, end).trimEnd().length);
  return {
    type: "value",
    field,
    query: line.slice(from, ch).replace(/^["']/, ""),
    from,
    to,
    prefix,
    suffix: comment !== -1 && to === from + comment ? " " : "",
  };
}

/** The top-level field a list item on this line belongs to. */
function listParent(body: readonly string[], lineIndex: number): string | null {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const line = body[i];
    if (/^[ \t]*-/.test(line) || line.trim() === "") {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_]*)[ \t]*:[ \t]*$/.exec(line);
    return match ? match[1] : null;
  }
  return null;
}

export interface Suggestion {
  /** What is shown. */
  label: string;
  description?: string;
  /** What replaces the target's span. */
  text: string;
}

export interface CompletionEnvironment {
  timeZones: () => readonly string[];
  /** Tags used by the note's events. */
  noteTags: () => readonly string[];
}

/** Where the words of a name start: `endTimeZone` at `end`, `Time` and
 * `Zone`; `America/New_York` at `America`, `New` and `York`. */
function wordStarts(name: string): number[] {
  const starts = [0];
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1];
    const char = name[i];
    if (
      "/_- ".includes(prev) ||
      (/[A-Z]/.test(char) && /[a-z0-9]/.test(prev))
    ) {
      starts.push(i);
    }
  }
  return starts;
}

/** Candidates with a word starting with the query, ignoring case; those
 * starting with it first. */
export function matching(
  candidates: readonly string[],
  query: string
): string[] {
  const q = query.toLowerCase();
  const starts: string[] = [];
  const words: string[] = [];
  for (const candidate of candidates) {
    const c = candidate.toLowerCase();
    if (c.startsWith(q)) {
      starts.push(candidate);
    } else if (wordStarts(candidate).some((i) => c.startsWith(q, i))) {
      words.push(candidate);
    }
  }
  return [...starts, ...words];
}

/** Quotes a value YAML wouldn't read back as the same text. */
export function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_][A-Za-z0-9_ ./+-]*$/.test(value) && value.trim() === value) {
    const read: unknown = parseYaml(value);
    if (read === value) {
      return value;
    }
  }
  return JSON.stringify(value);
}

/** Tags an event block's body gives, or none if it doesn't parse. */
export function blockTags(body: string): string[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(body);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) {
    return [];
  }
  const tag = parsed.tag;
  const tags: unknown[] = Array.isArray(tag) ? tag : [tag];
  return tags
    .filter(
      (t): t is string | number | boolean =>
        typeof t === "string" || typeof t === "number" || typeof t === "boolean"
    )
    .map((t) => String(t));
}

/** The distinct tags of a note's event blocks, in the order first used. */
export function tagsInNote(doc: DocumentLines): string[] {
  const tags = new Set<string>();
  for (const block of blocksIn(doc)) {
    if (block.kind === "itinerary-event") {
      for (const tag of blockTags(blockBody(doc, block).lines.join("\n"))) {
        tags.add(tag);
      }
    }
  }
  return [...tags];
}

/** Suggestions for the cursor's position in a block's body. */
export function suggest(
  kind: BlockKind,
  body: readonly string[],
  target: CompletionTarget,
  env: CompletionEnvironment
): Suggestion[] {
  const fields = kind === "itinerary" ? ItineraryFields : EventFields;

  if (target.type === "field") {
    const present = presentFields(body);
    const available = fields.filter((f) => !present.has(f.name));
    const byName = new Map(available.map((f) => [f.name, f]));
    return matching(
      available.map((f) => f.name),
      target.query
    ).map((name) => ({
      label: name,
      description: byName.get(name)?.description,
      text: `${name}: `,
    }));
  }

  const info = fields.find((f) => f.name === target.field);
  let values: readonly string[];
  switch (info?.values) {
    case "boolean":
      values = ["true", "false"];
      break;
    case "timeZone":
      values = env.timeZones();
      break;
    case "view":
      values = CalendarViews;
      break;
    case "tag": {
      const own = new Set(blockTags(body.join("\n")));
      values = env.noteTags().filter((t) => !own.has(t));
      break;
    }
    default:
      return [];
  }
  // `true`/`false` are meant as YAML's booleans; anything else is text.
  const write = info?.values === "boolean" ? String : yamlScalar;
  return matching(values, target.query)
    .filter((value) => value !== target.query)
    .map((value) => ({
      label: value,
      text: target.prefix + write(value) + target.suffix,
    }));
}

/** Everything the editor needs to offer completions on the cursor's line. */
export interface Completion {
  /** The span to replace. */
  from: number;
  to: number;
  query: string;
  suggestions: Suggestion[];
}

/** Completions at a cursor position, if it is inside one of this plugin's
 * blocks and there is something to suggest. */
export function complete(
  doc: DocumentLines,
  cursor: { line: number; ch: number },
  env: CompletionEnvironment
): Completion | null {
  const block = findBlock(doc, cursor.line);
  if (block === null) {
    return null;
  }
  // A block in a list item is indented like its fence; fields are read
  // relative to that.
  const body = blockBody(doc, block);
  const index = cursor.line - block.openLine - 1;
  const removed = body.removed[index];
  // A line indented less than the fence isn't part of the block's YAML
  // as Markdown sees it (it ends the list item).
  if (cursor.ch < removed || removed < block.indent.length) {
    return null;
  }
  const target = findTarget(body.lines, index, cursor.ch - removed);
  if (target === null) {
    return null;
  }
  const suggestions = suggest(block.kind, body.lines, target, env);
  if (suggestions.length === 0) {
    return null;
  }
  return {
    from: target.from + removed,
    to: target.to + removed,
    query: target.query,
    suggestions,
  };
}
