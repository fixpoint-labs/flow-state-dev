import { isTypingTarget } from "@flow-state-dev/react";
import { useEffect, useRef } from "react";

/**
 * The lab's keys, in one place. ⌘K (Ctrl+K) opens the switcher and Alt+↑/↓
 * steps to the previous or next teammate, from anywhere, the composer
 * included. `/` puts the cursor in the composer and `?` lists the keys, but
 * only outside a text field, so both stay text when typed there. Inside an
 * open dialog only ⌘K acts; the dialog owns the rest.
 */
export function useLabKeys(on: { palette: () => void; step: (by: -1 | 1) => void; help: () => void }) {
  const latest = useRef(on);
  latest.current = on;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const { palette, step, help } = latest.current;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        palette();
        return;
      }
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== null) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        step(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        focusComposer();
      } else if (event.key === "?") {
        event.preventDefault();
        help();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Focus the first element `selector` names once it is drawn: a selection
 * re-renders the center, and something just made (a session, a hire) is drawn
 * only once the next read of the list brings it, a few seconds later at most.
 * So it keeps looking for up to `withinMs`.
 */
export function focusWhenDrawn(selector: string, withinMs = 5_000) {
  const until = Date.now() + withinMs;
  const attempt = () => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== null) found.focus();
    else if (Date.now() < until) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Put the cursor in the composer: the open session's, when `sessionId` names it. */
export function focusComposer(sessionId?: string) {
  focusWhenDrawn(sessionId === undefined ? "textarea[data-composer]" : `textarea[data-composer][data-session-id="${sessionId.replace(/"/g, '\\"')}"]`);
}

/**
 * Focus back where it was when a dialog closes without a pick. A Radix dialog
 * only gives focus back to its trigger, and these open from a key, with none.
 * Call `picked()` when a pick sends focus somewhere else.
 */
export function useFocusReturn(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const moved = useRef(false);
  if (open && opener.current === null && typeof document !== "undefined") {
    opener.current = document.activeElement as HTMLElement | null;
    moved.current = false;
  }
  return {
    picked: () => {
      moved.current = true;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (!moved.current) opener.current?.focus();
      opener.current = null;
    },
  };
}
