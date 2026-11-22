// @vitest-environment happy-dom
/**
 * The left sidebar folds to a rail of icons: a toggle in its header does it, a
 * narrow window does it on its own, and a wide window opens it again unless
 * the viewer collapsed it there. The rail still lists every teammate, so
 * badges and the tab's title keep counting, and a teammate still opens a conversation.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { NARROW_QUERY } from "../src/lib/sidebar";
import { scriptedServer } from "./scripted-server";
import { stubServer, TestProvider } from "./stub-server";

/** A window whose width the test sets: `matchMedia` answers the sidebar's one query and tells it when the answer changes. */
function fakeWindow(narrow: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return narrow;
    },
    media: NARROW_QUERY,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  window.matchMedia = ((media: string) => (media === NARROW_QUERY ? query : { matches: false, media, addEventListener() {}, removeEventListener() {} })) as never;
  return {
    resize: (to: boolean) =>
      act(() => {
        narrow = to;
        for (const listener of listeners) listener();
      }),
  };
}

const original = window.matchMedia;
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.matchMedia = original;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

function renderApp() {
  render(
    <TestProvider server={scriptedServer({ speed: 0.05 })} client={stubServer({}).client}>
      <App />
    </TestProvider>,
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "Workers" });
const collapsed = () => sidebar().hasAttribute("data-collapsed");
const teammates = () => [...sidebar().querySelectorAll<HTMLElement>("[data-worker]")];

describe("the sidebar", () => {
  it("collapses to a rail that still lists and opens every teammate, and a wide window remembers it", async () => {
    fakeWindow(false);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(false);
    const count = teammates().length;

    fireEvent.click(within(sidebar()).getByRole("button", { name: "Collapse sidebar" }));
    expect(collapsed()).toBe(true);
    // Every teammate stays, named for a screen reader; the hire button is kept, the notify switch waits.
    expect(teammates()).toHaveLength(count);
    expect(within(sidebar()).getByRole("button", { name: "Hire a teammate" })).toBeTruthy();
    expect(within(sidebar()).queryByRole("switch")).toBeNull();
    const other = teammates().find((teammate) => teammate.getAttribute("aria-current") !== "true")!;
    fireEvent.click(other);
    await waitFor(() => expect(other.getAttribute("aria-current")).toBe("true"));

    // A reload on a wide window starts the way it was left.
    cleanup();
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(true);
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Open sidebar" }));
    expect(collapsed()).toBe(false);
  });

  it("collapses on its own on a narrow window, and opens again when the window widens", async () => {
    const window = fakeWindow(true);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(true);

    // Opened by hand on a narrow window: it opens, but isn't remembered, so narrowing again collapses it.
    fireEvent.click(within(sidebar()).getByRole("button", { name: "Open sidebar" }));
    expect(collapsed()).toBe(false);
    await window.resize(false);
    expect(collapsed()).toBe(false);
    await window.resize(true);
    expect(collapsed()).toBe(true);
    await window.resize(false);
    expect(collapsed()).toBe(false);
  });
});
