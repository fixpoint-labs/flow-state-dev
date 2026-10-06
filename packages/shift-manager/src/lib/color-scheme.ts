/**
 * Shift Manager's light or dark look, and the sidebar's Day shift / Night
 * shift switch that changes it.
 *
 * The design-system theme applies its dark values under a `dark` class, so
 * this puts that class on the root element. Which look wins, in order:
 *
 * 1. The shift a person picked in the switch. It's kept in this browser's
 *    storage, so it holds across reloads and restarts.
 * 2. A shift forced at start (`--shift day|night`, or `SHIFT_MANAGER_SHIFT`),
 *    which reaches the page as a meta tag.
 * 3. The OS's `prefers-color-scheme`, followed live while the page is open.
 *
 * Browser storage can be missing or throw (a private window, blocked site
 * data); then a pick still changes the look, it just isn't kept.
 */

const QUERY = "(prefers-color-scheme: dark)";

/** The page meta the `shift-manager` command writes a forced shift's scheme into. */
const SCHEME_META = "shift-manager-color-scheme";

/** The browser storage key a person's pick in the switch is kept under. */
const PICK_KEY = "shift-manager:shift";

/** A scheme the page can be in: `light` is the day shift, `dark` the night shift. */
export type ColorScheme = "light" | "dark";

const isScheme = (value: unknown): value is ColorScheme => value === "light" || value === "dark";

/**
 * The scheme the page was served with, or `undefined` when it was started on
 * no shift (or the meta holds anything but `light` or `dark`).
 */
export function readServedColorScheme(doc: Document = document): ColorScheme | undefined {
  const value = doc.querySelector<HTMLMetaElement>(`meta[name="${SCHEME_META}"]`)?.content.trim();
  return isScheme(value) ? value : undefined;
}

/** The look on the page, and the switch's handle on it. */
export interface ShiftLook {
  /** The scheme the page shows now. */
  current(): ColorScheme;
  /** A person's pick in the switch: shown at once, kept for this browser, and the OS setting no longer followed. */
  choose(scheme: ColorScheme): void;
  /** Call `listener` whenever the look changes. @returns A function that stops calling it. */
  subscribe(listener: () => void): () => void;
  /** Stop following the OS setting. */
  stop(): void;
}

/**
 * Set the look at boot, by the precedence in this file's header, and return
 * the handle the switch drives it through.
 *
 * @param served The shift the page was served with (`readServedColorScheme`).
 */
export function bootColorScheme(
  served: ColorScheme | undefined,
  win: Pick<Window, "matchMedia" | "localStorage"> = window,
  root: HTMLElement = document.documentElement,
): ShiftLook {
  const media = win.matchMedia(QUERY);
  const listeners = new Set<() => void>();
  let kept: string | null = null;
  try {
    kept = win.localStorage.getItem(PICK_KEY);
  } catch {
    // Storage blocked: nothing was kept.
  }
  let pinned: ColorScheme | undefined = isScheme(kept) ? kept : served;

  const current = (): ColorScheme => pinned ?? (media.matches ? "dark" : "light");
  const apply = () => {
    root.classList.toggle("dark", current() === "dark");
    for (const listener of listeners) listener();
  };
  const stop = () => media.removeEventListener("change", apply);

  apply();
  if (pinned === undefined) media.addEventListener("change", apply);

  return {
    current,
    choose(scheme) {
      stop();
      pinned = scheme;
      try {
        win.localStorage.setItem(PICK_KEY, scheme);
      } catch {
        // Storage blocked: the pick holds for this page only.
      }
      apply();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop,
  };
}
