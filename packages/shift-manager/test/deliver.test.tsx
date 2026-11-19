// @vitest-environment happy-dom
// BR-4; FIX-2776 D2.
/**
 * What the composer tells the user after Send: *delivered* only once the
 * session holds the line, read live from the session's feed and workforce's
 * session turns view. A turn that ended without the line in the session is
 * not delivered, and a lost answer never reads as a failure that invites a
 * second send.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
let feed: { items: unknown[] | undefined; state: string; error: Error | null } | undefined;
let turns: Array<{ id: string; status: string; error: { code: string; message: string } | null }> | undefined;
// The session's own read, when a turn ends ahead of the feed: it holds nothing from these requests.
// And its requests, which a send whose composer closed reads on its own.
const lab = {
  client: {
    userId: "u_1",
    sessions: {
      state: async (..._a: unknown[]) => ({ items: [] as unknown[], pagination: { total: 0 } }),
      requests: async (..._a: unknown[]) => [] as Array<{ id: string; status: string }>,
    },
  },
};
const workforce = { send };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
vi.mock("../src/lib/session-feeds", () => ({ useSharedSessionFeed: (id: string | null) => (id === null ? undefined : feed) }));
vi.mock("@flow-state-dev/react", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/react")>()),
  useView: (_ref: unknown, _input: unknown, options: { enabled?: boolean }) => ({ value: options.enabled === false ? undefined : turns, stale: false }),
}));

import { deliveryOf, HOLD_GRACE_MS, TurnNotDelivered, useDeliverLine } from "../src/lib/deliver";
import { TurnComposer } from "../src/components/TurnComposer";

const line = (requestId: string) => ({ id: `u-${requestId}`, requestId, type: "message", role: "user", ts: 1, content: [] });
const reply = (requestId: string) => ({ id: `a-${requestId}`, requestId, type: "message", role: "assistant", ts: 2, content: [] });
const turn = (id: string, status: string, error: string | null = null) => ({ id, status, error: error === null ? null : { code: "x", message: error } });

describe("where a send stands (deliveryOf)", () => {
  it("is delivered once the turn completed and the session holds the line", () => {
    expect(deliveryOf("q", { items: [line("q"), reply("q")] as never, turn: turn("q", "completed") })).toEqual({ kind: "delivered", suspended: false, stopped: null });
  });

  it("is not delivered while the turn completed but the session doesn't hold the line", () => {
    expect(deliveryOf("q", { items: [reply("q")] as never, turn: turn("q", "completed") })).toEqual({ kind: "answered" });
    // Another request's line is not this one.
    expect(deliveryOf("q", { items: [line("other")] as never, turn: turn("q", "completed") })).toEqual({ kind: "answered" });
  });

  it("says the session holds the line while the turn still runs", () => {
    expect(deliveryOf("q", { items: [line("q")] as never, turn: turn("q", "in_progress") })).toEqual({ kind: "waiting", held: true });
    expect(deliveryOf("q", { items: [] as never, turn: undefined })).toEqual({ kind: "waiting", held: false });
  });

  it("is refused with the door's reason when its turn failed, and not sent when it ended another way", () => {
    const refused = deliveryOf("q", { items: [line("q")] as never, turn: turn("q", "failed", "No such project.") });
    expect(refused.kind === "failed" && refused.error.kind).toBe("refused");
    expect(refused.kind === "failed" && refused.error.message).toBe("No such project.");
    const aborted = deliveryOf("q", { items: [] as never, turn: turn("q", "aborted") });
    expect(aborted.kind === "failed" && aborted.error.kind).toBe("not-sent");
  });

  it("is unconfirmed, never not-sent, when the feed gave up before it could say", () => {
    const gaveUp = deliveryOf("q", { items: [] as never, feedStopped: new Error("the stream closed"), turn: undefined });
    expect(gaveUp.kind === "failed" && gaveUp.error.kind).toBe("unconfirmed");
  });

  it("names what a suspended turn stops on: a user's ask", () => {
    const ask = { id: "s1", requestId: "q", type: "suspension", status: "pending", suspensionId: "sp1", reason: "user_approval", ts: 3 };
    expect(deliveryOf("q", { items: [line("q"), ask] as never, turn: turn("q", "suspended") })).toEqual({ kind: "delivered", suspended: true, stopped: "ask" });
  });
});

describe("a send through useDeliverLine", () => {
  beforeEach(() => {
    send.mockReset();
    feed = { items: [], state: "live", error: null };
    turns = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("tells held once the feed shows the line, and resolves delivered only once the turn ended with it there", async () => {
    send.mockResolvedValue({ requestId: "q" });
    const onHeld = vi.fn();
    const { result, rerender } = renderHook(() => useDeliverLine());
    let settled: unknown;
    await act(async () => {
      void result.current({ sessionId: "s1", taskId: "t1" }, "hello", { onHeld }).then((v) => (settled = v));
    });
    expect(send).toHaveBeenCalledWith("s1", "hello", { taskId: "t1" });
    feed = { items: [line("q")], state: "live", error: null };
    turns = [turn("q", "in_progress")];
    await act(async () => rerender());
    expect(onHeld).toHaveBeenCalledTimes(1);
    expect(settled).toBeUndefined();
    turns = [turn("q", "completed")];
    await act(async () => rerender());
    expect(settled).toEqual({ requestId: "q", suspended: false, stopped: null });
  });

  it("is unconfirmed when the turn ended and the session never showed the line", async () => {
    vi.useFakeTimers();
    send.mockResolvedValue({ requestId: "q" });
    const { result, rerender } = renderHook(() => useDeliverLine());
    let failed: unknown;
    await act(async () => {
      void result.current({ sessionId: "s1" }, "hello").catch((error: unknown) => (failed = error));
    });
    turns = [turn("q", "completed")];
    await act(async () => rerender());
    expect(failed).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(HOLD_GRACE_MS + 1_000));
    expect(failed).toBeInstanceOf(TurnNotDelivered);
    expect((failed as TurnNotDelivered).kind).toBe("unconfirmed");
  });

  it("reads the session once when the turn ended ahead of the feed, and is delivered on what it holds", async () => {
    send.mockResolvedValue({ requestId: "q" });
    const state = vi.fn(async () => ({ items: [line("q")], pagination: { total: 1 } }));
    const was = lab.client.sessions.state;
    lab.client.sessions.state = state as never;
    try {
      const { result, rerender } = renderHook(() => useDeliverLine());
      let settled: unknown;
      await act(async () => {
        void result.current({ sessionId: "s1" }, "hello").then((v) => (settled = v));
      });
      turns = [turn("q", "completed")];
      await act(async () => rerender());
      await act(async () => {});
      expect(state).toHaveBeenCalledTimes(1);
      expect(settled).toEqual({ requestId: "q", suspended: false, stopped: null });
    } finally {
      lab.client.sessions.state = was;
    }
  });

  it("is not sent, safe to send again, when the server refused the send itself", async () => {
    send.mockRejectedValue(new Error("Request failed (503)"));
    const { result } = renderHook(() => useDeliverLine());
    await expect(result.current({ sessionId: "s1" }, "hello")).rejects.toMatchObject({ kind: "not-sent" });
  });
});

describe("a send the hook can't follow to its end", () => {
  beforeEach(() => {
    send.mockReset();
    feed = { items: [], state: "live", error: null };
    turns = [];
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  // Gitar 4617730693: the check reads one session at a time, so a second send while one is in flight is refused,
  // safe to send again, and the first is still judged against its own session.
  it("refuses a second send while one is in flight, and settles the first on its own session", async () => {
    send.mockResolvedValueOnce({ requestId: "q1" }).mockResolvedValueOnce({ requestId: "q2" });
    const { result, rerender } = renderHook(() => useDeliverLine());
    let first: unknown;
    await act(async () => {
      void result.current({ sessionId: "s1" }, "one").then((v) => (first = v));
    });
    await expect(result.current({ sessionId: "s2" }, "two")).rejects.toMatchObject({ kind: "not-sent" });
    expect(send).toHaveBeenCalledTimes(1);
    feed = { items: [line("q1")], state: "live", error: null };
    turns = [turn("q1", "completed")];
    await act(async () => rerender());
    expect(first).toEqual({ requestId: "q1", suspended: false, stopped: null });
  });

  // Codex P1 4617770894: a composer that closes mid-send still hears how it ended, so a delivered line leaves the
  // stored draft and isn't offered again when the composer reopens.
  it("settles a send whose composer closed: a delivered line leaves the stored draft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    send.mockResolvedValue({ requestId: "q" });
    let ended = false;
    const requests = vi.fn(async () => [{ id: "q", status: ended ? "completed" : "in_progress" }]);
    const state = vi.fn(async () => ({ items: ended ? [line("q")] : [], pagination: { total: ended ? 1 : 0 } }));
    Object.assign(lab.client.sessions, { requests, state });
    function Box() {
      const deliver = useDeliverLine();
      return <TurnComposer testId="t" label="Message" placeholder="" blocked={null} draftKey="conversation:w" send={(message, held, attachments) => deliver({ sessionId: "s1" }, message, { onHeld: held, attachments })} />;
    }
    const first = render(<Box />);
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "the line" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(send).toHaveBeenCalledTimes(1);
    first.unmount();
    ended = true;
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    render(<Box />);
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  // Greptile 4621742247: a composer that closes while the send itself is still out has nothing pending yet;
  // the late answer must still be followed to its end, or the delivered line stays in the stored draft.
  it("settles a send whose composer closed before the server answered it: a delivered line leaves the stored draft", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer!: (sent: { requestId: string }) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    let ended = false;
    const requests = vi.fn(async () => [{ id: "q", status: ended ? "completed" : "in_progress" }]);
    const state = vi.fn(async () => ({ items: ended ? [line("q")] : [], pagination: { total: ended ? 1 : 0 } }));
    Object.assign(lab.client.sessions, { requests, state });
    function Box() {
      const deliver = useDeliverLine();
      return <TurnComposer testId="t" label="Message" placeholder="" blocked={null} draftKey="conversation:late" send={(message, held, attachments) => deliver({ sessionId: "s1" }, message, { onHeld: held, attachments })} />;
    }
    const first = render(<Box />);
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "the line" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();
    ended = true;
    await act(async () => answer({ requestId: "q" }));
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    render(<Box />);
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  // Greptile 4621742289: a turn's replies can fill more than the newest page. The read-back goes on to the
  // page that holds the user's line, not the first page holding any of the turn's items.
  it("confirms a turn whose replies fill more than a page after its line", async () => {
    send.mockResolvedValue({ requestId: "q" });
    const session = [
      line("p"),
      reply("p"),
      line("q"),
      ...Array.from({ length: 250 }, (_, i) => ({ ...reply("q"), id: `a-q-${i}` })),
    ];
    const state = vi.fn(async (_id: string, at: { offset: number; limit: number }) => ({
      items: session.slice(at.offset, at.offset + at.limit),
      pagination: { total: session.length },
    }));
    Object.assign(lab.client.sessions, { state });
    const { result, rerender } = renderHook(() => useDeliverLine());
    let settled: unknown;
    let failed: unknown;
    await act(async () => {
      void result.current({ sessionId: "s1" }, "hello").then(
        (v) => (settled = v),
        (e: unknown) => (failed = e),
      );
    });
    turns = [turn("q", "completed")];
    await act(async () => rerender());
    await act(async () => {});
    await act(async () => {});
    expect(failed).toBeUndefined();
    expect(settled).toEqual({ requestId: "q", suspended: false, stopped: null });
  });
});
