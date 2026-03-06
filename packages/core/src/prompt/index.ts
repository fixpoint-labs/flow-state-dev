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

/**
 * Creates a titled section with content underneath.
 * Falsy content items are filtered out.
 *
 * @example
 * ```ts
 * section("Research Topics", list(topics))
 * // => "## Research Topics\ntopic1\ntopic2"
 *
 * section("Notes", "First note", undefined, "Third note")
 * // => "## Notes\nFirst note\nThird note"
 * ```
 */
export function section(title: string, ...content: MaybeString[]): string {
  const filtered = content.filter(isTruthy);
  if (filtered.length === 0) {
    return `## ${title}`;
  }
  return `## ${title}\n${filtered.join("\n")}`;
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

// --- Internal ---

function isTruthy(value: MaybeString): value is string {
  return typeof value === "string" && value.length > 0;
}
