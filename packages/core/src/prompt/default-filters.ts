/**
 * Built-in Liquid filters auto-registered on every `.md` prompt template.
 *
 * The `.md` engine renders against already-typed `input` / `ctx` / `config`,
 * but LiquidJS ships no object/array/table formatters — so without these,
 * templates can only interpolate already-stringified values and apps end up
 * pre-flattening typed data in their own code. These filters expose the same
 * vocabulary as the `@flow-state-dev/core/prompt` composers (`keyValues`,
 * `list`, `table`) inside templates.
 *
 * Each is `fsd_`-prefixed to avoid colliding with LiquidJS's ~40 built-ins and
 * with user-registered filters. Caller-supplied `filters` of the same name win
 * (they are merged after these in `parsePromptFile`).
 */

import { keyValues, list, table, codeBlock } from "./index";
import type { PromptFileFilters } from "./prompt-file";

/** Coerce an array-ish filter input to a string array (scalars wrap to one
 * element; null/undefined to empty). */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  if (value === null || value === undefined) {
    return [];
  }
  return [String(value)];
}

/**
 * The framework-provided filter set, keyed by the name templates invoke them
 * under:
 *
 * - `fsd_keyValues` — object → `key: value` lines (one per line).
 * - `fsd_list` — array → bullet list; pass `"ordered"` for a numbered list.
 * - `fsd_table` — array of records → Markdown table; extra args fix the columns.
 * - `fsd_json` — any value → a fenced ```json block, pretty-printed. An
 *   `undefined` value (e.g. an absent key in the lenient `<context>` engine)
 *   renders as `null` so the block stays valid JSON.
 */
export const DEFAULT_PROMPT_FILE_FILTERS: PromptFileFilters = {
  fsd_keyValues: (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value !== "object") return String(value);
    return keyValues(value as Record<string, string | number | boolean | null | undefined>);
  },
  fsd_list: (value, ...args) =>
    list(toStringArray(value), { ordered: args.includes("ordered") }),
  fsd_table: (value, ...columns) => {
    if (!Array.isArray(value)) return "";
    return table(
      value as Array<Record<string, unknown>>,
      columns.length > 0 ? { columns: columns.map((column) => String(column)) } : undefined
    );
  },
  fsd_json: (value) => codeBlock(JSON.stringify(value, null, 2) ?? "null", "json"),
};
