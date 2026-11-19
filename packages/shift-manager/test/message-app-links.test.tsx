// @vitest-environment happy-dom
/**
 * The Error Reporter's waiting line links to the report's Inbox item with an
 * address relative to the page's `<base href>` (`./inbox/<session>`): the Lab
 * writes it before any page asks for it, so it can't know the prefix the page
 * is served at. Drawn in chat, the link opens that item at the root of its
 * origin and under a proxy's sub-route (`/shift-manager/`) alike, rather than
 * leaving the sub-route for another app.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageResponse } from "../src/components/flow-state/message-response";

function serveAt(base: string) {
  document.head.querySelector("base")?.remove();
  const element = document.createElement("base");
  element.setAttribute("href", base);
  document.head.prepend(element);
}

afterEach(() => {
  cleanup();
  document.head.querySelector("base")?.remove();
});

const SESSION = "error-report~fp-0123456789abcdef";
const LINE = `Waiting in your Inbox: **Checkout total wrong**. [Open it in Inbox](./inbox/${encodeURIComponent(SESSION)})`;

/** Follow the chat link named `name` through its confirm, and say which page address it opened. */
async function follow(name: string): Promise<string | undefined> {
  const opened: string[] = [];
  const open = vi.spyOn(window, "open").mockImplementation((url) => (opened.push(String(url)), null));
  await act(async () => void fireEvent.click(await screen.findByRole("button", { name })));
  await act(async () => void fireEvent.click(await screen.findByRole("button", { name: "Open link" })));
  open.mockRestore();
  // Where the browser goes: the address resolved against the page's base, as `window.open` resolves it.
  return opened[0] === undefined ? undefined : new URL(opened[0], document.baseURI).pathname;
}

describe("the waiting line's link in chat", () => {
  it("opens the report's Inbox item under a proxy's sub-route", async () => {
    serveAt("/shift-manager/");
    render(<MessageResponse>{LINE}</MessageResponse>);
    expect(await follow("Open it in Inbox")).toBe(`/shift-manager/inbox/${SESSION}`);
  });

  it("opens it at the root of its origin", async () => {
    serveAt("/");
    render(<MessageResponse>{LINE}</MessageResponse>);
    expect(await follow("Open it in Inbox")).toBe(`/inbox/${SESSION}`);
  });
});
