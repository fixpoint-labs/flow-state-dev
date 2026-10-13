/**
 * Pure helpers for tool-call summary-label composition.
 *
 * Kept free of DOM / component imports so it can be unit-tested directly
 * and reused from any UI layer. The grouping walk itself lives in
 * `@flow-state-dev/react`'s ItemsRenderer so framework filters (dedup,
 * sub-agent, container-owner suppression) run before grouping. This file
 * is responsible for the verb-phrase vocabulary and label composition.
 */

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
 * Argument that carries a tool's own statement of intent, by tool name.
 * Claude Code's `Bash` asks the agent for a short `description` of each
 * command ("List files in src"); `Task` / `Agent` do the same for a
 * sub-agent. Only tools listed here are read: a `description` argument on
 * an arbitrary tool can be a payload (an issue body), not an intent.
 */
export const TOOL_INTENT_ARG: Record<string, string> = {
  Bash: "description",
  bash: "description",
  Task: "description",
  Agent: "description",
};

/**
 * The intent a call stated for itself, or `undefined` when its tool has no
 * intent argument or the call left it empty. `args` is the parsed
 * arguments object.
 */
export function toolIntent(toolName: string, args: unknown): string | undefined {
  const key = TOOL_INTENT_ARG[toolName];
  if (key === undefined || args === null || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** One call, as the label composer sees it. */
export type ToolCallLabelInput = { name: string; intent?: string };

/**
 * Intent phrases shown in a group label before the rest are counted as
 * "+N more". The full list is one click away in the expanded group.
 */
export const TOOL_GROUP_INTENT_CAP = 3;

/**
 * Composes a group label from each call's stated intent, in order:
 *
 *   composeToolCallsLabel([
 *     { name: "Bash", intent: "List files" },
 *     { name: "Bash", intent: "Run tests" },
 *   ])
 *   // → "List files · Run tests"
 *
 * Consecutive calls with no intent fold into one name-based phrase from
 * {@link composeToolGroupLabel} ("Ran 2 searches"). A batch where no call
 * stated an intent is exactly {@link composeToolGroupLabel} of its names.
 * More than {@link TOOL_GROUP_INTENT_CAP} phrases end in "+N more".
 */
export function composeToolCallsLabel(calls: ToolCallLabelInput[]): string {
  if (!calls.some((c) => c.intent !== undefined)) {
    return composeToolGroupLabel(calls.map((c) => c.name));
  }

  const phrases: string[] = [];
  let unnamed: string[] = [];
  const flush = () => {
    if (unnamed.length === 0) return;
    phrases.push(composeToolGroupLabel(unnamed));
    unnamed = [];
  };
  for (const call of calls) {
    if (call.intent === undefined) {
      unnamed.push(call.name);
    } else {
      flush();
      phrases.push(call.intent);
    }
  }
  flush();

  if (phrases.length <= TOOL_GROUP_INTENT_CAP) return phrases.join(" · ");
  const shown = phrases.slice(0, TOOL_GROUP_INTENT_CAP).join(" · ");
  return `${shown} · +${phrases.length - TOOL_GROUP_INTENT_CAP} more`;
}
