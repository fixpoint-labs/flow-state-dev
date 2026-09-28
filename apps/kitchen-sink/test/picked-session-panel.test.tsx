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
 *   - settle on the session's `isStreaming` rather than the send's own
 *     request's status: the settles-on-its-own-request case fails (the text
 *     clears when another request's stream closes).
 *   - leave the composer unkeyed by session: the switching-picks case fails
 *     (the first seat's draft is still there).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PickedSessionPanel } from "../components/picked-session-panel";

afterEach(cleanup);

type Item = Record<string, unknown>;

type Run = { id: string; flowId?: string; status?: string };

function session(
  over: {
    sessionId?: string;
    items?: Item[];
    childSessions?: Run[];
    childSessionsStale?: boolean;
    isStreaming?: boolean;
    isStuck?: boolean;
    sendAction?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    sessionId: over.sessionId ?? "sess-a",
    items: over.items ?? [],
    childSessions: (over.childSessions ?? []).map((run) => ({
      parentSessionId: over.sessionId ?? "sess-a",
      createdAt: 1,
      updatedAt: 1,
      ...run,
    })),
    childSessionsStale: over.childSessionsStale ?? false,
    isStreaming: over.isStreaming ?? false,
    isStuck: over.isStuck ?? false,
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

/** The server's answer for each request id; anything unlisted is still running. */
let statuses: Record<string, string> = {};
const requestStatus = vi.fn(async (id: string) => statuses[id] ?? "in_progress");
afterEach(() => {
  statuses = {};
  requestStatus.mockClear();
});

function panel(kind: string, s: never) {
  return render(
    <PickedSessionPanel session={s} kind={kind} requestStatus={requestStatus} conversation={<div data-testid="stream-items" />} />,
  );
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
          line("1", "from a seat", { author: "support.devices", principal: "devuser" }),
          { id: "noise", type: "message", role: "assistant", content: [] },
          line("2", "from the page", { principal: "devuser" }),
          line("3", "from the digest kind"),
        ],
      }),
    );
    const labels = screen.getAllByTestId("channel-line-label").map((el) => el.textContent);
    const bodies = screen.getAllByTestId("channel-line-body").map((el) => el.textContent);
    expect(bodies).toEqual(["from a seat", "from the page", "from the digest kind"]);
    expect(labels).toEqual(["support.devices", "devuser", "unattributed"]);
    // The stream is not drawn for a channel: its transcript is.
    expect(screen.queryByTestId("stream-items")).toBeNull();
  });

  it("shows an empty transcript and still posts, when the session holds no channel-post item", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } }));
    panel("channel", session({ items: [{ id: "x", type: "message", role: "assistant", content: [] }], sendAction }));
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
        requestStatus={requestStatus}
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
    statuses["req-kept"] = "completed";
    sendAction.mockResolvedValueOnce({ status: "in_progress", request: { id: "req-kept" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(3));
    view.rerender(
      <PickedSessionPanel
        session={session({
          sendAction,
          items: [line("k", "please keep me", { principal: "devuser" })],
        })}
        kind="channel"
        requestStatus={requestStatus}
        conversation={null}
      />,
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe(""),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a send settles on its own request", () => {
  it("keeps the text while another request ends, and shows the failure when its own does", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-mine" } }));
    const view = panel("channel", session({ sendAction, isStreaming: true }));
    await type("Post to this channel", "not yet kept");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendAction).toHaveBeenCalledTimes(1));

    // Some other request on this session finishes: the stream closes, with no
    // error item for this send. That says nothing about this send.
    view.rerender(
      <PickedSessionPanel
        session={session({ sendAction, isStreaming: false })}
        kind="channel"
        requestStatus={requestStatus}
      />,
    );
    // This send is still running, so nothing settles.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe("not yet kept");
    expect(screen.queryByRole("alert")).toBeNull();
    // It asked the server about this send, not about the session.
    expect(requestStatus).toHaveBeenCalledWith("req-mine");

    // This send's own request then fails, with no error item: the failure
    // shows once the next check sees it, and the text stays.
    statuses["req-mine"] = "failed";
    expect((await screen.findByRole("alert", undefined, { timeout: 2000 })).textContent).toContain("failed");
    expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe("not yet kept");
  });
});

