// @vitest-environment happy-dom
// BR-4; FIX-2776 D2.
/**
 * What the composer tells the user after Send: *delivered* only once the
 * session holds the line, read live from the session's feed and workforce's
 * session turns view. A turn that ended without the line in the session is
 * not delivered, and a lost answer never reads as a failure that invites a
 * second send.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
let feed: { items: unknown[] | undefined; state: string; error: Error | null } | undefined;
let turns: Array<{ id: string; status: string; error: { code: string; message: string } | null }> | undefined;
// The session's own read, when a turn ends ahead of the feed: it holds nothing from these requests.
const lab = { client: { userId: "u_1", sessions: { state: async () => ({ items: [], pagination: { total: 0 } }) } } };
const workforce = { send };
vi.mock("../src/lib/lab-data", () => ({ useLab: () => lab }));
vi.mock("../src/lib/workforce", () => ({ useWorkforce: () => workforce }));
vi.mock("../src/lib/session-feeds", () => ({ useSharedSessionFeed: (id: string | null) => (id === null ? undefined : feed) }));
vi.mock("@flow-state-dev/react", async (original) => ({
  ...(await original<typeof import("@flow-state-dev/react")>()),
  useView: (_ref: unknown, _input: unknown, options: { enabled?: boolean }) => ({ value: options.enabled === false ? undefined : turns, stale: false }),
}));

import { deliveryOf, HOLD_GRACE_MS, TurnNotDelivered, useDeliverLine } from "../src/lib/deliver";

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
