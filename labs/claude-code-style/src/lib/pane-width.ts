/**
 * The widths of the two side columns: each dragged by its edge, kept between
 * a floor and a ceiling, and remembered in this browser across reloads. A
 * browser that can't store one (a private window, blocked site data) gets the
 * default.
 */
import { useCallback, useState } from "react";

/** The pane's width when nothing is remembered, in px (19rem). */
export const PANE_DEFAULT = 304;
/** The narrowest the pane goes, in px: a thread's header and review card still fit. */
export const PANE_MIN = 280;
/** The widest it goes, in px. */
export const PANE_MAX = 720;

/** The width the main thread keeps beside the pane when the window narrows, in px. */
const THREAD_MIN = 360;

/** The sessions list's width when nothing is remembered: roomier on a wide window (18rem), else 15rem, in px. */
export const sidebarDefault = (windowWidth: number = window.innerWidth) => (windowWidth >= 1440 ? 288 : 240);
/** The narrowest the sessions list goes, in px: a tab row and a session's title still fit. */
export const SIDEBAR_MIN = 200;
/** The widest it goes, in px. */
export const SIDEBAR_MAX = 440;

/** The collapsed sessions list's rail, and the collapsed pane's strip, in px. */
const RAIL_WIDTH = 48;
export const STRIP_WIDTH = 43;

/**
 * The sessions list's grid column: its width, but never more than leaves the
 * main thread `THREAD_MIN` beside the right pane as drawn (its floor, or its
 * strip when `paneCollapsed`), and never under its own. A narrow window
 * shrinks it without forgetting your width.
 */
export const sidebarColumn = (width: number, collapsed = false, paneCollapsed = false) =>
  collapsed
    ? `${RAIL_WIDTH}px`
    : `min(${width}px, max(${SIDEBAR_MIN}px, 100vw - ${paneCollapsed ? STRIP_WIDTH : PANE_MIN}px - ${THREAD_MIN}px))`;

/**
 * The pane's grid column: its width, but never more than leaves the main
 * thread `THREAD_MIN` beside the sessions list as drawn, and never under the
 * floor. A narrow window shrinks the pane without forgetting your width.
 */
export const paneColumn = (width: number, sidebar: number, sidebarCollapsed = false, collapsed = false) =>
  collapsed ? `${STRIP_WIDTH}px` : `min(${width}px, max(${PANE_MIN}px, 100vw - ${sidebarColumn(sidebar, sidebarCollapsed)} - ${THREAD_MIN}px))`;

const KEY = "claude-code-style:pane-width";
const SIDEBAR_KEY = "claude-code-style:sidebar-width";

/** A width kept within the floor and the ceiling, in whole px. */
export const clampPaneWidth = (width: number) => Math.round(Math.min(PANE_MAX, Math.max(PANE_MIN, width)));
/** The sessions list's width kept within its floor and ceiling, in whole px. */
export const clampSidebarWidth = (width: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));

/** A stored width, clamped, or the fallback when none is stored or it isn't a number. */
function readWidth(key: string, clamp: (width: number) => number, fallback: () => number): number {
  try {
    const stored = Number(localStorage.getItem(key));
    return stored > 0 ? clamp(stored) : fallback();
  } catch {
    return fallback();
  }
}

/** The remembered width, or the default when none is stored or it isn't a number. */
export const readPaneWidth = () => readWidth(KEY, clampPaneWidth, () => PANE_DEFAULT);
/** The remembered sessions-list width, or the default for this window. */
export const readSidebarWidth = () => readWidth(SIDEBAR_KEY, clampSidebarWidth, () => sidebarDefault());

/** A width, and a setter that clamps and remembers it. */
function useWidth(read: () => number, key: string, clamp: (width: number) => number): [number, (width: number) => void] {
  const [width, setWidth] = useState(read);
  const set = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setWidth(clamped);
      try {
        localStorage.setItem(key, String(clamped));
      } catch {
        // Not stored: the width holds until the page reloads.
      }
    },
    [key, clamp],
  );
  return [width, set];
}

/** The right pane's width, and a setter that clamps and remembers it. */
export const usePaneWidth = () => useWidth(readPaneWidth, KEY, clampPaneWidth);
/** The sessions list's width, and a setter that clamps and remembers it. */
export const useSidebarWidth = () => useWidth(readSidebarWidth, SIDEBAR_KEY, clampSidebarWidth);
