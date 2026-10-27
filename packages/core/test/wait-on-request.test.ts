/**
 * `waitOnRequest` (FIX-2239): the park half of a dispatcher's wait, for a
 * caller that waits on a request that already exists. It sends nothing, keeps
 * its plan under the caller's `runOnce` key so a replay parks on the same gate,
 * and takes a deadline in ms from now, the host's default when unset.
 */
import { describe, expect, it } from "vitest";
import { waitOnRequest } from "../src";
import type { WaitOutcome } from "../src/types/wait-gate";
import type { SuspendOptions } from "../src/errors/suspension-error";
import { createMockContext } from "./helpers";

function harness(outcome?: WaitOutcome, memo = new Map<string, unknown>()) {
  const parked: SuspendOptions[] = [];
  const stopped: string[] = [];
  const ctx = createMockContext({
    requestHost: {
      resumeWait: async () => ({ ok: true }),
      hasWaitSweeper: true,
      waits: { deadlines: { defaultMs: 300_000, minMs: 1_000, maxMs: 86_400_000 }, depth: async () => 1 }
    },
    runOnce: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      if (memo.has(key)) return memo.get(key) as T;
      const value = await fn();
      memo.set(key, value);
      return value;
    },
    suspend: async (options: SuspendOptions) => {
      parked.push(options);
      if (outcome === undefined) throw new Error("parked");
      return outcome;
    }
  } as never);
  Object.assign(ctx, { session: { ...(ctx as { session?: object }).session, stopRequest: async (id: string) => void stopped.push(id) } });
  return { ctx, parked, stopped, memo };
}

const input = { requestId: "req_reply", gateId: "call:msg_1", planKey: "fsd.call.wait:msg_1" };

describe("waitOnRequest", () => {
  it("parks on a gate bound to the request, with the caller's deadline, and outputs its result", async () => {
    const { ctx, parked } = harness({ answered: true, answer: { reply: "blue" } });
    const outcome = await waitOnRequest(ctx as never, { ...input, deadlineMs: 60_000 });
    expect(outcome).toEqual({ status: "completed", output: { reply: "blue" } });
    expect(parked[0]).toMatchObject({ reason: "wait", suspensionId: "call:msg_1", data: { requestId: "req_reply" } });
    // The caller's deadline wins over the host's 5-minute default.
    const deadline = (parked[0]!.data as { deadline: number }).deadline - Date.now();
    expect(deadline).toBeGreaterThan(55_000);
    expect(deadline).toBeLessThanOrEqual(60_000);
  });

  it("takes the host's default deadline when none is passed", async () => {
    const { ctx, parked } = harness({ answered: false, deadline: true });
    expect(await waitOnRequest(ctx as never, input)).toEqual({ status: "running" });
    expect((parked[0]!.data as { deadline: number }).deadline - Date.now()).toBeGreaterThan(290_000);
  });

  it("a replay parks on the same gate with the same deadline", async () => {
    const first = harness();
    await expect(waitOnRequest(first.ctx as never, { ...input, deadlineMs: 60_000 })).rejects.toThrow("parked");
    const replay = harness({ answered: true, answer: "ok" }, first.memo);
    await waitOnRequest(replay.ctx as never, { ...input, deadlineMs: 60_000 });
    expect(replay.parked[0]!.data).toEqual(first.parked[0]!.data);
  });

  it("a person's stop ends the waiting request and reads running: the waited-on request runs on", async () => {
    const { ctx, stopped } = harness({ answered: false, stopped: true } as WaitOutcome);
    expect(await waitOnRequest(ctx as never, input)).toEqual({ status: "running" });
    expect(stopped).toEqual([(ctx as { request: { identity: { id: string } } }).request.identity.id]);
  });

  it("outputs failed with the error when the request failed", async () => {
    const { ctx } = harness({ answered: false, error: { code: "wait_task_failed", message: "boom" } });
    expect(await waitOnRequest(ctx as never, input)).toEqual({ status: "failed", error: "boom" });
  });
});
