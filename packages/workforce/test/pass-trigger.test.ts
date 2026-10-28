/**
 * When a trigger of the conversation's pass is sent, and when it is skipped
 * (FIX-2078). A burst of filings must not line up a pass each; a write that
 * lands after the pass read the board must still get one; a touch is skipped
 * while a pass runs; and nothing is skipped on a host whose passes run in
 * another process, or skipped for good on a host with no wakes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DISPATCH_SEAM } from "@flow-state-dev/core/types";
import { notePassEnded, notePassStarted, triggerPass } from "../src/conversation-board/board";

let next = 0;

/** A request in one session, counting the passes it sends. */
function session(options: { runsHere?: boolean; wakes?: boolean } = {}) {
  const sessionId = `s-${(next += 1)}`;
  const sent: unknown[] = [];
  const owed: number[] = [];
  const ctx = {
    session: { identity: { id: sessionId } },
    requestHost: {
      ...(options.runsHere === false ? {} : { dispatchRunsHere: true }),
      ...(options.wakes === false
        ? {}
        : {
            wakes: {
              maxDebtAgeMs: 86_400_000,
              owe: async (spec: { dueAt: number }) => {
                owed.push(spec.dueAt);
                return true;
              }
            }
          })
    },
    [DISPATCH_SEAM]: async (spec: unknown) => {
      sent.push(spec);
      return { ok: true, sessionId, requestId: `r${sent.length}`, adopted: false };
    }
  };
  return { ctx: ctx as never, sent, owed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the conversation's pass trigger", () => {
  it("sends one pass for a burst of filings while it waits to start, and each still owes the wake", async () => {
    const { ctx, sent, owed } = session();
    for (let i = 0; i < 5; i += 1) await triggerPass(ctx);
    expect(sent).toHaveLength(1);
    expect(owed).toHaveLength(5);
  });

  it("sends again for a write that lands after the pass started, which may have read the board before it", async () => {
    const { ctx, sent } = session();
    await triggerPass(ctx);
    notePassStarted(ctx);
    await triggerPass(ctx);
    expect(sent).toHaveLength(2);
  });

  it("skips a touch while a pass runs, and sends one once it ended", async () => {
    const { ctx, sent } = session();
    await triggerPass(ctx);
    notePassStarted(ctx);
    await triggerPass(ctx, { touch: true });
    expect(sent).toHaveLength(1);
    notePassEnded(ctx);
    await triggerPass(ctx, { touch: true });
    expect(sent).toHaveLength(2);
  });

  it("skips nothing where the pass runs in another process, which this one never sees start", async () => {
    const { ctx, sent } = session({ runsHere: false });
    for (let i = 0; i < 3; i += 1) await triggerPass(ctx);
    await triggerPass(ctx, { touch: true });
    expect(sent).toHaveLength(4);
  });

  it("sends again on a host with no wakes when the pass a write was skipped behind never starts", async () => {
    vi.useFakeTimers();
    const { ctx, sent } = session({ wakes: false });
    await triggerPass(ctx);
    await triggerPass(ctx);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(2);
  });

  it("sends again at once on a host with no wakes when the send a write was skipped behind fails", async () => {
    const { ctx, sent } = session({ wakes: false });
    let release!: (outcome: unknown) => void;
    let calls = 0;
    (ctx as Record<symbol, unknown>)[DISPATCH_SEAM] = (spec: unknown) => {
      sent.push(spec);
      calls += 1;
      // The first send is refused, after a write was skipped behind it.
      if (calls === 1) return new Promise((resolve) => (release = resolve));
      return Promise.resolve({ ok: true, sessionId: "s", requestId: `r${calls}`, adopted: false });
    };
    const first = triggerPass(ctx);
    await Promise.resolve();
    await triggerPass(ctx);
    expect(sent).toHaveLength(1);
    release({ ok: false, refused: "busy", detail: "refused" });
    await first;
    expect(sent).toHaveLength(2);
  });

  it("schedules no backstop on a host that keeps wakes: the wake each write owed pays it", async () => {
    vi.useFakeTimers();
    const { ctx, sent, owed } = session();
    await triggerPass(ctx);
    await triggerPass(ctx);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(owed).toHaveLength(2);
  });

  it("sends nothing more when that pass did start", async () => {
    vi.useFakeTimers();
    const { ctx, sent } = session({ wakes: false });
    await triggerPass(ctx);
    await triggerPass(ctx);
    notePassStarted(ctx);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent).toHaveLength(1);
  });
});
