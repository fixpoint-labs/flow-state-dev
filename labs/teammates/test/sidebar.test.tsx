// @vitest-environment happy-dom
/**
 * The left sidebar folds to a rail of icons: a toggle in its header does it, a
 * narrow window does it on its own, and a wide window opens it again unless
 * the viewer collapsed it there. The rail still lists every teammate with its
 * badges, so the tab's title keeps counting and a teammate still opens a
 * conversation. Opened on a narrow window, it lies over the conversation and
 * closes once a teammate is picked.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/components/App";
import { AttentionBadges } from "../src/components/WorkersList";
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
  vi.restoreAllMocks();
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
/** Collapsed, as the toggle tells a screen reader: it is expanded only while the sidebar is open. */
const collapsed = () => within(sidebar()).getByRole("button", { name: /^(Open|Collapse) sidebar$/ }).getAttribute("aria-expanded") === "false";
const toggle = () => fireEvent.click(within(sidebar()).getByRole("button", { name: /^(Open|Collapse) sidebar$/ }));
const teammates = () => [...sidebar().querySelectorAll<HTMLElement>("[data-worker]")];
const teammate = (name: string) => sidebar().querySelector<HTMLElement>(`[data-worker="${name}"]`)!;
const backdrop = () => document.querySelector<HTMLElement>("[data-sidebar-backdrop]");

async function tell(worker: string, text: string) {
  const box = await screen.findByLabelText(`Message ${worker}`);
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  });
}

describe("the sidebar", () => {
  it("collapses to a rail that still lists and opens every teammate, and a wide window remembers it", async () => {
    fakeWindow(false);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(false);
    const count = teammates().length;

    toggle();
    expect(collapsed()).toBe(true);
    // Every teammate stays, named for a screen reader; the hire button is kept, the notify switch waits.
    expect(teammates()).toHaveLength(count);
    expect(within(sidebar()).getByRole("button", { name: "Hire a teammate" })).toBeTruthy();
    expect(within(sidebar()).queryByRole("switch")).toBeNull();
    const other = teammates().find((t) => t.getAttribute("aria-current") !== "true")!;
    fireEvent.click(other);
    await waitFor(() => expect(other.getAttribute("aria-current")).toBe("true"));

    // A reload on a wide window starts the way it was left.
    cleanup();
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(true);
    toggle();
    expect(collapsed()).toBe(false);
  });

  it("collapses on its own on a narrow window, and opens again when the window widens", async () => {
    const window = fakeWindow(true);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(collapsed()).toBe(true);

    // Opened by hand on a narrow window: it opens, but isn't remembered, so narrowing again collapses it.
    toggle();
    expect(collapsed()).toBe(false);
    await window.resize(false);
    expect(collapsed()).toBe(false);
    await window.resize(true);
    expect(collapsed()).toBe(true);
    await window.resize(false);
    expect(collapsed()).toBe(false);
  });

  it("keeps a wide-window choice across resizes when browser storage refuses it", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const window = fakeWindow(false);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    toggle();
    await window.resize(true);
    await window.resize(false);
    expect(collapsed()).toBe(true);
  });

  it("opened on a narrow window, lies over the conversation and closes on a pick or a click outside", async () => {
    fakeWindow(true);
    renderApp();
    await waitFor(() => expect(teammates().length).toBeGreaterThan(1));
    expect(backdrop()).toBeNull();

    toggle();
    expect(sidebar().className).toContain("absolute");
    fireEvent.click(backdrop()!);
    expect(collapsed()).toBe(true);
    expect(backdrop()).toBeNull();

    toggle();
    const other = teammates().find((t) => t.getAttribute("aria-current") !== "true")!;
    fireEvent.click(other);
    expect(collapsed()).toBe(true);
    await waitFor(() => expect(other.getAttribute("aria-current")).toBe("true"));
  });

  it("badges the rail: a teammate's unread lines, and one that needs you", async () => {
    fakeWindow(false);
    renderApp();
    await tell("Lead", "Ask researcher for our launch date, and help me outline the post.");
    toggle();
    await waitFor(() => expect(within(teammate("researcher")).getByLabelText(/unread/).textContent).toBe("3"), { timeout: 2000 });
    // The tooltip names the teammate and says what it is doing.
    expect(teammate("researcher").title).toMatch(/^researcher · /);

    fireEvent.click(teammate("writer"));
    await tell("writer", "Publish the draft.");
    await waitFor(() => expect(teammate("writer").querySelector("[data-needs-you]")).toBeTruthy());
  });
});

describe("a teammate's badges", () => {
  const badges = (props: { needsYou: boolean; unread: number; compact?: boolean }) => {
    const { container } = render(<AttentionBadges {...props} />);
    return { needsYou: container.querySelector("[data-needs-you]") !== null, unread: container.querySelector("[aria-label$='unread']")?.textContent };
  };

  it("in the full row, show needs you and the whole unread count side by side", () => {
    expect(badges({ needsYou: true, unread: 12 })).toEqual({ needsYou: true, unread: "12" });
  });

  it("on the rail, give the one corner to needs you, and stop the count at 9+", () => {
    expect(badges({ needsYou: true, unread: 12, compact: true })).toEqual({ needsYou: true, unread: undefined });
    cleanup();
    expect(badges({ needsYou: false, unread: 12, compact: true })).toEqual({ needsYou: false, unread: "9+" });
    cleanup();
    expect(badges({ needsYou: false, unread: 9, compact: true })).toEqual({ needsYou: false, unread: "9" });
  });
});
