// @vitest-environment happy-dom
/**
 * Each side column collapses on its own so the thread can take the window:
 * from its toggle and from `[` and `]`, kept across a reload, and never by a
 * key typed into the composer. The right pane stays mounted while collapsed,
 * so a task open in a sheet stays open.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const list = () => screen.getByRole("navigation", { name: "Sessions" });
const pane = () => screen.getByRole("complementary", { name: "Background tasks", hidden: true });
const press = (key: string, on: Element = document.body) => act(() => void fireEvent.keyDown(on, { key }));

async function openSession() {
  render(<App adapter={createFakeLab({ speed: 0.01 })} />);
  await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(within(list()).getByRole("button", { name: /Draft the launch note/ }));
  await screen.findByLabelText("Message the main session");
}

describe("collapsing the sessions list", () => {
  it("shrinks to a rail that keeps New session, and opens back to the list", async () => {
    await openSession();
    expect(list().getAttribute("data-collapsed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse sessions list" }));
    expect(list().getAttribute("data-collapsed")).toBe("true");
    expect(within(list()).queryByRole("button", { name: /Draft the launch note/ })).toBeNull();
    expect(within(list()).getByRole("button", { name: "New session" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand sessions list" }));
    expect(within(list()).getByRole("button", { name: /Draft the launch note/ })).toBeTruthy();
  });

  it("toggles with [, and a [ typed in the composer stays text", async () => {
    await openSession();
    press("[");
    expect(list().getAttribute("data-collapsed")).toBe("true");
    press("[");
    expect(list().getAttribute("data-collapsed")).toBe("false");
    const box = screen.getByLabelText("Message the main session");
    const typed = new KeyboardEvent("keydown", { key: "[", bubbles: true, cancelable: true });
    box.dispatchEvent(typed);
    expect(typed.defaultPrevented).toBe(false);
    expect(list().getAttribute("data-collapsed")).toBe("false");
  });

  it("stays collapsed across a reload", async () => {
    await openSession();
    press("[");
    cleanup();
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    await waitFor(() => expect(list().getAttribute("data-collapsed")).toBe("true"));
  });
});

describe("collapsing the side panel", () => {
  it("shrinks to a strip that names the pane, and opens back", async () => {
    await openSession();
    const toggle = () => screen.getByRole("button", { name: /(Collapse|Expand) side panel/ });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    press("]");
    expect(toggle().getAttribute("aria-label")).toBe("Expand side panel");
    expect(screen.getByText("Background tasks", { selector: "span" })).toBeTruthy();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Collapse side panel");
  });

  it("keeps the pane mounted while collapsed, so what it opened stays open", async () => {
    await openSession();
    press("]");
    // Hidden, not unmounted: the pane's own state and watch carry on under the strip.
    expect(pane()).toBeTruthy();
    expect(pane().closest(".hidden")).not.toBeNull();
    press("]");
    expect(pane().closest(".hidden")).toBeNull();
  });

  it("does nothing on ] with no pane to collapse", async () => {
    render(<App adapter={createFakeLab({ speed: 0.01 })} />);
    await screen.findByRole("region", { name: "Choose a project" });
    press("]");
    expect(screen.queryByRole("button", { name: /side panel/ })).toBeNull();
    expect(localStorage.getItem("claude-code-style:panels")).toBeNull();
  });
});
