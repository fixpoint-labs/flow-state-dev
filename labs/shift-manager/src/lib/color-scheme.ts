/**
 * Shift Manager's light or dark look: the shift it was started on, or else the
 * person's OS setting.
 *
 * The design-system theme applies its dark values under a `dark` class, so
 * this puts that class on the root element. A shift forced at start
 * (`--shift day|night`, or `SHIFT_MANAGER_SHIFT`) reaches the page as a meta
 * tag and holds for as long as the page is open. With none, the class follows
 * `prefers-color-scheme`, including when the setting changes while the page is
 * open.
 */

const QUERY = "(prefers-color-scheme: dark)";

/** The page meta the start script writes a forced shift's scheme into. */
const SCHEME_META = "shift-manager-color-scheme";

/** A scheme the page can be forced into. */
export type ColorScheme = "light" | "dark";

/**
 * The scheme the page was served with, or `undefined` when it was started on
 * no shift (or the meta holds anything but `light` or `dark`).
 */
export function readServedColorScheme(doc: Document = document): ColorScheme | undefined {
  const value = doc.querySelector<HTMLMetaElement>(`meta[name="${SCHEME_META}"]`)?.content.trim();
  return value === "light" || value === "dark" ? value : undefined;
}

/**
 * Put `dark` on `root` while the OS prefers dark, and keep it in step.
 *
 * @returns A function that stops following the setting.
 */
export function followColorScheme(win: Pick<Window, "matchMedia"> = window, root: HTMLElement = document.documentElement): () => void {
  const media = win.matchMedia(QUERY);
  const apply = () => root.classList.toggle("dark", media.matches);
  apply();
  media.addEventListener("change", apply);
  return () => media.removeEventListener("change", apply);
}

/**
 * Set the look at boot: `forced` when the page was served a shift, and the OS
 * setting otherwise.
 *
 * @returns A function that stops following the OS setting (a no-op when forced).
 */
export function bootColorScheme(
  forced: ColorScheme | undefined,
  win: Pick<Window, "matchMedia"> = window,
  root: HTMLElement = document.documentElement,
): () => void {
  if (forced === undefined) return followColorScheme(win, root);
  root.classList.toggle("dark", forced === "dark");
  return () => {};
}
