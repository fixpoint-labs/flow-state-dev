/**
 * The lab's two themes, Paper and Night (`lib/theme.css`), and the switch
 * between them. The theme is the page root's `data-theme`; Night also sets
 * the `dark` class, which the registry's `dark:` variant reads. A viewer's
 * pick is kept in browser storage; with none, the page follows the system's
 * light or dark setting, live, so Night is the dark default.
 */
import { useCallback, useEffect, useState } from "react";

const THEMES = ["paper", "night"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "teammates.theme";

/** This viewer's pick, when there is one; a blocked store has none. */
function picked(): Theme | undefined {
  try {
    const value = window.localStorage.getItem(KEY);
    return THEMES.includes(value as Theme) ? (value as Theme) : undefined;
  } catch {
    return undefined;
  }
}

/** The system's preference: Night when it asks for dark. */
function preferred(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "paper";
}

/** The theme the page opens on: the viewer's pick, else the system's. */
export const initialTheme = (): Theme => picked() ?? preferred();

/** Draw the page in `theme`. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "night");
}

/** The current theme and the switch, which draws the page in the other one and keeps the pick. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme | undefined) ?? initialTheme());
  // Until the viewer picks, the page follows the system: a switch to dark or light while it is open redraws it.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (picked() !== undefined) return;
      const next = preferred();
      applyTheme(next);
      setTheme(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  const toggle = useCallback(() => {
    const next: Theme = theme === "night" ? "paper" : "night";
    applyTheme(next);
    setTheme(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // A blocked store only forgets the pick at reload.
    }
  }, [theme]);
  return { theme, toggle };
}
