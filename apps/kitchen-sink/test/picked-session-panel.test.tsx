// @vitest-environment happy-dom
/**
 * The picked session's panel: what a channel shows, and what each composer
 * sends to which action.
 *
 * The page's sends are the whole contract here. A composer that sends the
 * wrong action, or sends an `author`, would still render; only the recorded
 * call catches it. The browser half (the line survives a reload, the seat
 * keeps both sides) is `e2e/talk-from-page.spec.ts` and the goal check.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1585/PLAN.md` V5). Red states
 * produced before these were trusted:
 *   - label a line `principal ?? author`: the label-order case fails.
 *   - drop the `text.length === 0` guard on Send: the whitespace case fails.
 *   - clear the draft when the send resolves, not when the stream settles:
 *     the refused-post case fails (the text is gone).
 *   - send `{ body, author: "devuser" }` from the channel composer: the
 *     channel case fails on the recorded input.
 *   - point `agent` at `answer`: the agent case fails.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PickedSessionPanel } from "../components/picked-session-panel";

afterEach(cleanup);

type Item = Record<string, unknown>;

function session(over: { items?: Item[]; isStreaming?: boolean; sendAction?: ReturnType<typeof vi.fn> } = {}) {
  return {
    items: over.items ?? [],
    isStreaming: over.isStreaming ?? false,
    isFinishing: false,
    isLoading: false,
    statusMessage: "",
    error: null,
    sendAction: over.sendAction ?? vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } })),
  } as never;
}

const line = (id: string, body: string, who: { author?: string; principal?: string } = {}): Item => ({
  id: `item-${id}`,
  type: "component",
  component: "channel-post",
  requestId: `req-${id}`,
  data: { id, at: 1, authorVerified: false, body, ...who },
});

function panel(kind: string, s: never) {
  return render(<PickedSessionPanel session={s} kind={kind} conversation={<div data-testid="stream-items" />} />);
}

async function type(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

describe("a channel's panel", () => {
  it("shows the transcript oldest first, each line under its author, else its principal, else unattributed", () => {
    panel(
      "channel",
      session({
        items: [
          line("1", "from a seat", { author: "support.ada", principal: "devuser" }),
          { id: "noise", type: "message", role: "assistant", content: [] },
          line("2", "from the page", { principal: "devuser" }),
          line("3", "from the digest kind"),
        ],
      }),
    );
    const labels = screen.getAllByTestId("channel-line-label").map((el) => el.textContent);
    const bodies = screen.getAllByTestId("channel-line-body").map((el) => el.textContent);
    expect(bodies).toEqual(["from a seat", "from the page", "from the digest kind"]);
    expect(labels).toEqual(["support.ada", "devuser", "unattributed"]);
    // The stream is not drawn for a channel: its transcript is.
    expect(screen.queryByTestId("stream-items")).toBeNull();
  });

  it("shows an empty transcript and still posts, when the kind emits no channel-post item", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } }));
    panel("digest", session({ items: [{ id: "x", type: "message", role: "assistant", content: [] }], sendAction }));
    expect(screen.queryAllByTestId("channel-line")).toHaveLength(0);
    await type("Post to this channel", "hello");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
  });

  it("posts the body alone to the channel's own post action", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } }));
    panel("channel", session({ sendAction }));
    await type("Post to this channel", "  a line  ");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    expect(sendAction.mock.calls[0]).toEqual(["post", { body: "a line" }]);
  });

  it("will not send whitespace", async () => {
    const sendAction = vi.fn();
    panel("channel", session({ sendAction }));
    await type("Post to this channel", "   \n  ");
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.submit(screen.getByTestId("picked-composer"));
    expect(sendAction).not.toHaveBeenCalled();
  });

  it("shows a refused post's reason and keeps the text, then clears it once a post is kept", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-refused" } }));
    const view = panel("channel", session({ sendAction, isStreaming: true }));
    await type("Post to this channel", "please keep me");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));

    // The request fails on the server: its error item arrives, the stream closes.
    view.rerender(
      <PickedSessionPanel
        session={session({
          sendAction,
          items: [{ id: "e", type: "error", requestId: "req-refused", message: "channel-not-bound: not an open channel" }],
        })}
        kind="channel"
        conversation={null}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("channel-not-bound");
    expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe("please keep me");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);

    // A send the door refuses outright says why, and keeps the text too.
    sendAction.mockRejectedValueOnce(new Error("Request failed (409)"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain("409");
    expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe("please keep me");

    // A post the server keeps clears the composer.
    sendAction.mockResolvedValueOnce({ status: "in_progress", request: { id: "req-kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(3));
    view.rerender(
      <PickedSessionPanel session={session({ sendAction, items: [line("k", "please keep me", { principal: "devuser" })] })} kind="channel" conversation={null} />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe(""),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a seat's panel", () => {
  it.each([
    ["agent", "run", { message: "where is my refund?" }],
    ["desk-clerk", "answer", { note: "where is my refund?" }],
  ])("a %s seat sends its kind's own action", async (kind, action, input) => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } }));
    panel(kind, session({ sendAction }));
    // A seat keeps its item stream.
    expect(screen.getByTestId("stream-items")).toBeTruthy();
    await type("Message this seat", "where is my refund?");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));
    // No optimistic copy: nothing but the action and its input is sent.
    expect(sendAction.mock.calls[0]).toEqual([action, input]);
  });

  it("a seat whose kind takes no messages has no composer, and says why", () => {
    panel("followup-runner", session());
    expect(screen.queryByTestId("picked-composer")).toBeNull();
    expect(screen.getByTestId("picked-read-only").textContent).toContain("runs rows from a board");
    expect(screen.queryByText(/go to the assistant/)).toBeNull();
  });
});
