/**
 * shift-manager's light or dark look follows the person's OS setting.
 *
 * The design-system theme applies its dark values under a `dark` class, so
 * this keeps that class on the root element in step with
 * `prefers-color-scheme`, including when the setting changes while the page
 * is open.
 */

const QUERY = "(prefers-color-scheme: dark)";

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
