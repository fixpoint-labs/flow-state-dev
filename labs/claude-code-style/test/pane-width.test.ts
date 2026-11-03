// @vitest-environment happy-dom
/**
 * The right pane's width is yours: it stays where you dragged it across a
 * reload, never past its floor or ceiling, and a browser that can't store it
 * still gets a usable pane.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampPaneWidth, PANE_DEFAULT, PANE_MAX, PANE_MIN, readPaneWidth } from "../src/lib/pane-width";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the pane's width", () => {
  it("keeps a width between the floor and the ceiling", () => {
    expect(clampPaneWidth(10)).toBe(PANE_MIN);
    expect(clampPaneWidth(5000)).toBe(PANE_MAX);
    expect(clampPaneWidth(400.4)).toBe(400);
  });

  it("reads the remembered width, clamped, and the default when none or a bad one is stored", () => {
    expect(readPaneWidth()).toBe(PANE_DEFAULT);
    localStorage.setItem("claude-code-style:pane-width", "480");
    expect(readPaneWidth()).toBe(480);
    localStorage.setItem("claude-code-style:pane-width", "9000");
    expect(readPaneWidth()).toBe(PANE_MAX);
    localStorage.setItem("claude-code-style:pane-width", "wide");
    expect(readPaneWidth()).toBe(PANE_DEFAULT);
  });

  it("falls back to the default when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPaneWidth()).toBe(PANE_DEFAULT);
  });
});
