/**
 * `dispatcher()` — the block that sends one message to one declared entry.
 *
 * Pins the two halves of the factory: what it puts on the definition (the
 * static address `defineFlow` verifies and a board reads), and what its body
 * does at run time (compute the session and payload, put the envelope through
 * the seam, return the handle, refuse by name).
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { dispatcher, handler } from "../src";
import {
  DISPATCH_SEAM,
  DispatchRefusedError,
  NoDispatchSeamError,
  type DispatchOutcome,
  type DispatchSeam,
  type DispatchSpec
} from "../src/types/dispatch";
import { createMockContext, runForTest } from "./helpers";

const accepted: DispatchOutcome = {
  ok: true,
  sessionId: "dsx_child",
  requestId: "req_child",
  adopted: false
};

function seamRecording(outcome: DispatchOutcome = accepted) {
  const calls: DispatchSpec[] = [];
  const seam: DispatchSeam = vi.fn(async (spec: DispatchSpec) => {
    calls.push(spec);
    return outcome;
  });
  return { seam, calls, ctx: createMockContext({ [DISPATCH_SEAM]: seam }) };
}

describe("dispatcher — the definition", () => {
  it("is a handler that carries its address", () => {
    const block = dispatcher({
      name: "wake-epic",
      type: "internal",
      target: "wake",
      session: { id: () => "s_epic" }
    });
    expect(block.kind).toBe("handler");
    expect(block.dispatch).toEqual({ type: "internal", target: "wake" });
  });

  it("keeps the address across connectInput and rescue rebuilds", () => {
    const block = dispatcher({
      name: "wake-epic",
      type: "internal",
      target: "wake",
      inputSchema: z.object({ id: z.string() }),
      session: { id: (input) => input.id }
    });
    const connected = block.connectInput<{ epic: string }>((from) => ({ id: from.epic }));
    expect(connected.dispatch).toEqual({ type: "internal", target: "wake" });

    const rescued = block.rescue([
      { block: handler({ name: "swallow", inputSchema: z.unknown(), execute: () => null }) }
    ]);
    expect(rescued.dispatch).toEqual({ type: "internal", target: "wake" });
  });

  it("refuses an empty target at construction", () => {
    expect(() =>
      dispatcher({ name: "blank", type: "internal", target: "", session: { key: () => "k" } })
    ).toThrow(/non-empty target/);
  });

  it("is a task seat when its type is task, carrying the session policy on its address", () => {
    const seat = dispatcher({
      name: "hand-off-implement",
      type: "task",
      target: "implement",
      session: "per-task"
    });
    expect(seat.kind).toBe("handler");
    expect(seat.dispatch).toEqual({ type: "task", target: "implement", session: "per-task" });
  });

  it("refuses a task seat with no session policy, by name", () => {
    expect(() =>
      dispatcher({ name: "no-policy", type: "task", target: "implement", session: undefined as never })
    ).toThrow(/task session policy/);
  });

  it("refuses a type a block cannot supply the trust for", () => {
    expect(() =>
      dispatcher({
        name: "forged",
        type: "webhook" as unknown as "internal",
        target: "github/push",
        session: { key: () => "k" }
      })
    ).toThrow(/cannot supply the trust/);
  });
});

describe("dispatcher — the body", () => {
  it("derives a child from the key policy and hands the input through as the payload", async () => {
    const { calls, ctx } = seamRecording();
    const block = dispatcher({
      name: "run-in-background",
      type: "internal",
      target: "analyze",
      inputSchema: z.object({ documentId: z.string() }),
      session: { key: (input) => `doc:${input.documentId}` }
    });

    const handle = await runForTest(block, { documentId: "d1" }, ctx);

    expect(handle).toEqual({ sessionId: "dsx_child", requestId: "req_child", adopted: false });
    expect(calls).toEqual([
      {
        type: "internal",
        target: "analyze",
        session: { key: "doc:d1" },
        payload: { documentId: "d1" },
        from: "run-in-background"
      }
    ]);
  });

  it("delivers into an existing session from the id policy, with a computed payload", async () => {
    const { calls, ctx } = seamRecording({ ...accepted, adopted: true });
    const block = dispatcher({
      name: "wake-epic",
      type: "internal",
      target: "wake",
      inputSchema: z.object({ epicSessionId: z.string(), reason: z.string() }),
      session: { id: (input) => input.epicSessionId },
      payload: (input) => ({ reason: input.reason })
    });

    const handle = await runForTest(block, { epicSessionId: "s_epic", reason: "answered" }, ctx);

    expect(handle.adopted).toBe(true);
    expect(calls[0]?.session).toEqual({ id: "s_epic" });
    expect(calls[0]?.payload).toEqual({ reason: "answered" });
  });

  it("throws DispatchRefusedError, by name, when the seam refuses", async () => {
    const { ctx } = seamRecording({
      ok: false,
      refused: "session-not-found",
      detail: "no session s_gone"
    });
    const block = dispatcher({
      name: "wake-epic",
      type: "internal",
      target: "wake",
      session: { id: () => "s_gone" }
    });

    const error = await runForTest(block, {}, ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DispatchRefusedError);
    const refused = error as DispatchRefusedError;
    expect(refused.refused).toBe("session-not-found");
    expect(refused.address).toEqual({ type: "internal", target: "wake" });
    expect(refused.blockName).toBe("wake-epic");
  });

  it("throws NoDispatchSeamError when no runtime wired the seam", async () => {
    const block = dispatcher({
      name: "wake-epic",
      type: "internal",
      target: "wake",
      session: { id: () => "s_epic" }
    });
    await expect(runForTest(block, {}, createMockContext())).rejects.toBeInstanceOf(
      NoDispatchSeamError
    );
  });

  it("sends a task envelope under the key its policy derives, with the row as provenance", async () => {
    const { calls, ctx } = seamRecording();
    const envelope = {
      boardId: "issue-work",
      seat: "implement",
      taskId: "t1",
      attempt: 1,
      createdAt: 1_700_000_000_000,
      payload: { taskId: "t1", goal: "do it", attempts: 1, metadata: { topic: "FIX-1" } }
    };

    const perTask = dispatcher({ name: "per-task", type: "task", target: "implement", session: "per-task" });
    await runForTest(perTask, envelope, ctx);
    expect(calls[0]).toEqual({
      type: "task",
      target: "implement",
      session: { key: "task|10:issue-work|2:t1" },
      payload: envelope,
      from: "per-task",
      provenance: { taskId: "t1" }
    });

    const perWorker = dispatcher({ name: "per-worker", type: "task", target: "implement", session: "per-worker" });
    await runForTest(perWorker, envelope, ctx);
    expect(calls[1]?.session).toEqual({ key: "worker|10:issue-work|9:implement" });

    const byTopic = dispatcher({
      name: "by-topic",
      type: "task",
      target: "implement",
      session: { key: (task: { metadata?: { topic?: string } }) => task.metadata?.topic ?? "" }
    });
    await runForTest(byTopic, envelope, ctx);
    expect(calls[2]?.session).toEqual({ key: "FIX-1" });
  });

  it("refuses an empty computed session key, naming the block", async () => {
    const { calls, ctx } = seamRecording();
    const block = dispatcher({
      name: "run-in-background",
      type: "internal",
      target: "analyze",
      session: { key: () => "" }
    });
    await expect(runForTest(block, {}, ctx)).rejects.toThrow(
      /"run-in-background" computed an empty session key/
    );
    expect(calls).toHaveLength(0);
  });
});
