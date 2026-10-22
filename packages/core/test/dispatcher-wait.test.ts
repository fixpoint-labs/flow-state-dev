/**
 * `dispatcher({ wait: true })` (FIX-2082): the dispatch is sent once, then the
 * request parks on the one wait gate, bound to the request it dispatched, and
 * the block's output is how that request ended: its output, its error, or
 * `running` at the deadline. Every refusal comes before anything is sent.
 *
 * The context is hand-built: the seam records what was sent, `runOnce` keeps
 * its memo across two runs of the block (a replay after the park), and the
 * gate's outcome is scripted.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatcher } from "../src";
import { DISPATCH_SEAM, type DispatchOutcome, type DispatchSeam, type DispatchSpec } from "../src/types/dispatch";
import { MAX_WAIT_DEPTH, type WaitOutcome } from "../src/types/wait-gate";
import type { SuspendOptions } from "../src/errors/suspension-error";
import { createMockContext, runForTest } from "./helpers";

const accepted: DispatchOutcome = { ok: true, sessionId: "dsx_child", requestId: "req_child", adopted: false };

type Script = { outcome?: WaitOutcome; depth?: number; waits?: false };

function harness(script: Script = {}, memo = new Map<string, unknown>()) {
  const sent: DispatchSpec[] = [];
  const parked: SuspendOptions[] = [];
  const seam: DispatchSeam = vi.fn(async (spec: DispatchSpec) => {
    sent.push(spec);
    return accepted;
  });
  const ctx = createMockContext({
    _blockIdentity: { blockName: "check-links", blockInstanceId: "req_1:root/step[0]:0" },
    [DISPATCH_SEAM]: seam,
    requestHost: {
      resumeWait: async () => ({ ok: true }),
      hasWaitSweeper: true,
      ...(script.waits === false
        ? {}
        : {
            waits: {
              deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 },
              depth: async () => script.depth ?? 1
            }
          })
    },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend: async (options: SuspendOptions) => {
      parked.push(options);
      if (script.outcome === undefined) throw new Error("parked");
      return script.outcome;
    }
  } as never);
  return { ctx, sent, parked, memo };
}

const checkLinks = () =>
  dispatcher({
    name: "check-links",
    action: "check",
    inputSchema: z.object({ docId: z.string() }),
    session: { key: (input) => input.docId },
    wait: true
  });

describe("dispatcher({ wait: true })", () => {
  it("outputs the child's output once it completes, sent once and parked on a gate bound to it", async () => {
    const { ctx, sent, parked } = harness({ outcome: { answered: true, answer: { broken: 0 } } });
    const result = await runForTest(checkLinks(), { docId: "d1" }, ctx);
    expect(result).toEqual({ status: "completed", output: { broken: 0 }, requestId: "req_child" });
    expect(sent).toHaveLength(1);
    // The seam is told the sender waits, so the child counts it before the park is written.
    expect(sent[0]!.waits).toBe(true);
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ reason: "wait", suspensionId: "dispatch:req_child", data: { requestId: "req_child" } });
    // The deadline is the host's default, from when the wait was planned.
    const deadline = (parked[0]!.data as { deadline: number }).deadline;
    expect(deadline - Date.now()).toBeGreaterThan(290_000);
  });

  it("a replay after the park sends nothing again and parks on the same gate", async () => {
    const first = harness();
    await expect(runForTest(checkLinks(), { docId: "d1" }, first.ctx)).rejects.toThrow("parked");
    const replay = harness({ outcome: { answered: true, answer: "ok" } }, first.memo);
    await runForTest(checkLinks(), { docId: "d1" }, replay.ctx);
    expect(first.sent).toHaveLength(1);
    expect(replay.sent).toEqual([]);
    expect(replay.parked[0]!.suspensionId).toBe(first.parked[0]!.suspensionId);
    expect(replay.parked[0]!.data).toEqual(first.parked[0]!.data);
  });

  it("a retry of the block after the send sends nothing again: the dispatch is kept by the block's logical id, not its attempt", async () => {
    const at = (attempt: number) => ({ blockName: "check-links", blockInstanceId: `req_1:root/step[0]:${attempt}` });
    const first = harness();
    Object.assign(first.ctx, { _blockIdentity: at(0) });
    await expect(runForTest(checkLinks(), { docId: "d1" }, first.ctx)).rejects.toThrow("parked");
    const retry = harness({ outcome: { answered: true, answer: "ok" } }, first.memo);
    Object.assign(retry.ctx, { _blockIdentity: at(1) });
    expect(await runForTest(checkLinks(), { docId: "d1" }, retry.ctx)).toMatchObject({ status: "completed", requestId: "req_child" });
    expect(first.sent).toHaveLength(1);
    expect(retry.sent).toEqual([]);
    expect(retry.parked[0]!.suspensionId).toBe(first.parked[0]!.suspensionId);
  });

  it("at the deadline outputs running, with the request to find it by: nothing is stopped", async () => {
    const { ctx } = harness({ outcome: { answered: false, deadline: true } });
    expect(await runForTest(checkLinks(), { docId: "d1" }, ctx)).toEqual({ status: "running", requestId: "req_child" });
  });

  it("outputs failed, with the error, when the child failed", async () => {
    const { ctx } = harness({
      outcome: { answered: false, error: { code: "wait_task_failed", message: "the checker crashed" } }
    });
    expect(await runForTest(checkLinks(), { docId: "d1" }, ctx)).toEqual({
      status: "failed",
      error: "the checker crashed",
      requestId: "req_child"
    });
  });

  it(`refuses a wait past ${MAX_WAIT_DEPTH} deep before sending anything`, async () => {
    const { ctx, sent } = harness({ depth: MAX_WAIT_DEPTH + 1 });
    await expect(runForTest(checkLinks(), { docId: "d1" }, ctx)).rejects.toThrow(/wait_too_deep/);
    expect(sent).toEqual([]);
  });

  it("refuses a wait on a host that can't hold one, before sending anything", async () => {
    const { ctx, sent } = harness({ waits: false });
    await expect(runForTest(checkLinks(), { docId: "d1" }, ctx)).rejects.toThrow(/wait_unavailable/);
    expect(sent).toEqual([]);
  });

  it("refuses a wait in a block with no identity to keep its dispatch under, before sending anything", async () => {
    // Keyed by anything less, two passes of a loop, or two dispatchers of one name, would share one send.
    for (const identity of [undefined, { blockName: "check-links", blockInstanceId: "opaque" }]) {
      const { ctx, sent } = harness();
      Object.assign(ctx, { _blockIdentity: identity });
      await expect(runForTest(checkLinks(), { docId: "d1" }, ctx)).rejects.toThrow(/wait_unavailable: this block has no identity/);
      expect(sent).toEqual([]);
    }
  });

  it("without wait, returns the handle and parks on nothing", async () => {
    const { ctx, parked, sent } = harness();
    const block = dispatcher({
      name: "check-links",
      action: "check",
      inputSchema: z.object({ docId: z.string() }),
      session: { key: (input) => input.docId }
    });
    expect(await runForTest(block, { docId: "d1" }, ctx)).toEqual({ sessionId: "dsx_child", requestId: "req_child", adopted: false });
    expect(parked).toEqual([]);
    expect(sent[0]!.waits).toBeUndefined();
  });
});
