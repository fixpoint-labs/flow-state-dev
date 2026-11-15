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
