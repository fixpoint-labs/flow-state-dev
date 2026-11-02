"use client";

/**
 * Keeps Option+Left and Option+Right (Alt on other systems) from reaching the
 * browser's back and forward while a page is mounted. Focus outside a text
 * field (or a select) leaves those keys to the browser, and in a harness mode they are hit by
 * accident, so the page leaves the session. Inside a text field they move by
 * word, which is left alone.
 */
import { isTypingTarget } from "@flow-state-dev/react";
import { useEffect } from "react";

export function useSuppressHistoryKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const horizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (event.defaultPrevented || !horizontalArrow || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
