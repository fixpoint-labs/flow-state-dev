/**
 * Pure helpers for tool-call grouping and summary-label composition.
 *
 * Kept free of DOM / component imports so it can be unit-tested directly
 * and reused from any UI layer (React, non-React, tests). Rendering lives
 * in tool.tsx.
 */

import type { BlockToolOutputItem, OutputItem } from "@flow-state-dev/core/items";

/**
 * Verb-phrase entry for a tool. Two forms: a singular phrase used when a
 * group contains exactly one call of this tool, and a function that
 * produces the plural phrase for N calls.
 *
 * Group merging keys on the `singular` string: tools that share a singular
 * phrase (e.g. `web_search` and `search` both → "ran a search") merge into
 * a single phrase in the composed label.
 */
export type ToolVerbs = {
  singular: string;
  plural: (n: number) => string;
};

/**
 * Maximum number of distinct verb phrases before the composed label
 * collapses to the generic "Ran N tools" form. Keeps labels readable.
 */
export const TOOL_GROUP_DISTINCT_CAP = 4;

/**
 * Data-driven verb-phrase lookup. Extend this map with additional tool
 * names to tune the summary labels. Unknown tools fall back to a generic
 * "ran <tool-name>" phrase.
 */
export const TOOL_VERB_MAP: Record<string, ToolVerbs> = {
  web_search: { singular: "ran a search", plural: (n) => `ran ${n} searches` },
  search:     { singular: "ran a search", plural: (n) => `ran ${n} searches` },
  fetch:      { singular: "fetched a page", plural: (n) => `fetched ${n} pages` },
  web_fetch:  { singular: "fetched a page", plural: (n) => `fetched ${n} pages` },
  read:       { singular: "read a file", plural: (n) => `read ${n} files` },
  read_file:  { singular: "read a file", plural: (n) => `read ${n} files` },
  write:      { singular: "wrote a file", plural: (n) => `wrote ${n} files` },
  write_file: { singular: "wrote a file", plural: (n) => `wrote ${n} files` },
  create_file:{ singular: "created a file", plural: (n) => `created ${n} files` },
  edit:       { singular: "edited a file", plural: (n) => `edited ${n} files` },
  edit_file:  { singular: "edited a file", plural: (n) => `edited ${n} files` },
  delete:     { singular: "deleted a file", plural: (n) => `deleted ${n} files` },
  delete_file:{ singular: "deleted a file", plural: (n) => `deleted ${n} files` },
  bash:       { singular: "ran a command", plural: (n) => `ran ${n} commands` },
  run_command:{ singular: "ran a command", plural: (n) => `ran ${n} commands` },
  load_tools: { singular: "loaded tools", plural: () => "loaded tools" },
};

/** Look up verbs for a tool name, falling back to a generic phrase. */
function verbsFor(toolName: string): ToolVerbs {
  const entry = TOOL_VERB_MAP[toolName];
  if (entry !== undefined) return entry;
  return {
    singular: `ran \`${toolName}\``,
    plural: (n) => `ran \`${toolName}\` ${n} times`,
  };
}

function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  // Oxford comma for 3+ clauses.
  const head = clauses.slice(0, -1).join(", ");
  return `${head}, and ${clauses[clauses.length - 1]}`;
}

/**
 * Composes a Level-1 summary label from a batch of consecutive tool calls.
 *
 *   composeToolGroupLabel(["web_search", "web_search", "write_file"])
 *   // → "Ran 2 searches and wrote a file"
 *
 * Rules:
 *  - Tools sharing a singular phrase merge into one clause.
 *  - A group with more than {@link TOOL_GROUP_DISTINCT_CAP} distinct clauses
 *    collapses to "Ran N tools".
 *  - First word capitalized; subsequent clauses lower-case.
 *  - Comma-joined; Oxford comma when 3+ clauses, plain "and" for 2.
 */
export function composeToolGroupLabel(toolNames: string[]): string {
  if (toolNames.length === 0) return "";

  // Group by singular-phrase identity; preserve first-seen ordering.
  const order: string[] = [];
  const countsByKey = new Map<string, number>();
  const verbsByKey = new Map<string, ToolVerbs>();
  for (const name of toolNames) {
    const verbs = verbsFor(name);
    const key = verbs.singular;
    if (!countsByKey.has(key)) {
      order.push(key);
      verbsByKey.set(key, verbs);
    }
    countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
  }

  if (order.length > TOOL_GROUP_DISTINCT_CAP) {
    return capitalizeFirst(`ran ${toolNames.length} tools`);
  }

  const clauses = order.map((key) => {
    const verbs = verbsByKey.get(key)!;
    const count = countsByKey.get(key)!;
    return count === 1 ? verbs.singular : verbs.plural(count);
  });

  return capitalizeFirst(joinClauses(clauses));
}

/**
 * A segment in the rendered stream: either a single non-tool item, or a
 * consecutive batch of tool-call items to render as a ToolGroup.
 */
export type ToolStreamSegment =
  | { kind: "item"; item: OutputItem }
  | { kind: "group"; items: BlockToolOutputItem[] };

/**
 * Walks an ordered item list and returns segments where consecutive
 * `block_tool_output` items are collapsed into group segments.
 *
 * A non-tool item ends a group. Singletons still appear as `{ kind: "group" }`
 * to match the spec — consistency matters more than special-casing.
 */
export function groupConsecutiveToolCalls(items: OutputItem[]): ToolStreamSegment[] {
  const out: ToolStreamSegment[] = [];
  let buf: BlockToolOutputItem[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    out.push({ kind: "group", items: buf });
    buf = [];
  };

  for (const item of items) {
    if (item.type === "block_tool_output") {
      buf.push(item as BlockToolOutputItem);
    } else {
      flush();
      out.push({ kind: "item", item });
    }
  }
  flush();
  return out;
}
