/**
 * A running task's progress note, from its harness run's activity (FIX-2290).
 *
 * The harness hands each assistant message and tool call to the manager's
 * `onActivity` feed. {@link progressNoteOf} turns one into the one-line note a
 * task view shows, and {@link throttledNotes} decides which of them reach the
 * task row: the first at once, then at most one per {@link PROGRESS_NOTE_MS},
 * always the latest, so a long run writes the row a bounded number of times.
 */
import type { HarnessActivity } from "@flow-state-dev/core/types";
import { STATUS_NOTE_LIMIT } from "@flow-state-dev/orchestration";

/** The least time between two progress-note writes of one step, in ms. */
export const PROGRESS_NOTE_MS = 30_000;

/** The argument keys whose value says what a tool call touches, first found wins. */
const DETAIL_KEYS = ["file_path", "path", "command", "pattern", "query", "url"] as const;

/**
 * The note an activity reads as, or `null` when it says nothing: a message's
 * first non-empty line, or a tool call as `<name>: <what it touches>` (the
 * name alone when no argument says). Whitespace collapsed, cut to
 * `STATUS_NOTE_LIMIT`.
 */
export function progressNoteOf(activity: HarnessActivity): string | null {
  const raw =
    activity.kind === "message"
      ? (activity.text.split("\n").find((line) => line.trim() !== "") ?? "")
      : toolNote(activity.name, activity.arguments);
  const note = raw.replace(/\s+/g, " ").trim();
  if (note === "") return null;
  return note.length > STATUS_NOTE_LIMIT ? `${note.slice(0, STATUS_NOTE_LIMIT - 1)}…` : note;
}

function toolNote(name: string, args: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return name;
  }
  if (parsed === null || typeof parsed !== "object") return name;
  for (const key of DETAIL_KEYS) {
    const detail = (parsed as Record<string, unknown>)[key];
    if (typeof detail === "string" && detail.trim() !== "") return `${name}: ${detail}`;
  }
  return name;
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
 * holds it), and nothing more is written then. A throw writes nothing and
 * stops nothing.
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
    written = note;
    lastWriteAt = Date.now();
    write(note).then(
      (kept) => {
        if (!kept) stopped = true;
      },
      () => undefined,
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
