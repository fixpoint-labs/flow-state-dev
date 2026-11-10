/**
 * Failed tasks a viewer cleared from a teammate's panel. Clearing only hides a
 * row in this browser: the task, its history and its board row stay as they
 * are, and the popup, the conversation and the heading's counts still show it.
 */
import { useCallback, useState } from "react";
import type { BoardTask } from "../adapter";

const KEY = "teammates.cleared";

/**
 * What a cleared row is remembered by: the task and when it ended. A retried
 * task that fails again ends at a new time, so its new failure shows again.
 */
export function clearMark(t: BoardTask): string {
  return `${t.id}@${t.view?.times.completedAt ?? ""}`;
}

/** Per viewer, so it lives in browser storage, and a blocked store only forgets. */
function load(): Record<string, string[]> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

/**
 * One conversation's cleared marks, a call that clears more, and one that
 * restores them all.
 */
export function useCleared(sessionId: string): [ReadonlySet<string>, (marks: readonly string[]) => void, () => void] {
  const [all, setAll] = useState(load);
  const save = useCallback(
    (marks: string[]) =>
      setAll((prev) => {
        const next = { ...prev, [sessionId]: marks };
        if (marks.length === 0) delete next[sessionId];
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // Storage blocked: cleared rows come back on reload.
        }
        return next;
      }),
    [sessionId],
  );
  const mine = all[sessionId] ?? [];
  const clear = useCallback((marks: readonly string[]) => save([...new Set([...mine, ...marks])]), [save, mine]);
  const restore = useCallback(() => save([]), [save]);
  return [new Set(mine), clear, restore];
}
