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

const SHELL_TOOLS = new Set(["shell", "bash", "command_execution", "run_command", "terminal"]);

/** A `description` on any other tool can be a payload, not an intent. */
export const TOOL_INTENT_ARG: Record<string, string> = {
  Bash: "description",
  bash: "description",
  Task: "description",
  Agent: "description",
};

/** Trimmed allowlisted intent, or undefined when the call left it empty. */
export function toolIntent(toolName: string, args: unknown): string | undefined {
  const key = SHELL_TOOLS.has(toolName.toLowerCase()) ? "description" : TOOL_INTENT_ARG[toolName];
  if (key === undefined || args === null || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Args that name what a call acted on, most specific first: a search term beats the directory it ran in. */
const SUBJECT_ARGS = ["query", "pattern", "glob_pattern", "globPattern", "url", "file_path", "path", "target_file", "target_directory", "dir"];

/** Tools whose verb is not their name. */
const VERBS: Record<string, string> = { ls: "List", multiedit: "Edit" };

/** `mcp__linear__get_issue` → "Get Issue", `web_fetch` → "Fetch", `read_file` → "Read". */
function verbFor(toolName: string): string {
  const bare = toolName.split("__").pop()!.toLowerCase();
  const mapped = VERBS[bare];
  if (mapped !== undefined) return mapped;
  const words = bare.replace(/^web_/, "").replace(/_file$/, "").split(/[_\s-]+/).filter((w) => w !== "");
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const SUBJECT_MAX = 80;

/** A path as its last three segments, so a deep one still fits on a line. */
function shortPath(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

function clip(text: string): string {
  return text.length > SUBJECT_MAX ? `${text.slice(0, SUBJECT_MAX - 1)}…` : text;
}

/** What one call acted on, read off its args. `code` marks a shell command, shown in mono. */
export type ToolSubject = { text: string; code: boolean };

/**
 * Names what a call did, so a run of calls to one tool reads as distinct steps:
 * the command a shell ran, the file a read opened, the pattern a grep sought.
 * The verb is the tool's name, title-cased; the subject is the first of a
 * short list of common args the call carries. Undefined when it carries none,
 * which keeps the tool's name.
 */
export function toolSubject(toolName: string, args: unknown): ToolSubject | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const record = args as Record<string, unknown>;
  const lower = toolName.toLowerCase();

  if (SHELL_TOOLS.has(lower)) {
    const raw = record.command;
    const command = Array.isArray(raw) ? raw.join(" ") : raw;
    if (typeof command !== "string") return undefined;
    const line = command.trim().split("\n")[0]!.replace(/\s+/g, " ");
    return line === "" ? undefined : { text: clip(line), code: true };
  }

  const key = SUBJECT_ARGS.find((k) => typeof record[k] === "string" && (record[k] as string).trim() !== "");
  if (key === undefined) return undefined;
  const value = (record[key] as string).trim();
  const shown = key === "query" || key === "pattern" ? `"${value}"` : key === "url" ? value : shortPath(value);
  return { text: clip(`${verbFor(toolName)} ${shown}`), code: false };
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
