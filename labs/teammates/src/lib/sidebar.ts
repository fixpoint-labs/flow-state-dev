import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "teammates.sidebar";

/** Below this width the sidebar starts as a rail of icons, so the conversation keeps the space. */
export const NARROW_QUERY = "(max-width: 1023px)";

/**
 * The sidebar's two widths: open, and the rail. The rail fits one 36px button
 * between the list's 6px gutters, with the badge on its corner; the grid's
 * column and an opened sidebar's overlay both read these.
 */
export const SIDEBAR_WIDTH = { open: "17rem", rail: "3.75rem" } as const;

const narrowNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/** What this viewer last chose on a wide screen; a blocked store only forgets. */
function stored(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

/**
 * Whether the left sidebar is collapsed to its rail, and the toggle.
 *
 * A narrow window collapses it, and crossing back to a wide one opens it again,
 * or collapses it if that's what this viewer last chose there. Between those,
 * the toggle decides. Only a wide-screen choice is remembered, in memory and in
 * browser storage, so a blocked store still keeps it until reload; a choice on a
 * narrow screen lasts until the window crosses the line.
 *
 * Returns `collapsed`; `narrow`, when an opened sidebar lies over the
 * conversation rather than taking its width; `toggle`; and `collapse`, which
 * folds it the way a narrow window's opened sidebar closes once a teammate is picked.
 */
export function useSidebar() {
  const [saved] = useState(stored);
  const wideChoice = useRef(saved);
  const [narrow, setNarrow] = useState(narrowNow);
  const [collapsed, setCollapsed] = useState(() => narrow || saved);
  // Follows the window across the line: narrowing collapses it, widening restores the wide-window choice. A choice
  // made on the narrow side is dropped on purpose, so a narrow window always starts as the rail (the tests pin it).
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const follow = () => {
      setNarrow(query.matches);
      setCollapsed(query.matches || wideChoice.current);
    };
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    if (narrow) return;
    wideChoice.current = next;
    try {
      window.localStorage.setItem(KEY, next ? "collapsed" : "open");
    } catch {
      // Storage blocked: the choice is kept in memory until reload.
    }
  }, [collapsed, narrow]);
  const collapse = useCallback(() => setCollapsed(true), []);
  return { collapsed, narrow, toggle, collapse };
}
