import { useSyncExternalStore } from "react";

/**
 * Light or dark, as `dark` on the root element. A stored pick wins over the
 * system setting. Storage that throws still applies the pick for this page.
 */
export type Theme = "light" | "dark";

/** The browser storage key a user's pick is kept under. */
const KEY = "claude-code-style.theme";

const listeners = new Set<() => void>();
/** The pick. `bootTheme` reads it from storage; `chooseTheme` writes it. */
let pick: Theme | undefined;
/** The look last painted, so a subscribe does not notify when nothing moved. */
let shown: Theme | undefined;
let started = false;

const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

const systemTheme = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** The look the page shows now: the pick if there is one, else the system's. */
export const currentTheme = (): Theme => pick ?? systemTheme();

function paint(): void {
  const next = currentTheme();
  document.documentElement.classList.toggle("dark", next === "dark");
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

function followSystem(): void {
  if (started) return;
  started = true;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
}

/** Apply the look and follow the system until a pick. Safe to call more than once. */
export function bootTheme(): void {
  followSystem();
  try {
    const kept = window.localStorage.getItem(KEY);
    pick = isTheme(kept) ? kept : undefined;
  } catch {
    // Blocked read: keep the in-memory pick.
  }
  paint();
}

/** A user's pick: shown at once, and kept for this browser when storage allows. */
export function chooseTheme(next: Theme): void {
  pick = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: the pick holds for this page only.
  }
  followSystem();
  paint();
}

function subscribe(listener: () => void): () => void {
  bootTheme();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The look the page shows, and the way to pick another. */
export function useTheme(): [Theme, (next: Theme) => void] {
  return [useSyncExternalStore(subscribe, currentTheme, () => "light"), chooseTheme];
}
