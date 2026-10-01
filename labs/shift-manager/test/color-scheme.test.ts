// @vitest-environment happy-dom
/**
 * Shift Manager's look, by precedence: the shift a person picked in the
 * sidebar's switch (kept for that browser), else the shift the page was served
 * with (`--shift day|night`), else the OS setting, followed live. Whichever
 * holds, the switch flips the `dark` class on the root element at once.
 *
 * Each precedence case runs against the OPPOSITE answer from every source
 * below it, so a look that skipped the winning source would fail it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { bootColorScheme, readServedColorScheme } from "../src/lib/color-scheme";

/** The browser storage key the switch keeps a person's pick under. */
const KEY = "shift-manager:shift";

/** A `matchMedia` whose answer the test flips, as the OS setting would, plus a storage the test can preload. */
function browser(dark: boolean, stored: Record<string, string> = {}) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
  };
  const saved = new Map(Object.entries(stored));
  const localStorage = {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, String(v)),
  };
  return {
    win: {
      matchMedia: (query: string) => (query === "(prefers-color-scheme: dark)" ? media : { ...media, matches: false }),
      localStorage,
    } as unknown as Window,
    setOs(next: boolean) {
      dark = next;
      for (const fn of listeners) fn();
    },
    listening: () => listeners.size,
    saved,
  };
}

/** A browser whose storage throws on every touch, as a private window or blocked site data can. */
function lockedBrowser(dark: boolean) {
  const b = browser(dark);
  const refuse = () => {
    throw new Error("SecurityError: storage is blocked");
  };
  Object.defineProperty(b.win, "localStorage", { get: refuse });
  return b;
}

const root = () => document.documentElement;
const isDark = () => root().classList.contains("dark");

/** The meta the start script writes a forced shift into. */
function served(scheme: string | undefined) {
  if (scheme === undefined) return;
  const meta = document.createElement("meta");
  meta.name = "shift-manager-color-scheme";
  meta.content = scheme;
  document.head.appendChild(meta);
}

afterEach(() => {
  root().classList.remove("dark");
  document.head.querySelectorAll("meta").forEach((m) => m.remove());
});

describe("with no pick and no shift served, the look follows the OS setting", () => {
  it("is light when the OS prefers light", () => {
    root().classList.add("dark");
    const look = bootColorScheme(undefined, browser(false).win);
    expect(isDark()).toBe(false);
    expect(look.current()).toBe("light");
  });

  it("is dark when the OS prefers dark", () => {
    const look = bootColorScheme(undefined, browser(true).win);
    expect(isDark()).toBe(true);
    expect(look.current()).toBe("dark");
  });

  it("switches live when the setting changes, and stops when told to", () => {
    const b = browser(false);
    const look = bootColorScheme(undefined, b.win);
    b.setOs(true);
    expect(isDark()).toBe(true);
    b.setOs(false);
    expect(isDark()).toBe(false);
    look.stop();
    expect(b.listening()).toBe(0);
    b.setOs(true);
    expect(isDark()).toBe(false);
  });
});

describe("a shift served at boot", () => {
  it("night is dark while the OS prefers light, and stays dark when the OS changes", () => {
    served("dark");
    const b = browser(false);
    bootColorScheme(readServedColorScheme(), b.win);
    expect(isDark()).toBe(true);
    b.setOs(false);
    expect(isDark()).toBe(true);
    expect(b.listening()).toBe(0);
  });

  it("day is light while the OS prefers dark, and stays light when the OS changes", () => {
    root().classList.add("dark");
    served("light");
    const b = browser(true);
    bootColorScheme(readServedColorScheme(), b.win);
    expect(isDark()).toBe(false);
    b.setOs(true);
    expect(isDark()).toBe(false);
    expect(b.listening()).toBe(0);
  });

  it("ignores a served value that is neither light nor dark", () => {
    served("dusk");
    expect(readServedColorScheme()).toBeUndefined();
  });
});

describe("a pick in the switch", () => {
  it("flips the look live both ways, tells subscribers, and is kept for this browser", () => {
    const b = browser(false);
    const look = bootColorScheme(undefined, b.win);
    let heard = 0;
    look.subscribe(() => (heard += 1));

    look.choose("dark");
    expect(isDark()).toBe(true);
    expect(look.current()).toBe("dark");
    expect(b.saved.get(KEY)).toBe("dark");

    look.choose("light");
    expect(isDark()).toBe(false);
    expect(look.current()).toBe("light");
    expect(b.saved.get(KEY)).toBe("light");
    expect(heard).toBe(2);
  });

  it("stops the OS setting from changing the look once made", () => {
    const b = browser(false);
    const look = bootColorScheme(undefined, b.win);
    look.choose("light");
    b.setOs(true);
    expect(isDark()).toBe(false);
    expect(b.listening()).toBe(0);
  });

  it("overrides a served shift on the page it was made on", () => {
    served("light");
    const look = bootColorScheme(readServedColorScheme(), browser(false).win);
    look.choose("dark");
    expect(isDark()).toBe(true);
  });
});

describe("a kept pick wins at the next boot", () => {
  it("a kept night beats a served day and an OS that prefers light", () => {
    served("light");
    const look = bootColorScheme(readServedColorScheme(), browser(false, { [KEY]: "dark" }).win);
    expect(isDark()).toBe(true);
    expect(look.current()).toBe("dark");
  });

  it("a kept day beats a served night and an OS that prefers dark", () => {
    root().classList.add("dark");
    served("dark");
    const b = browser(true, { [KEY]: "light" });
    bootColorScheme(readServedColorScheme(), b.win);
    expect(isDark()).toBe(false);
    b.setOs(true);
    expect(isDark()).toBe(false);
    expect(b.listening()).toBe(0);
  });

  it("a kept pick beats the OS setting when no shift is served", () => {
    const b = browser(true, { [KEY]: "light" });
    bootColorScheme(undefined, b.win);
    expect(isDark()).toBe(false);
  });

  it("a kept value that is neither light nor dark is ignored, and the served shift holds", () => {
    served("dark");
    bootColorScheme(readServedColorScheme(), browser(false, { [KEY]: "dusk" }).win);
    expect(isDark()).toBe(true);
  });
});

describe("with browser storage blocked", () => {
  it("boots on the served shift, then the OS, as if nothing were kept", () => {
    served("dark");
    bootColorScheme(readServedColorScheme(), lockedBrowser(false).win);
    expect(isDark()).toBe(true);
    document.head.querySelectorAll("meta").forEach((m) => m.remove());
    root().classList.remove("dark");
    bootColorScheme(readServedColorScheme(), lockedBrowser(true).win);
    expect(isDark()).toBe(true);
  });

  it("still flips the look live; the pick just isn't kept", () => {
    const look = bootColorScheme(undefined, lockedBrowser(false).win);
    expect(() => look.choose("dark")).not.toThrow();
    expect(isDark()).toBe(true);
  });
});
