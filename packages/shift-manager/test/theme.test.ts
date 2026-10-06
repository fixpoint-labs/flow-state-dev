// @vitest-environment happy-dom
/**
 * Shift Manager's theme: Day, Evening and Night. The page opens on, by
 * precedence: the theme a person picked (kept for that browser), else the theme
 * it was served with (`--shift`), else the one the clock calls for: Day from
 * 06:00, Evening from 16:00, Night from 19:00. The clock then only moves the
 * sundial.
 *
 * Each precedence case runs against the OPPOSITE answer from every source
 * below it, so a look that skipped the winning source would fail it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootTheme, nextTheme, readServedTheme, themeAt } from "../src/lib/theme";

/** The browser storage key a person's pick is kept under. */
const KEY = "shift-manager:shift";

/** A clock the test sets, as local `hour:minute`. */
function clock(hour: number, minute = 0) {
  const at = { hour, minute };
  return {
    now: () => new Date(2026, 9, 6, at.hour, at.minute),
    set(h: number, m = 0) {
      at.hour = h;
      at.minute = m;
    },
  };
}

/** A storage the test can preload and read back. */
function browser(stored: Record<string, string> = {}) {
  const saved = new Map(Object.entries(stored));
  return {
    win: {
      localStorage: {
        getItem: (k: string) => saved.get(k) ?? null,
        setItem: (k: string, v: string) => void saved.set(k, String(v)),
      },
    } as unknown as Window,
    saved,
  };
}

/** A browser whose storage throws on every touch, as a private window or blocked site data can. */
function lockedBrowser() {
  const b = browser();
  Object.defineProperty(b.win, "localStorage", {
    get() {
      throw new Error("SecurityError: storage is blocked");
    },
  });
  return b;
}

const root = () => document.documentElement;
const shown = () => root().dataset.theme;
const isDark = () => root().classList.contains("dark");
const fading = () => root().classList.contains("theme-fade");

/** The meta the `shift-manager` command writes a forced theme into. */
function served(value: string | undefined) {
  if (value === undefined) return;
  const meta = document.createElement("meta");
  meta.name = "shift-manager-theme";
  meta.content = value;
  document.head.appendChild(meta);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  root().classList.remove("dark", "theme-fade");
  delete root().dataset.theme;
  document.head.querySelectorAll("meta").forEach((m) => m.remove());
});

describe("which theme the clock calls for", () => {
  it("is Night overnight, Day until 16:00, Evening until 19:00, then Night", () => {
    const at = (h: number, m = 0) => themeAt(h + m / 60);
    expect([at(0), at(5, 59), at(6), at(15, 59), at(16), at(18, 59), at(19), at(23, 59)]).toEqual([
      "night",
      "night",
      "day",
      "day",
      "evening",
      "evening",
      "night",
      "night",
    ]);
  });
});

describe("with no pick and no theme served, the page opens on the theme the clock calls for", () => {
  it.each([
    [10, "day", false],
    [17, "evening", false],
    [21, "night", true],
  ] as const)("at %i:00 it shows %s", (hour, theme, dark) => {
    root().classList.add("dark");
    const look = bootTheme(undefined, browser().win, root(), clock(hour).now);
    expect(look.current()).toBe(theme);
    expect(shown()).toBe(theme);
    // Only Night is dark: Evening is a light variant and must not take the class.
    expect(isDark()).toBe(dark);
  });

  it("stays on that theme when the clock moves on: the clock only moves the sundial", () => {
    const c = clock(15, 58);
    const look = bootTheme(undefined, browser().win, root(), c.now);
    c.set(21, 0);
    vi.advanceTimersByTime(60_000);
    expect(shown()).toBe("day");
    expect(look.current()).toBe("day");
    expect(look.minute()).toBe(21 * 60);
  });

  it("tells subscribers when the minute moves, and not within one", () => {
    const c = clock(10, 30);
    const look = bootTheme(undefined, browser().win, root(), c.now);
    expect(look.minute()).toBe(630);
    let heard = 0;
    look.subscribe(() => (heard += 1));
    c.set(10, 31);
    vi.advanceTimersByTime(15_000);
    expect(look.minute()).toBe(631);
    expect(heard).toBe(1);
    vi.advanceTimersByTime(15_000);
    expect(heard).toBe(1);
  });

  it("stops reading the clock when told to", () => {
    const c = clock(10, 30);
    const look = bootTheme(undefined, browser().win, root(), c.now);
    let heard = 0;
    look.subscribe(() => (heard += 1));
    look.stop();
    c.set(11, 0);
    vi.advanceTimersByTime(60_000);
    expect(heard).toBe(0);
  });
});

