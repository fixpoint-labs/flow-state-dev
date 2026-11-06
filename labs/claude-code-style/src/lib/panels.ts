/**
 * Whether the sessions list and the right pane are collapsed, and the keys
 * that toggle them (`[` and `]`, see `useLabKeys`).
 *
 * Each collapses on its own so the thread can take the window: the list to a
 * rail with its two actions, the pane to a strip with its name. The pick is
 * kept in this browser across reloads. A browser that can't store it (a
 * private window, blocked site data) keeps the pick for this page only.
 */
import { useCallback, useState } from "react";

/** What a person picked: `true` while that column is collapsed. */
interface Collapsed {
  nav: boolean;
  pane: boolean;
}

const KEY = "claude-code-style:panels";
const EXPANDED: Collapsed = { nav: false, pane: false };

/** What was kept, or both columns expanded when nothing was kept or it doesn't read. */
function readCollapsed(): Collapsed {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === null) return EXPANDED;
    const parsed = JSON.parse(kept) as Partial<Collapsed> | null;
    return { nav: parsed?.nav === true, pane: parsed?.pane === true };
  } catch {
    return EXPANDED;
  }
}

/** The two columns' state, and the toggles that change and keep it. */
export function usePanels() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback(
    (name: keyof Collapsed) =>
      setCollapsed((current) => {
        const next = { ...current, [name]: !current[name] };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          // Not stored: the pick holds until the page reloads.
        }
        return next;
      }),
    [],
  );
  const toggleNav = useCallback(() => toggle("nav"), [toggle]);
  const togglePane = useCallback(() => toggle("pane"), [toggle]);
  return { navCollapsed: collapsed.nav, paneCollapsed: collapsed.pane, toggleNav, togglePane };
}
