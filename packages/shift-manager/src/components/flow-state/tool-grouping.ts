/**
 * Pure helpers for tool-call summary-label composition.
 *
 * Kept free of DOM / component imports so it can be unit-tested directly
 * and reused from any UI layer. The grouping walk itself lives in
 * `@flow-state-dev/react`'s ItemsRenderer so framework filters (dedup,
 * sub-agent, container-owner suppression) run before grouping. This file
 * is responsible for the verb-phrase vocabulary and label composition, and
 * for where a run of steps stands: each step's state, the run's, the words
 * that say it, and whether the run is open.
 */

import { toolBaseName, toolOutcome } from "./tool-naming";

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
  // A coding harness's own tools: Claude Code's, Codex's and Cursor's.
  shell:      { singular: "ran a command", plural: (n) => `ran ${n} commands` },
  command_execution: { singular: "ran a command", plural: (n) => `ran ${n} commands` },
  multiedit:  { singular: "edited a file", plural: (n) => `edited ${n} files` },
  // Codex's one tool for changing files: an edit, as Claude Code's and Cursor's are.
  file_change:{ singular: "edited a file", plural: (n) => `edited ${n} files` },
  grep:       { singular: "searched the code", plural: (n) => `searched the code ${n} times` },
  glob:       { singular: "looked for files", plural: (n) => `looked for files ${n} times` },
  load_tools: { singular: "loaded tools", plural: () => "loaded tools" },
  // Workforce's project reads, which merge with any other read, search or listing.
  readProjectSource: { singular: "read a file", plural: (n) => `read ${n} files` },
  grepProjectSource: { singular: "searched the code", plural: (n) => `searched the code ${n} times` },
  globProjectSource: { singular: "looked for files", plural: (n) => `looked for files ${n} times` },
  // The task board's tools and a worker's own.
  createTask: { singular: "started a task", plural: (n) => `started ${n} tasks` },
  getTask: { singular: "checked on a task", plural: (n) => `checked on tasks ${n} times` },
  updateTask: { singular: "updated a task", plural: (n) => `updated tasks ${n} times` },
  listTasks: { singular: "looked over the tasks", plural: (n) => `looked over the tasks ${n} times` },
  holdTaskForUser: { singular: "asked you a question", plural: (n) => `asked you ${n} questions` },
  suspendForUser: { singular: "asked for your answer", plural: (n) => `asked for your answer ${n} times` },
  sendMessage: { singular: "sent a message", plural: (n) => `sent ${n} messages` },
  reportProgress: { singular: "noted progress", plural: (n) => `noted progress ${n} times` },
  consultSessionHistory: { singular: "read a conversation", plural: (n) => `read ${n} conversations` },
};

/** Look up verbs for a tool name, in any case (Claude Code says `Bash`), falling back to a generic phrase. */
function verbsFor(toolName: string): ToolVerbs {
  const base = toolBaseName(toolName);
  const entry = TOOL_VERB_MAP[base] ?? TOOL_VERB_MAP[base.toLowerCase()];
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

/** One call, as the label composer sees it. */
export type ToolCallLabelInput = { name: string; intent?: string };

/** Phrases kept before the rest are counted as "+N more". */
export const TOOL_GROUP_INTENT_CAP = 3;

/** Intents in order. Calls with none fold into the name-based phrase. */
export function composeToolCallsLabel(calls: ToolCallLabelInput[]): string {
  const phrases: string[] = [];
  let unnamed: string[] = [];
  const flush = () => {
    if (unnamed.length === 0) return;
    phrases.push(composeToolGroupLabel(unnamed));
    unnamed = [];
  };
  for (const call of calls) {
    if (call.intent === undefined) unnamed.push(call.name);
    else {
      flush();
      phrases.push(call.intent);
    }
  }
  flush();

  if (phrases.length <= TOOL_GROUP_INTENT_CAP) return phrases.join(" · ");
  const shown = phrases.slice(0, TOOL_GROUP_INTENT_CAP).join(" · ");
  return `${shown} · +${phrases.length - TOOL_GROUP_INTENT_CAP} more`;
}

/** Where one step, or a run of steps, stands. A state, never a colour: each app draws its own. */
export type ToolStepStatus = "running" | "waiting" | "completed" | "error";

/** A call's own status, as a host reads it off its item, before its result is read. */
export type ToolCallStatus = "running" | "waiting" | "failed" | "done";

/**
 * One call's state: its status, and, once it is done, whether its result
 * reports a failure ({@link toolOutcome}). A refused read is as failed as a
 * thrown one.
 */
export function toolStepState(status: ToolCallStatus, toolName: string, output?: unknown): ToolStepStatus {
  if (status === "failed") return "error";
  if (status === "waiting") return "waiting";
  if (status === "running") return "running";
  return toolOutcome(toolName, output) === "failed" ? "error" : "completed";
}

/** A run's state from its steps': failed over waiting over running over done. */
export function toolRunState(states: readonly ToolStepStatus[]): ToolStepStatus {
  if (states.includes("error")) return "error";
  if (states.includes("waiting")) return "waiting";
  if (states.includes("running")) return "running";
  return "completed";
}

/**
 * A line with its state in words: "…" while running, "(failed)" or
 * "(waiting)" after it, "(2 failed)" for `count` of a run of `total` steps.
 */
export function withToolState(label: string, state: ToolStepStatus, count = 1, total = 1): string {
  if (state === "running") return `${label}…`;
  if (state === "error" || state === "waiting") {
    const word = state === "error" ? "failed" : "waiting";
    return total > 1 ? `${label} (${count} ${word})` : `${label} (${word})`;
  }
  return label;
}

/** A run of steps shows open while it is running and folds once it isn't. */
export function toolRunOpen(state: ToolStepStatus): boolean {
  return state === "running";
}
