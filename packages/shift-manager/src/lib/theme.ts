/**
 * Shift Manager's theme: three themes, Day, Evening and Night.
 *
 * The root element carries the theme as `data-theme`, and Night also takes the
 * `dark` class the design-system theme and Tailwind's `dark:` variant key on.
 * Evening is a light variant, so it never takes `dark`.
 *
 * Which theme the page opens on, in order:
 *
 * 1. The one a person picked with the mark in the sidebar header. It's kept in
 *    this browser's storage, so it holds across reloads and restarts.
 * 2. One forced at start (`--shift day|evening|night`, or
 *    `SHIFT_MANAGER_SHIFT`), which reaches the page as a meta tag.
 * 3. The one the clock calls for: Day from 06:00, Evening from 16:00, Night
 *    from 19:00 until the next morning.
 *
 * After that the clock only moves the mark's sundial; it never changes the
 * theme. A change a person picks fades in over a third of a second.
 *
 * Browser storage can be missing or throw (a private window, blocked site
 * data); then a pick still changes the look, it just isn't kept.
 */

/** A theme the page can be in. */
export type Theme = "day" | "evening" | "night";

/** Every theme, in the order a day runs through them. */
export const THEMES: readonly Theme[] = ["day", "evening", "night"];

/** The hour, on the clock, each theme starts at. Night runs past midnight to the next morning's Day. */
const STARTS: Record<Theme, number> = { day: 6, evening: 16, night: 19 };

/** The page meta the `shift-manager` command writes a forced theme into. */
export const THEME_META = "shift-manager-theme";

/**
 * The browser storage key a person's pick is kept under. It is the key the
 * two-look build already used, so a pick made then still reads.
 */
const PICK_KEY = "shift-manager:shift";

/** How long a change takes to show, in milliseconds. */
export const FADE_MS = 320;

/** How often the clock is read, so the sundial moves within a minute of the time. */
const TICK_MS = 15_000;

const isTheme = (value: unknown): value is Theme => value === "day" || value === "evening" || value === "night";

/**
 * A theme named by a stored or served value. The two-look build named them
 * `light` and `dark`; a pick or a profile written then still reads. Anything
 * else, such as the `auto` an earlier build could keep, names none.
 */
function parseTheme(value: unknown): Theme | undefined {
  if (isTheme(value)) return value;
  return value === "light" ? "day" : value === "dark" ? "night" : undefined;
}

/** The theme the clock calls for at `hour`, 0 up to 24. */
export function themeAt(hour: number): Theme {
  if (hour >= STARTS.night || hour < STARTS.day) return "night";
  return hour >= STARTS.evening ? "evening" : "day";
}

const NAMES: Record<Theme, string> = { day: "Day", evening: "Evening", night: "Night" };

/** The theme's name: `Evening`. */
export const themeName = (theme: Theme): string => NAMES[theme];

/** The theme as the header and the roster word it: `Evening shift`. */
export const themeLabel = (theme: Theme): string => `${NAMES[theme]} shift`;

/** The theme a click on the mark moves to from `theme`: Day, Evening, Night, and back to Day. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
}

/**
 * The theme the page was served with, or `undefined` when it was started on
 * none (or the meta holds anything but a theme).
 */
export function readServedTheme(doc: Document = document): Theme | undefined {
  return parseTheme(doc.querySelector<HTMLMetaElement>(`meta[name="${THEME_META}"]`)?.content.trim());
}

/** The look on the page, and the mark's handle on it. */
export interface ThemeLook {
  /** The theme the page shows now. */
  current(): Theme;
  /** Minutes since midnight, the sundial's position. It moves on a minute boundary, not within one. */
  minute(): number;
  /** A person's pick: shown at once and kept for this browser. */
  choose(theme: Theme): void;
  /** Move to the theme after this one (`nextTheme`). */
  cycle(): void;
  /** Call `listener` whenever the theme or the minute changes. @returns A function that stops calling it. */
  subscribe(listener: () => void): () => void;
  /** Stop reading the clock. */
  stop(): void;
}

/**
 * Set the look at boot, by the precedence in this file's header, and return
 * the handle the mark drives it through.
 *
 * @param served The theme the page was served with (`readServedTheme`).
 * @param now The clock; the tests move it.
 */
export function bootTheme(
  served: Theme | undefined,
  win: Pick<Window, "localStorage"> = window,
  root: HTMLElement = document.documentElement,
  now: () => Date = () => new Date(),
): ThemeLook {
  const listeners = new Set<() => void>();
  let kept: string | null = null;
  try {
    kept = win.localStorage.getItem(PICK_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
  const minuteNow = (): number => {
    const d = now();
    return d.getHours() * 60 + d.getMinutes();
  };

  let theme: Theme = parseTheme(kept) ?? served ?? themeAt(minuteNow() / 60);
  let shownMinute = minuteNow();
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const paint = () => {
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "night");
  };

  paint();

  const tick = setInterval(() => {
    if (minuteNow() === shownMinute) return;
    shownMinute = minuteNow();
    notify();
  }, TICK_MS);

  const choose = (next: Theme) => {
    // Any pick is kept, even the theme already showing: the person chose it,
    // so it wins over the clock from then on.
    try {
      win.localStorage.setItem(PICK_KEY, next);
    } catch {
      // Storage blocked: the pick holds for this page only.
    }
    if (next === theme) return;
    theme = next;
    // The fade class is on only while the colours move.
    root.classList.add("theme-fade");
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove("theme-fade"), FADE_MS + 100);
    paint();
    notify();
  };

  return {
    current: () => theme,
    minute: minuteNow,
    choose,
    cycle: () => choose(nextTheme(theme)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => clearInterval(tick),
  };
}
