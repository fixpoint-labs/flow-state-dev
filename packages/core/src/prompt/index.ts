/**
 * @module @flow-state-dev/core/prompt
 *
 * Composable prompt formatting utilities for building structured LLM context.
 * All functions are pure, stateless, and designed to compose naturally.
 *
 * Falsy values (null, undefined, empty strings) are filtered automatically
 * in multi-value functions, making conditional inclusion trivial:
 *
 * ```ts
 * join(
 *   section("Context", keyValues(data)),
 *   when(hasHistory, () => section("History", list(history))),
 *   section("Task", taskDescription)
 * )
 * ```
 */

/** A value that may be a string or falsy (undefined, null, empty string, false). */
export type MaybeString = string | undefined | null | false;

/** Options form for {@link section}. `level` (1–6) sets the heading depth so a
 * section can nest under another (e.g. `level: 3` → `###`). */
export type SectionOptions = { title: string; level?: number };

/**
 * Creates a titled section with content underneath.
 * Falsy content items are filtered out.
 *
 * Pass a string title for a level-2 (`##`) heading, or the options form
 * `{ title, level }` to nest under another section. `level` is clamped to 1–6.
 *
 * @example
 * ```ts
 * section("Research Topics", list(topics))
 * // => "## Research Topics\ntopic1\ntopic2"
 *
 * section({ title: "Subsection", level: 3 }, "body")
 * // => "### Subsection\nbody"
 * ```
 */
export function section(
  title: string | SectionOptions,
  ...content: MaybeString[]
): string {
  const resolvedTitle = typeof title === "string" ? title : title.title;
  const level = typeof title === "string" ? 2 : title.level ?? 2;
  const heading = "#".repeat(Math.min(6, Math.max(1, level)));
  const filtered = content.filter(isTruthy);
  if (filtered.length === 0) {
    return `${heading} ${resolvedTitle}`;
  }
  return `${heading} ${resolvedTitle}\n${filtered.join("\n")}`;
}

/**
 * Formats an array as a bulleted or numbered list.
 * Falsy items are filtered out.
 *
 * @example
 * ```ts
 * list(["apples", "bananas", "cherries"])
 * // => "- apples\n- bananas\n- cherries"
 *
 * list(["first", "second"], { ordered: true })
 * // => "1. first\n2. second"
 *
 * list(["custom"], { bullet: "*" })
 * // => "* custom"
 * ```
 */
export function list(
  items: MaybeString[],
  options?: { ordered?: boolean; bullet?: string }
): string {
  const filtered = items.filter(isTruthy);
  if (filtered.length === 0) {
    return "";
  }

  if (options?.ordered) {
    return filtered.map((item, i) => `${i + 1}. ${item}`).join("\n");
  }

  const bullet = options?.bullet ?? "-";
  return filtered.map((item) => `${bullet} ${item}`).join("\n");
}

/**
 * Formats a record as key-value pairs, one per line.
 * Null and undefined values are filtered out.
 *
 * @example
 * ```ts
 * keyValues({ name: "Alice", role: "admin", score: 42 })
 * // => "name: Alice\nrole: admin\nscore: 42"
 *
 * keyValues({ a: "yes", b: null, c: "maybe" })
 * // => "a: yes\nc: maybe"
 * ```
 */
export function keyValues(
  data: Record<string, string | number | boolean | null | undefined>
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }

  return lines.join("\n");
}

/**
 * Renders an array of records as a GitHub-flavored Markdown table.
 *
 * Columns default to the union of keys across all rows in first-seen order;
 * pass `columns` to fix the set and order. Missing cells render empty, values
 * are stringified, and `|` / newlines in cells are escaped so they don't break
 * the table. Empty input (or no columns) returns an empty string.
 *
 * @example
 * ```ts
 * table([{ ticker: "AAPL", qty: 10 }, { ticker: "JPM", qty: 5 }])
 * // => "| ticker | qty |\n| --- | --- |\n| AAPL | 10 |\n| JPM | 5 |"
 * ```
 */
export function table(
  rows: Array<Record<string, unknown>>,
  options?: { columns?: string[] }
): string {
  if (rows.length === 0) {
    return "";
  }
  const columns =
    options?.columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (columns.length === 0) {
    return "";
  }

  const headerRow = `| ${columns.join(" | ")} |`;
  const dividerRow = `| ${columns.map(() => "---").join(" | ")} |`;
  const bodyRows = rows.map(
    (row) => `| ${columns.map((column) => formatCell(row[column])).join(" | ")} |`
  );
  return [headerRow, dividerRow, ...bodyRows].join("\n");
}

/** Stringify a table cell, escaping pipes and flattening newlines. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Iterates over a record, applying a formatter to each entry.
 * Useful for rendering typed collections where each entry needs custom formatting.
 *
 * @example
 * ```ts
 * const artifacts = { doc1: { title: "Intro" }, doc2: { title: "Conclusion" } };
 * entries(artifacts, (id, art) => `[${id}] ${art.title}`)
 * // => "[doc1] Intro\n[doc2] Conclusion"
 * ```
 */
export function entries<T>(
  record: Record<string, T>,
  formatter: (key: string, value: T) => MaybeString
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const line = formatter(key, value);
    if (isTruthy(line)) {
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Wraps text in a fenced code block with optional language tag.
 *
 * @example
 * ```ts
 * codeBlock("const x = 1;", "ts")
 * // => "```ts\nconst x = 1;\n```"
 *
 * codeBlock("plain text")
 * // => "```\nplain text\n```"
 * ```
 */
export function codeBlock(code: string, language?: string): string {
  const fence = "```";
  return `${fence}${language ?? ""}\n${code}\n${fence}`;
}

/**
 * Joins multiple string fragments with double newlines.
 * Falsy values are filtered out, making conditional assembly trivial.
 *
 * @example
 * ```ts
 * join(
 *   section("Intro", "Hello"),
 *   when(showDetails, () => section("Details", detailText)),
 *   section("End", "Goodbye")
 * )
 * ```
 */
export function join(...parts: MaybeString[]): string {
  return parts.filter(isTruthy).join("\n\n");
}

/**
 * Conditionally includes content based on a boolean condition.
 * Returns the content string if condition is true, undefined if false.
 * Content can be a string or a lazy function (evaluated only when true).
 *
 * @example
 * ```ts
 * when(topics.length > 0, () => section("Topics", list(topics)))
 * // => section string if topics exist, undefined otherwise
 *
 * when(isVerbose, "Include extra context here")
 * // => "Include extra context here" or undefined
 * ```
 */
export function when(
  condition: boolean,
  content: string | (() => string)
): string | undefined {
  if (!condition) {
    return undefined;
  }
  return typeof content === "function" ? content() : content;
}

// --- XML rendering for object-form context ---

export {
  xmlTag,
  renderTaggedContext,
  type TagAccumulator,
  type TagAccumulatorValue,
  type RenderTaggedContextOptions,
} from "./xml";

export { RESERVED_TAG_NAMES, validateTagName } from "./reserved-tags";

// --- Internal ---

function isTruthy(value: MaybeString): value is string {
  return typeof value === "string" && value.length > 0;
}
