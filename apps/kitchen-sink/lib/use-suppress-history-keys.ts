"use client";

/**
 * Keeps Option+Left and Option+Right (Alt on other systems) from reaching the
 * browser's back and forward while a page is mounted. Focus outside a text
 * field leaves those keys to the browser, and in a harness mode they are hit by
 * accident, so the page leaves the session. Inside a text field they move by
 * word, which is left alone.
 */
import { useEffect } from "react";

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea");
}

export function useSuppressHistoryKeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const horizontalArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (event.defaultPrevented || !horizontalArrow || !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (inTextField(event.target)) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
