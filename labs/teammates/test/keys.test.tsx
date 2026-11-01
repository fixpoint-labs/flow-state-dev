// @vitest-environment happy-dom
/**
 * The lab is worked from the keyboard: a person switches teammates, hires
 * one, and gets back to typing without the mouse. Each case fails if its key
 * stops reaching what it promises, or if a key typed into the composer stops
 * being text.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { createFixtureLab } from "./fake-lab";

afterEach(cleanup);

const workers = () => screen.getByRole("navigation", { name: "Workers" });
const composer = () => document.querySelector<HTMLTextAreaElement>("textarea[data-composer]");
const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.activeElement ?? document.body) =>
  act(() => void fireEvent.keyDown(on, { key, ...init }));

async function openApp() {
  render(<App adapter={createFixtureLab({ speed: 0.05 })} />);
  await screen.findByLabelText("Message Chief of Staff");
  // Start every step from the list, not a text field.
  within(workers()).getAllByRole("button")[0]!.focus();
}

describe("keys", () => {
  it("⌘K finds a teammate by its role and opens it with the cursor in its composer", async () => {
    await openApp();
    press("k", { metaKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "drafts and tightens" } });
    press("Enter", {}, input);
    await screen.findByLabelText("Message writer");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message writer")));
    expect(composer()!.getAttribute("data-session-id")).toBeTruthy();
  });

  it("⌘K's Hire a teammate opens the hire form with the cursor in its name", async () => {
    await openApp();
    press("k", { ctrlKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "hire" } });
    press("Enter", {}, input);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Teammate name")));
  });

  it("Alt+↓ and Alt+↑ step through the teammates, from the composer too", async () => {
    await openApp();
    fireEvent.click(within(workers()).getByRole("button", { name: /Chief of Staff/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message Chief of Staff")));
    press("ArrowDown", { altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message researcher")));
    press("ArrowUp", { altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message Chief of Staff")));
    // The ends hold.
    press("ArrowUp", { altKey: true });
    expect(screen.getByLabelText("Message Chief of Staff")).toBeTruthy();
  });

  it("/ puts the cursor in the composer, and / ? [ typed there stay text", async () => {
    await openApp();
    const box = screen.getByLabelText("Message Chief of Staff");
    press("/");
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
    expect([...sheet.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(expect.arrayContaining(["⌘K / Ctrl+K", "Alt+↑ / Alt+↓", "/", "?"]));
    press("Escape", {}, sheet);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(from));
  });
  it("Esc closes the switcher and nothing under it: a popup or sheet listening on the document never sees it", async () => {
    await openApp();
    // What a popup or sheet underneath does: it closes on any Esc that reaches the document.
    const under: string[] = [];
    const listen = (event: KeyboardEvent) => void under.push(event.key);
    document.addEventListener("keydown", listen);
    try {
      press("k", { metaKey: true });
      const input = await screen.findByRole("combobox");
      press("Escape", {}, input);
      await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
      expect(under).not.toContain("Escape");
    } finally {
      document.removeEventListener("keydown", listen);
    }
  });
  it("a pick from ⌘K over the key list closes the key list too, so the hire form takes the keys", async () => {
    await openApp();
    press("?");
    await screen.findByRole("dialog", { name: "Keys" });
    press("k", { metaKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "hire" } });
    press("Enter", {}, input);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Teammate name")));
  });
});