describe("switching picks", () => {
  it("starts the next session's composer empty, with nothing pending and no failure", async () => {
    const sendAction = vi.fn(async () => ({ status: "in_progress", request: { id: "req-1" } }));
    const view = panel("agent", session({ sessionId: "sess-a", sendAction }));
    await type("Message this seat", "meant for the first seat");

    view.rerender(<PickedSessionPanel session={session({ sessionId: "sess-b", sendAction })} kind="agent" requestStatus={requestStatus} />);
    expect((screen.getByLabelText("Message this seat") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a seat's panel", () => {
  it.each([
    ["agent", "run", { message: "where is my refund?" }],
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

  // FIX-1611 BR-15.
  it("a seat of a kind the page has no action for has no composer, and says so", () => {
    panel("a-kind-this-page-does-not-know", session());
    expect(screen.queryByTestId("picked-composer")).toBeNull();
    expect(screen.getByTestId("picked-read-only").textContent).toBe(
      "This a-kind-this-page-does-not-know seat takes no messages from this page.",
    );
    expect(screen.queryByText(/go to the assistant/)).toBeNull();
  });
});

describe("who is working", () => {
  const rows = () => screen.queryAllByTestId("working-row").map((el) => el.textContent);
  const rerender = (view: ReturnType<typeof panel>, kind: string, s: never) =>
    view.rerender(<PickedSessionPanel session={s} kind={kind} requestStatus={requestStatus} conversation={null} />);

  it.each(["channel", "agent"])("a %s panel names each unfinished run by its flow", (kind) => {
    panel(kind, session({ childSessions: [{ id: "run-1", flowId: "support.otto", status: "active" }] }));
    expect(rows()).toEqual(["support.otto is working"]);
  });

  it("clears the row when the run finishes, however it ends, and keeps the line it posted", () => {
    const working = [{ id: "run-1", flowId: "support.otto", status: "active" }];
    const view = panel("channel", session({ childSessions: working }));
    expect(rows()).toEqual(["support.otto is working"]);

    for (const status of ["completed", "failed", "incomplete", "aborted"]) {
      rerender(view, "channel", session({ childSessions: working }));
      expect(rows()).toEqual(["support.otto is working"]);
      rerender(
        view,
        "channel",
        session({
          childSessions: [{ id: "run-1", flowId: "support.otto", status }],
          items: [line("o", "refunds post on Fridays", { author: "support.otto" })],
        }),
      );
      expect(rows()).toEqual([]);
      expect(screen.getAllByTestId("channel-line-body").map((el) => el.textContent)).toEqual([
        "refunds post on Fridays",
      ]);
    }
  });

  it("reads a run with no status, which has no run to speak of, as not working", () => {
    panel("channel", session({ childSessions: [{ id: "run-1", flowId: "support.otto" }] }));
    expect(rows()).toEqual([]);
  });

  it("shows two seats working on one post as two rows, each clearing on its own", () => {
    const view = panel(
      "channel",
      session({
        childSessions: [
          { id: "run-1", flowId: "support.otto", status: "active" },
          { id: "run-2", flowId: "support.ada", status: "active" },
        ],
      }),
    );
    expect(rows()).toEqual(["support.otto is working", "support.ada is working"]);
    rerender(
      view,
      "channel",
      session({
        childSessions: [
          { id: "run-1", flowId: "support.otto", status: "completed" },
          { id: "run-2", flowId: "support.ada", status: "active" },
        ],
      }),
    );
    expect(rows()).toEqual(["support.ada is working"]);
  });

  it("shows a run with no recorded flow as background work, not a seat", () => {
    panel("channel", session({ childSessions: [{ id: "run-1", status: "active" }] }));
    expect(rows()).toEqual(["Background work is running"]);
  });

  // A failed re-read keeps the last rows it had, and a run it names may have
  // finished since. The row says when it was true, not that it is true now.
  it("says a row was true at the last check while the list could not be read again", () => {
    const working = [
      { id: "run-1", flowId: "support.otto", status: "active" },
      { id: "run-2", status: "active" },
    ];
    const view = panel("channel", session({ childSessions: working, childSessionsStale: true }));
    expect(rows()).toEqual([
      "support.otto was working at the last check",
      "Background work was running at the last check",
    ]);

    rerender(view, "channel", session({ childSessions: working }));
    expect(rows()).toEqual(["support.otto is working", "Background work is running"]);
  });

  it("keeps no timer of its own, and keeps the draft, as lines land and runs end", async () => {
    vi.useFakeTimers();
    try {
      const view = panel("channel", session({ childSessions: [{ id: "run-1", flowId: "support.otto", status: "active" }] }));
      fireEvent.change(screen.getByLabelText("Post to this channel"), { target: { value: "half a thought" } });
      rerender(
        view,
        "channel",
        session({
          childSessions: [{ id: "run-1", flowId: "support.otto", status: "completed" }],
          items: [line("o", "refunds post on Fridays", { author: "support.otto" })],
        }),
      );
      expect(vi.getTimerCount()).toBe(0);
      // Not remounted: the draft is still there.
      expect((screen.getByLabelText("Post to this channel") as HTMLTextAreaElement).value).toBe("half a thought");
    } finally {
      vi.useRealTimers();
    }
  });
});