describe("a theme served at boot", () => {
  it.each(["day", "evening", "night"] as const)("%s holds against a clock calling for another", (theme) => {
    served(theme);
    // 10:00 calls for Day; 21:00 for Night. Use the hour that disagrees with the served theme.
    const look = bootTheme(readServedTheme(), browser().win, root(), clock(theme === "day" ? 21 : 10).now);
    expect(look.current()).toBe(theme);
    expect(shown()).toBe(theme);
  });

  it("ignores a served value that is not a theme", () => {
    served("dusk");
    expect(readServedTheme()).toBeUndefined();
  });

  it("reads the two-look build's light and dark as day and night", () => {
    served("dark");
    expect(readServedTheme()).toBe("night");
    document.head.querySelectorAll("meta").forEach((m) => m.remove());
    served("light");
    expect(readServedTheme()).toBe("day");
  });
});

describe("a pick", () => {
  it("shows at once, is kept for this browser, and tells subscribers", () => {
    const b = browser();
    const look = bootTheme(undefined, b.win, root(), clock(10).now);
    let heard = 0;
    look.subscribe(() => (heard += 1));

    look.choose("evening");
    expect(shown()).toBe("evening");
    expect(isDark()).toBe(false);
    expect(look.current()).toBe("evening");
    expect(b.saved.get(KEY)).toBe("evening");

    look.choose("night");
    expect(isDark()).toBe(true);
    expect(b.saved.get(KEY)).toBe("night");
    expect(heard).toBe(2);
  });

  it("cycles Day, Evening, Night, and back to Day", () => {
    const look = bootTheme(undefined, browser().win, root(), clock(10).now);
    const seen: string[] = [look.current()];
    for (let i = 0; i < 3; i += 1) {
      look.cycle();
      seen.push(look.current());
    }
    expect(seen).toEqual(["day", "evening", "night", "day"]);
    expect(nextTheme("night")).toBe("day");
  });
});

describe("a kept pick wins at the next boot", () => {
  it("a kept Night beats a served Day and a clock calling for Day", () => {
    served("day");
    const look = bootTheme(readServedTheme(), browser({ [KEY]: "night" }).win, root(), clock(10).now);
    expect(look.current()).toBe("night");
    expect(isDark()).toBe(true);
  });

  it("a pick the two-look build kept still reads: light is Day, dark is Night", () => {
    expect(bootTheme(undefined, browser({ [KEY]: "dark" }).win, root(), clock(10).now).current()).toBe("night");
    root().classList.remove("dark");
    delete root().dataset.theme;
    expect(bootTheme(undefined, browser({ [KEY]: "light" }).win, root(), clock(21).now).current()).toBe("day");
  });

  it("a kept `auto`, from the build that had that mode, names no theme: the served one holds, else the clock", () => {
    served("evening");
    expect(bootTheme(readServedTheme(), browser({ [KEY]: "auto" }).win, root(), clock(10).now).current()).toBe("evening");
    document.head.querySelectorAll("meta").forEach((m) => m.remove());
    expect(bootTheme(undefined, browser({ [KEY]: "auto" }).win, root(), clock(10).now).current()).toBe("day");
  });

  it("a kept value that is not a theme is ignored, and the served theme holds", () => {
    served("evening");
    const look = bootTheme(readServedTheme(), browser({ [KEY]: "dusk" }).win, root(), clock(10).now);
    expect(look.current()).toBe("evening");
  });
});

describe("with browser storage blocked", () => {
  it("boots on the served theme, then on the clock's, as if nothing were kept", () => {
    served("evening");
    expect(bootTheme(readServedTheme(), lockedBrowser().win, root(), clock(10).now).current()).toBe("evening");
    document.head.querySelectorAll("meta").forEach((m) => m.remove());
    expect(bootTheme(undefined, lockedBrowser().win, root(), clock(10).now).current()).toBe("day");
  });

  it("still changes the look live; the pick just isn't kept", () => {
    const look = bootTheme(undefined, lockedBrowser().win, root(), clock(10).now);
    expect(() => look.choose("night")).not.toThrow();
    expect(isDark()).toBe(true);
  });
});

describe("a pick fades in, it doesn't flip", () => {
  it("doesn't fade on the first paint: there is nothing to fade from", () => {
    bootTheme(undefined, browser().win, root(), clock(10).now);
    expect(fading()).toBe(false);
  });

  it("fades for a third of a second, then lets go of every element", () => {
    const look = bootTheme(undefined, browser().win, root(), clock(10).now);
    look.choose("evening");
    expect(fading()).toBe(true);

    vi.advanceTimersByTime(500);
    expect(fading()).toBe(false);
  });

  it("doesn't fade for a pick that leaves the theme where it was", () => {
    const look = bootTheme(undefined, browser().win, root(), clock(10).now);
    look.choose("day");
    expect(fading()).toBe(false);
  });
});
