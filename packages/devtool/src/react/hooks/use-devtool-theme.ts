/**
 * The panel's app theme — Paper, Draft or Night (brand Design System sheet
 * 08). A theme only swaps tokens; layout, type and state codes stay the same.
 *
 * The choice is a per-browser preference, so it lives in localStorage and
 * never in the URL or the devtool config. Night is the default.
 */
import { useCallback, useState } from "react";

/** The three app themes, by their prop names. */
export type DevtoolTheme = "paper" | "draft" | "night";

/** Every theme, in header-toggle order. */
export const DEVTOOL_THEMES: readonly DevtoolTheme[] = ["paper", "draft", "night"];

const STORAGE_KEY = "fsd-devtool-theme";
const DEFAULT_THEME: DevtoolTheme = "night";

/** `data-fs-theme` attribute value for a theme (the brand's token selector names). */
export const THEME_ATTRIBUTE: Record<DevtoolTheme, "light" | "draft" | "dark"> = {
  paper: "light",
  draft: "draft",
  night: "dark",
};

function isTheme(value: unknown): value is DevtoolTheme {
  return typeof value === "string" && (DEVTOOL_THEMES as readonly string[]).includes(value);
}

function readStoredTheme(): DevtoolTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Storage blocked (private window, sandboxed iframe) — the default still renders.
    return DEFAULT_THEME;
  }
}

/** Current theme plus a setter that remembers the choice for this browser. */
export function useDevtoolTheme(): [DevtoolTheme, (theme: DevtoolTheme) => void] {
  const [theme, setThemeState] = useState<DevtoolTheme>(readStoredTheme);

  const setTheme = useCallback((next: DevtoolTheme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, []);

  return [theme, setTheme];
}
