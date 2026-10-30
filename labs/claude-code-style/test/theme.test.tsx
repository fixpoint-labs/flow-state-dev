// @vitest-environment happy-dom
/**
 * The look, from the sidebar. What matters: the page opens on the system's
 * setting and follows it while nobody has picked, a pick beats the system from
 * then on and survives a reload, and the look reaches the root element, which
 * is the only thing the theme keys on.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionsList } from "../src/components/SessionsList";
import { bootTheme, currentTheme } from "../src/lib/theme";

const KEY = "claude-code-style.theme";

/** The system's light or dark setting, which the lab reads through `matchMedia`. */
let systemDark = false;
// The lab listens once, so these outlive a test; firing them is a system change.
const systemListeners: (() => void)[] = [];

beforeEach(() => {
  systemDark = false;
  window.localStorage.clear();
  document.documentElement.className = "";
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return query.includes("prefers-color-scheme: dark") && systemDark;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => systemListeners.push(fn),
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(cleanup);

const dark = () => document.documentElement.classList.contains("dark");
const systemChanges = (toDark: boolean) => {
  systemDark = toDark;
  for (const fire of systemListeners) fire();
};

/** The left pane, with no sessions: its foot's theme mark is what these press. */
const sidebar = () =>
  render(
    <SessionsList
      view="session"
      modes={["session"]}
      sessions={[]}
      selectedId={undefined}
      onView={() => {}}
      onSelect={() => {}}
      onNew={() => {}}
    />,
  );

describe("the look", () => {
  it("opens on the system's setting, and follows it while nobody has picked", () => {
    systemDark = true;
    bootTheme();
    expect(dark()).toBe(true);

    systemChanges(false);
    expect(dark()).toBe(false);
  });

  it("flips the page when the mark is pressed, and keeps the pick for the next visit", () => {
    bootTheme();
    sidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(dark()).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe("dark");

    // The mark now offers the way back.
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(dark()).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe("light");
  });

  it("holds a kept pick over the system, at open and when the system changes", () => {
    window.localStorage.setItem(KEY, "dark");
    bootTheme(); // The system says light.
    expect(currentTheme()).toBe("dark");
    expect(dark()).toBe(true);

    window.localStorage.setItem(KEY, "light");
    systemDark = true;
    bootTheme(); // The system says dark.
    expect(dark()).toBe(false);

    systemChanges(false);
    systemChanges(true);
    expect(dark()).toBe(false);
  });

  // Last: a refusal is remembered, so a later test would read a blocked store.
  it("still flips the page when storage is blocked, it just isn't kept", () => {
    const refuse = () => {
      throw new Error("blocked");
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: refuse, setItem: refuse, clear: refuse },
    });
    bootTheme();
    sidebar();

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(dark()).toBe(true);
  });
});
