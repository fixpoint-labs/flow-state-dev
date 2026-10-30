import { useSyncExternalStore } from "react";

/**
 * The page's look, light or dark. `.dark` on the root element is what the
 * design-system theme and Tailwind's `dark:` variant key on.
 *
 * Which look the page is in, in order:
 *
 * 1. The one a user picked with the sidebar's toggle. It's kept in this
 *    browser's storage, so it holds across reloads.
 * 2. The system's setting, which the page follows as it changes.
 *
 * A pick ends the following: from then on the page stays in the look the user
 * chose, whatever the system does. Browser storage can be missing or throw (a
 * private window, blocked site data); then a pick still changes the look, it
 * just isn't kept.
 */

/** A look the page can be in. */
export type Theme = "light" | "dark";

/** The browser storage key a user's pick is kept under. */
const KEY = "claude-code-style.theme";

const isTheme = (value: unknown): value is Theme => value === "light" || value === "dark";

const listeners = new Set<() => void>();
/** The pick while storage is blocked, so a blocked store only forgets at the next reload. */
let held: Theme | undefined;
/** Set once storage has refused us, by either verb: from then on `held` is the pick. */
let blocked = false;
let shown: Theme | undefined;
let started = false;

/** The look a user picked, or `undefined` when they haven't picked one. */
function readPick(): Theme | undefined {
  if (blocked) return held;
  try {
    const kept = window.localStorage.getItem(KEY);
    return isTheme(kept) ? kept : undefined;
  } catch {
    blocked = true;
    return held;
  }
}

const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** The look the page shows now: the pick if there is one, else the system's. */
export const currentTheme = (): Theme => readPick() ?? systemTheme();

/** Put the look on the root element, telling the listeners only when it moved. */
function paint(): void {
  const next = currentTheme();
  document.documentElement.classList.toggle("dark", next === "dark");
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

/**
 * Put the look on the page and follow the system until a pick. Safe to call
 * more than once; the system is listened to on the first call only.
 */
export function bootTheme(): void {
  if (!started) {
    started = true;
    // A pick wins, so `paint` is right to run on a system change either way.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  }
  paint();
}

/** A user's pick: shown at once and kept for this browser. */
export function chooseTheme(next: Theme): void {
  held = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    // Storage blocked: the pick holds for this page only.
    blocked = true;
  }
  bootTheme();
}

function subscribe(listener: () => void): () => void {
  bootTheme();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The look the page shows, and the way to pick another. Re-renders on either source changing. */
export function useTheme(): [Theme, (next: Theme) => void] {
  return [useSyncExternalStore(subscribe, currentTheme, () => "light"), chooseTheme];
}
