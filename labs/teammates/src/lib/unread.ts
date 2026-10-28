import { useCallback, useState } from "react";

const KEY = "teammates.seen";

/** What a person has seen: per viewer, so it lives in browser storage, and a blocked store only forgets. */
function load(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

/**
 * How many entries of each worker's conversation this viewer has seen.
 * `markSeen` records a new count; a worker never marked is `undefined`.
 */
export function useSeen(): [Record<string, number>, (worker: string, count: number) => void] {
  const [seen, setSeen] = useState(load);
  const markSeen = useCallback((worker: string, count: number) => {
    setSeen((prev) => {
      if (prev[worker] === count) return prev;
      const next = { ...prev, [worker]: count };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage blocked: unread counts last until reload.
      }
      return next;
    });
  }, []);
  return [seen, markSeen];
}
