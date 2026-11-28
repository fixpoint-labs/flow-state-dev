// FIX-2290.
/**
 * A running task's progress note, from its harness run's activity.
 *
 * The harness hands each assistant message and tool call to the manager's
 * `onActivity` feed. {@link progressNoteOf} turns one into the one-line note a
 * task view shows, and {@link throttledNotes} decides which of them reach the
 * task: the first at once, then at most one per {@link PROGRESS_NOTE_MS},
 * always the latest, so a long run writes the row a bounded number of times.
 */
import type { HarnessActivity } from "@flow-state-dev/core/harness";
import { STATUS_NOTE_LIMIT } from "@flow-state-dev/orchestration/internal";

/** The least time between two progress-note writes of one step, in ms. */
export const PROGRESS_NOTE_MS = 30_000;

/** The argument keys whose value says what a tool call touches, first found wins. */
const DETAIL_KEYS = ["file_path", "path", "command", "pattern", "query", "url"] as const;

/**
 * The note an activity reads as, or `null` when it says nothing: a message's
 * first non-empty line, *Thinking…* for reasoning, or a tool call as what the
 * run is doing to what (*Running pnpm test*, *Editing src/a.ts*, *Reading …*,
 * *Searching "…"*, *Fetching …*, *Updating the plan*), else *Using <name>*
 * and what it touches. Whitespace collapsed, so it is one line, and cut to
 * `STATUS_NOTE_LIMIT`.
 */
export function progressNoteOf(activity: HarnessActivity): string | null {
  const raw =
    activity.kind === "message"
      ? (activity.text.split("\n").find((line) => line.trim() !== "") ?? "")
      : activity.kind === "thinking"
        ? "Thinking…"
        : toolNote(activity.name, activity.arguments);
  const note = raw.replace(/\s+/g, " ").trim();
  if (note === "") return null;
  return note.length > STATUS_NOTE_LIMIT ? `${note.slice(0, STATUS_NOTE_LIMIT - 1)}…` : note;
}

/**
 * What a tool does, read off its name, which every harness spells its own way
 * (`Edit`, `edit_file`, `file_change`): the verb its note leads with. An MCP
 * tool's server prefix is dropped first. `undefined` when the name says nothing.
 */
const TOOL_VERBS: readonly { verb: "plan" | "edit" | "read" | "search" | "fetch" | "run"; match: RegExp }[] = [
  { verb: "plan", match: /todo|plan/ },
  { verb: "run", match: /bash|shell|terminal|command|exec/ },
  { verb: "edit", match: /edit|write|patch|replace|create|delete|change|apply/ },
  { verb: "read", match: /read|view|open|cat/ },
  { verb: "search", match: /grep|glob|search|find|list|^ls$/ },
  { verb: "fetch", match: /fetch|browse/ },
];

function toolNote(name: string, args: string): string {
  // `mcp:server/tool` or `mcp__server__tool`: the tool's own name.
  const base = name.split("/").pop()!.split("__").pop()!;
  const verb = TOOL_VERBS.find((entry) => entry.match.test(base.toLowerCase()))?.verb;
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    parsed = undefined;
  }
  if (verb === "plan") return "Updating the plan";
  const detail = toolCallDetail(parsed);
  // A command is one wherever it appears; the tool's name never matters for it.
  if (detail?.key === "command") return `Running ${detail.value}`;
  if (verb === "run") return "Running a command";
  const files = changedFiles(parsed);
  const target = detail?.value ?? (files.length === 0 ? undefined : files.length === 1 ? files[0] : `${files[0]} and ${files.length - 1} more`);
  if (target !== undefined) {
    if (verb === "edit") return `Editing ${target}`;
    if (verb === "read") return `Reading ${target}`;
    if (verb === "search") return `Searching "${target}"`;
    if (verb === "fetch") return `Fetching ${target}`;
    return `Using ${base}: ${target}`;
  }
  return `Using ${base}`;
}

/** The paths a change list names (Codex's `file_change`: `{ changes: [{ path }] }`), in order. */
function changedFiles(args: unknown): string[] {
  const changes = (args as { changes?: unknown } | null | undefined)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    const path = (change as { path?: unknown } | null)?.path;
    return typeof path === "string" && path.trim() !== "" ? [path] : [];
  });
}

/**
 * What a tool call touches, read off its arguments: the first of a file path,
 * a path, a command, a pattern, a query or a URL that is a non-empty string,
 * with the argument key it was read from. `null` when none is. Reads keys
 * only, so no harness's input shape is named.
 */
export function toolCallDetail(args: unknown): { key: (typeof DETAIL_KEYS)[number]; value: string } | null {
  if (args === null || typeof args !== "object") return null;
  for (const key of DETAIL_KEYS) {
    const detail = (args as Record<string, unknown>)[key];
    if (typeof detail === "string" && detail.trim() !== "") return { key, value: detail };
  }
  return null;
}

/** One step's notes, as {@link throttledNotes} keeps them. */
export interface ProgressNotes {
  /** The run's latest note. Written now, or when the window closes. */
  report(note: string): void;
  /** The step ended: drop what's pending and write nothing more. */
  stop(): void;
}

/**
 * Throttle one step's notes onto `write`: the first at once, then the latest
 * once per {@link PROGRESS_NOTE_MS}, never the same text twice in a row.
 * `write` answers `false` when the row declined it (the attempt no longer
 * holds it), and nothing more is written then. A throw stops nothing, and
 * the note it failed to write may be written again in the next window.
 */
export function throttledNotes(write: (note: string) => Promise<boolean>): ProgressNotes {
  let pending: string | null = null;
  let written: string | null = null;
  let lastWriteAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = () => {
    timer = undefined;
    const note = pending;
    pending = null;
    if (stopped || note === null || note === written) return;
    const before = written;
    written = note;
    lastWriteAt = Date.now();
    write(note).then(
      (kept) => {
        if (!kept) stopped = true;
      },
      // Not on the row, so the same note may be written again next window.
      () => {
        if (written === note) written = before;
      },
    );
  };

  return {
    report(note) {
      if (stopped) return;
      pending = note;
      if (timer !== undefined) return;
      const wait = lastWriteAt + PROGRESS_NOTE_MS - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    stop() {
      stopped = true;
      pending = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
