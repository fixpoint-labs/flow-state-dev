// @vitest-environment happy-dom
/**
 * App Lab's look follows the OS setting: `dark` on the root element while the
 * OS prefers dark, off while it prefers light, and switched live when the
 * setting changes. A shift the page was served with (`--shift day|night`)
 * overrides the OS setting for as long as the page is open.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bootColorScheme, followColorScheme, readServedColorScheme } from "../src/lib/color-scheme";

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

afterEach(() => {
  root().classList.remove("dark");
  document.head.querySelectorAll("meta").forEach((m) => m.remove());
});

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

/** The meta the start script writes a forced shift into. */
function served(scheme: string | undefined) {
  if (scheme === undefined) return;
  const meta = document.createElement("meta");
  meta.name = "app-lab-color-scheme";
  meta.content = scheme;
  document.head.appendChild(meta);
}

describe("a shift forced at boot", () => {
  // Each forced case runs against the OPPOSITE OS setting, so a page that
  // ignored the shift and followed the OS would fail it.
  it("night is dark while the OS prefers light, and stays dark when the OS changes", () => {
    served("dark");
    const os = osSetting(false);
    bootColorScheme(readServedColorScheme(), os.win);
    expect(root().classList.contains("dark")).toBe(true);
    os.set(false);
    expect(root().classList.contains("dark")).toBe(true);
    expect(os.listening()).toBe(0);
  });

  it("day is light while the OS prefers dark, and stays light when the OS changes", () => {
    root().classList.add("dark");
    served("light");
    const os = osSetting(true);
    bootColorScheme(readServedColorScheme(), os.win);
    expect(root().classList.contains("dark")).toBe(false);
    os.set(true);
    expect(root().classList.contains("dark")).toBe(false);
    expect(os.listening()).toBe(0);
  });

  it("with no shift served, follows the OS setting as before", () => {
    served(undefined);
    const os = osSetting(true);
    expect(readServedColorScheme()).toBeUndefined();
    bootColorScheme(readServedColorScheme(), os.win);
    expect(root().classList.contains("dark")).toBe(true);
    os.set(false);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("ignores a served value that is neither light nor dark, and follows the OS", () => {
    served("dusk");
    expect(readServedColorScheme()).toBeUndefined();
  });
});
