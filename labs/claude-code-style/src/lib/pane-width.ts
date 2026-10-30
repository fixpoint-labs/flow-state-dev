/**
 * The right pane's width: dragged by its edge, kept between a floor and a
 * ceiling, and remembered in this browser across reloads. A browser that
 * can't store it (a private window, blocked site data) gets the default.
 */
import { useCallback, useState } from "react";

/** The pane's width when nothing is remembered, in px (19rem). */
export const PANE_DEFAULT = 304;
/** The narrowest the pane goes, in px: a thread's header and review card still fit. */
export const PANE_MIN = 280;
/** The widest it goes, in px. */
export const PANE_MAX = 720;

const KEY = "claude-code-style:pane-width";

/** A width kept within the floor and the ceiling, in whole px. */
export const clampPaneWidth = (width: number) => Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, width)));

/** The remembered width, or the default when none is stored or it isn't a number. */
export function readPaneWidth(): number {
  try {
    const stored = Number(localStorage.getItem(KEY));
    return stored > 0 ? clampPaneWidth(stored) : PANE_DEFAULT;
  } catch {
    return PANE_DEFAULT;
  }
}

/** The pane's width, and a setter that clamps and remembers it. */
export function usePaneWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(readPaneWidth);
  const set = useCallback((next: number) => {
    const clamped = clampPaneWidth(next);
    setWidth(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch {
      // Not stored: the width holds until the page reloads.
    }
  }, []);
  return [width, set];
}
