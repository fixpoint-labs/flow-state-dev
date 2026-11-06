// @vitest-environment happy-dom
/**
 * The right pane's width is yours: it stays where you dragged it across a
 * reload, never past its floor or ceiling, and a browser that can't store it
 * still gets a usable pane.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampPaneWidth,
  clampSidebarWidth,
  PANE_DEFAULT,
  PANE_MAX,
  PANE_MIN,
  readPaneWidth,
  readSidebarWidth,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  sidebarColumn,
  sidebarDefault,
  STRIP_WIDTH,
} from "../src/lib/pane-width";

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

describe("the sessions list's width", () => {
  it("opens roomier on a wide window than on a narrow one", () => {
    expect(sidebarDefault(1920)).toBeGreaterThan(sidebarDefault(1024));
    expect(sidebarDefault(1024)).toBe(240);
  });

  it("keeps a width between its floor and ceiling", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX);
  });

  it("reads the remembered width, and this window's default when none or a bad one is stored", () => {
    expect(readSidebarWidth()).toBe(sidebarDefault());
    localStorage.setItem("claude-code-style:sidebar-width", "320");
    expect(readSidebarWidth()).toBe(320);
    localStorage.setItem("claude-code-style:sidebar-width", "wide");
    expect(readSidebarWidth()).toBe(sidebarDefault());
  });
});

describe("the sessions list's column", () => {
  it("leaves the pane's floor beside the thread, and only its strip once the pane is collapsed", () => {
    // A collapsed pane takes 43px, not 280: the list is not squeezed on a narrow window for a pane that is not there.
    expect(sidebarColumn(300)).toContain("100vw - 280px");
    expect(sidebarColumn(300, false, true)).toContain(`100vw - ${STRIP_WIDTH}px`);
    expect(sidebarColumn(300, false, true)).not.toContain("280px");
  });

  it("is a fixed rail when collapsed, whatever the pane does", () => {
    expect(sidebarColumn(300, true)).toBe("48px");
    expect(sidebarColumn(300, true, true)).toBe("48px");
  });
});
