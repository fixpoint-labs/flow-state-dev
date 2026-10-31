// @vitest-environment happy-dom
/**
 * The lab is worked from the keyboard: a person switches sessions, starts
 * one, and gets back to typing without the mouse. Each case fails if its key
 * stops reaching what it promises, or if a key typed into the composer stops
 * being text.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFakeLab } from "./fake-lab";

afterEach(cleanup);

const list = () => screen.getByRole("navigation", { name: "Sessions" });
const composer = () => screen.queryByLabelText("Message the main session") as HTMLTextAreaElement | null;
const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.activeElement ?? document.body) =>
  act(() => void fireEvent.keyDown(on, { key, ...init }));

async function openApp() {
  render(<App adapter={createFakeLab({ speed: 0.01 })} />);
  await screen.findByRole("region", { name: "Choose a project" });
  // Start every step from the list, not a text field.
  within(list()).getByRole("button", { name: /Draft the launch note/ }).focus();
}

describe("keys", () => {
  it("⌘K finds a session by its title and opens it with the cursor in its composer", async () => {
    await openApp();
    press("k", { metaKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "launch note" } });
    press("Enter", {}, input);
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect(within(list()).getByRole("button", { current: true }).textContent).toMatch(/Draft the launch note/);
  });

  it("⌘K's New session asks for a project with the cursor on the first one, and picking it opens the composer", async () => {
    await openApp();
    press("k", { ctrlKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "new session" } });
    press("Enter", {}, input);
    const picker = await screen.findByRole("region", { name: "Choose a project" });
    await waitFor(() => expect(document.activeElement).toBe(within(picker).getAllByRole("button")[0]));
  });

  it("Alt+↑ and Alt+↓ step through the view's sessions, from the composer too", async () => {
    await openApp();
    fireEvent.click(within(list()).getByRole("button", { name: /Draft the launch note/ }));
    const rows = () => within(list()).getAllByRole("listitem").map((li) => li.querySelector("button")!);
    const at = () => rows().findIndex((b) => b.getAttribute("aria-current") === "true");
    const start = at();
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    press("ArrowDown", { altKey: true });
    await waitFor(() => expect(at()).toBe(Math.min(start + 1, rows().length - 1)));
    press("ArrowUp", { altKey: true });
    await waitFor(() => expect(at()).toBe(start));
    await waitFor(() => expect(document.activeElement).toBe(composer()));
  });

  it("/ puts the cursor in the composer, and / ? [ typed there stay text", async () => {
    await openApp();
    fireEvent.click(within(list()).getByRole("button", { name: /Draft the launch note/ }));
    const box = await screen.findByLabelText("Message the main session");
    within(list()).getByRole("button", { name: /Draft the launch note/ }).focus();
    press("/");
    expect(document.activeElement).not.toBe(box);
    await waitFor(() => expect(document.activeElement).toBe(box));
    for (const key of ["/", "?", "["]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      box.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("? lists every key, and Esc puts focus back", async () => {
    await openApp();
    const from = document.activeElement;
    press("?");
    const sheet = await screen.findByRole("dialog", { name: "Keys" });
    const keys = [...sheet.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(keys).toEqual(expect.arrayContaining(["⌘K / Ctrl+K", "Alt+↑ / Alt+↓", "/", "?", "← / →"]));
    press("Escape", {}, sheet);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(from));
  });

  it("the view switch is one Tab stop, and ← → move between views", async () => {
    await openApp();
    const views = screen.getByRole("tablist", { name: "View" });
    const tabs = within(views).getAllByRole("tab");
    expect(tabs.filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    const sessionsTab = within(views).getByRole("tab", { name: "Sessions" });
    sessionsTab.focus();
    press("ArrowRight");
    const projectsTab = within(views).getByRole("tab", { name: "Projects" });
    expect(projectsTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(projectsTab);
    expect(within(views).getAllByRole("tab").filter((t) => t.getAttribute("tabindex") === "0")).toEqual([projectsTab]);
  });
});
