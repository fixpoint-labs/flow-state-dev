/**
 * Whether the sidebar and the right panel are collapsed, and the keys that
 * toggle them.
 *
 * Each panel collapses on its own, so the centre can take the window: the
 * sidebar to a rail of icons, the right panel to a strip with a handle. What
 * a person picks is kept in this browser's storage under their user id, so it
 * holds across reloads and from screen to screen. Storage that is missing or
 * throws keeps the pick for this page only, as the theme's does.
 *
 * On a window narrower than 1180px the right panel doesn't push the centre:
 * it starts collapsed, opens over the centre, and opening it there isn't kept.
 */
import { useCallback, useState, useSyncExternalStore } from "react";

/** The windows on which the right panel opens over the centre: narrower than v2's 1180px (v2:1121). */
export const NARROW_QUERY = "(max-width: 1179px)";

/** What a person picked: `true` while that panel is collapsed. */
export interface Collapsed {
  nav: boolean;
  panel: boolean;
}

const EXPANDED: Collapsed = { nav: false, panel: false };

const keyFor = (userId: string) => `shift-manager:panels:${userId}`;

/** The browser's storage, or `undefined` where reading it throws. */
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** What `userId` picked last in this browser; both panels expanded when nothing was kept or it doesn't read. */
export function readCollapsed(userId: string, store: Pick<Storage, "getItem"> | undefined = storage()): Collapsed {
  try {
    const kept = store?.getItem(keyFor(userId));
    if (kept == null) return EXPANDED;
    const parsed = JSON.parse(kept) as Partial<Collapsed> | null;
    return { nav: parsed?.nav === true, panel: parsed?.panel === true };
  } catch {
    return EXPANDED;
  }
}

function keep(userId: string, collapsed: Collapsed) {
  try {
    storage()?.setItem(keyFor(userId), JSON.stringify(collapsed));
  } catch {
    // Storage blocked: the pick holds for this page only.
  }
}

/** Whether a key pressed on `target` is typing: in a field, a text area, a select or editable text. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

// Read again on every resize; the store renders only when the answer changes.
function subscribeNarrow(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const readNarrow = () => typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

/**
 * The two panels' state for `userId`, and the toggles that change it.
 *
 * @returns `navCollapsed`; `panelOpen`, whether the right panel shows its
 *   content; `overlay`, whether it opens over the centre (a narrow window);
 *   and the two toggles.
 */
export function usePanels(userId: string) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(userId));
  const overlay = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  // Opened over the centre on a narrow window: not kept, and closed whenever the window crosses 1180px.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [seenOverlay, setSeenOverlay] = useState(overlay);
  if (seenOverlay !== overlay) {
    setSeenOverlay(overlay);
    setOverlayOpen(false);
  }

  const change = useCallback(
    (name: keyof Collapsed) =>
      setCollapsed((current) => {
        const next = { ...current, [name]: !current[name] };
        keep(userId, next);
        return next;
      }),
    [userId],
  );
  const toggleNav = useCallback(() => change("nav"), [change]);
  const togglePanel = useCallback(() => (overlay ? setOverlayOpen((open) => !open) : change("panel")), [overlay, change]);

  return { navCollapsed: collapsed.nav, panelOpen: overlay ? overlayOpen : !collapsed.panel, overlay, toggleNav, togglePanel };
}
