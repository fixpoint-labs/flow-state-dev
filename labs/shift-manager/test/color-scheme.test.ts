// @vitest-environment happy-dom
/**
 * shift-manager's look follows the OS setting: `dark` on the root element while the
 * OS prefers dark, off while it prefers light, and switched live when the
 * setting changes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { followColorScheme } from "../src/lib/color-scheme";

/** A `matchMedia` whose answer the test flips, as the OS setting would. */
function osSetting(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  return {
    win: { matchMedia: (query: string) => (query === "(prefers-color-scheme: dark)" ? media : { ...media, matches: false }) } as unknown as Window,
    set(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
    listening: () => listeners.size,
  };
}

const root = () => document.documentElement;

afterEach(() => root().classList.remove("dark"));

describe("the look follows the OS setting", () => {
  it("is light when the OS prefers light", () => {
    root().classList.add("dark");
    followColorScheme(osSetting(false).win);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("is dark when the OS prefers dark", () => {
    followColorScheme(osSetting(true).win);
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("switches live when the setting changes, and stops when told to", () => {
    const os = osSetting(false);
    const stop = followColorScheme(os.win);
    os.set(true);
    expect(root().classList.contains("dark")).toBe(true);
    os.set(false);
    expect(root().classList.contains("dark")).toBe(false);
    stop();
    expect(os.listening()).toBe(0);
    os.set(true);
    expect(root().classList.contains("dark")).toBe(false);
  });
});
