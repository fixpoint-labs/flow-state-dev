// @vitest-environment happy-dom
/**
 * A received message that asks for a reply is marked as one: its sender is
 * owed this worker's answer (FIX-2310, FIX-2318), so someone watching the
 * conversation has to tell it apart from a plain message, which wants nothing back.
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

/**
 * A worker's reply is written in Markdown, as its own messages are, and the
 * feed draws those as Markdown: a table it sends must read as a table, and a
 * link must be one, not raw pipes and brackets the user has to decode (FIX-2792).
 */
describe("a received message's text", () => {
  const table = ["| Report | Status |", "| --- | --- |", "| fp-12 | waiting in Inbox |", "| fp-13 | filed |"].join("\n");

  it("draws a Markdown table as a table, not as pipe text", () => {
    render(<ReceivedMessage item={received({ from: "error-reporter", text: `Two reports:\n\n${table}` })} />);
    const body = screen.getByTestId("received-message");
    const cells = [...body.querySelectorAll("td")].map((cell) => cell.textContent);
    expect(cells).toEqual(["fp-12", "waiting in Inbox", "fp-13", "filed"]);
    expect(body.textContent).not.toContain("| --- |");
  });

  it("draws a Markdown link and a bare URL as links, as a worker's own messages draw them", () => {
    render(
      <ReceivedMessage
        item={received({ text: "Filed [FIX-12](https://linear.app/acme/issue/FIX-12); the run is at https://example.com/runs/7" })}
      />
    );
    // Streamdown draws a link as a button that asks before it opens the page.
    const links = [...screen.getByTestId("received-message").querySelectorAll('[data-streamdown="link"]')].map((link) => link.textContent);
    expect(links).toEqual(["FIX-12", "https://example.com/runs/7"]);
  });

  it("shows HTML in a reply as text, never as an element", () => {
    render(<ReceivedMessage item={received({ text: "see <img src=x onerror=alert(1)> here" })} />);
    expect(screen.getByTestId("received-message").querySelector("img")).toBeNull();
  });
});
