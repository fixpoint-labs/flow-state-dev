import { useCallback, useEffect, useState } from "react";

const KEY = "teammates.sidebar";

/** Below this width the sidebar starts as a rail of icons, so the conversation keeps the space. */
export const NARROW_QUERY = "(max-width: 1023px)";

const narrowNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/** What this viewer last chose on a wide screen; a blocked store only forgets. */
function stored(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "collapsed" ? true : value === "open" ? false : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the left sidebar is collapsed to its rail, and the toggle.
 *
 * A narrow window collapses it, and crossing back to a wide one opens it again,
 * or collapses it if that's what this viewer last chose there. Between those,
 * the toggle decides. Only a wide-screen choice is remembered: on a narrow
 * screen it lasts until the window crosses the line.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => narrowNow() || stored() === true);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const follow = () => setCollapsed(query.matches || stored() === true);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (!narrowNow()) {
        try {
          window.localStorage.setItem(KEY, next ? "collapsed" : "open");
        } catch {
          // Storage blocked: the choice lasts until reload.
        }
      }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}
