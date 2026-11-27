/**
 * Which of a teammate's panel tabs is open, kept per teammate in this browser:
 * a teammate opened again shows the tab you left it on. A blocked or emptied
 * store only forgets, and every teammate starts on *Tasks*.
 */
import { useCallback, useState } from "react";

const KEY = "teammates.panelTab";

/** The panel's tabs, in order. */
export const PANEL_TABS = ["tasks", "pull-requests", "routines"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

function load(): Record<string, string> {
  try {
    const read = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as unknown;
    return typeof read === "object" && read !== null ? (read as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Teammate `workerId`'s open tab among `visible` (in {@link PANEL_TABS}' order),
 * and a call that opens another and remembers it. A remembered tab that isn't
 * visible now opens the first visible one instead, and stays remembered, so it
 * opens again once it shows.
 */
export function usePanelTab(workerId: string, visible: readonly PanelTab[]): [PanelTab, (tab: PanelTab) => void] {
  const [tab, setTab] = useState<PanelTab>(() => {
    const kept = load()[workerId];
    return (PANEL_TABS as readonly string[]).includes(kept ?? "") ? (kept as PanelTab) : "tasks";
  });
  const choose = useCallback(
    (next: PanelTab) => {
      setTab(next);
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ ...load(), [workerId]: next }));
      } catch {
        // Storage blocked: the tab is kept until the page reloads.
      }
    },
    [workerId],
  );
  return [visible.includes(tab) ? tab : (visible[0] ?? tab), choose];
}
