// @vitest-environment happy-dom
/**
 * A received message that is a call is marked as one: its sender is waiting on
 * this worker's reply, so someone watching the conversation has to tell it
 * apart from a plain message, which wants nothing back.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentItem } from "@flow-state-dev/core/items";
import { afterEach, describe, expect, it } from "vitest";
import { ReceivedMessage } from "../src/components/ReceivedMessage";

afterEach(cleanup);

function received(data: Record<string, unknown>): ComponentItem {
  return { type: "component", id: "it_1", ts: 0, data: { id: "msg_1", from: "eng.author", text: "the codename?", ...data } } as unknown as ComponentItem;
}

describe("a received message", () => {
  it("marks a call, since its sender waits for this worker's reply", () => {
    render(<ReceivedMessage item={received({ call: true })} />);
    expect(screen.getByTestId("received-message").dataset.call).toBe("true");
    expect(screen.getByTestId("received-message-call").textContent).toBe("call · the reply goes back");
  });

  it("marks a call that answers a message of this worker's with both notes", () => {
    render(<ReceivedMessage item={received({ call: true, inReplyTo: "msg_0" })} />);
    expect(screen.getByTestId("received-message-answers")).toBeTruthy();
    expect(screen.getByTestId("received-message-call")).toBeTruthy();
  });

  it("draws a plain message without the mark", () => {
    render(<ReceivedMessage item={received({ call: false })} />);
    expect(screen.getByTestId("received-message").dataset.call).toBe("false");
    expect(screen.queryByTestId("received-message-call")).toBeNull();
  });

  it("reads an item stored before calls existed as a plain message", () => {
    render(<ReceivedMessage item={received({})} />);
    expect(screen.getByTestId("received-message").dataset.call).toBe("false");
    expect(screen.queryByTestId("received-message-call")).toBeNull();
  });
});
