/**
 * A follow-up waited on keeps the follow-up's own id (FIX-1817 BR-25 with the
 * wait, `getTask` since FIX-2082): the id a follow-up takes is what makes "one
 * unfinished task per session" one atomic write. Filing and waiting are two
 * calls now, so the wait takes the row's slot and never files a row of its own.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  createTaskToolsCapability,
  defineTaskCollection,
  getOrCreateTaskCollection,
  resolveResourceCollection,
  ticketForClaim,
  type TaskCollectionRef
} from "../../src";
import { act, runtimeFor, stepModel, toolResults, type StepFn } from "./wait-fixture";
import { heard } from "../fixtures/heard";

const BOARD = "waits";

async function boardOf(ctx: BlockContext): Promise<TaskCollectionRef | undefined> {
  const collection = resolveResourceCollection(ctx, BOARD);
  if (collection === undefined) return undefined;
  return getOrCreateTaskCollection({ ctx, backing: "resource", collectionId: BOARD, collection });
}

/** A turn holding the task tools over a durable board, and a `seed` that files the finished root task. */
function flowOf(model: ReturnType<typeof stepModel>["model"]): FlowInstance {
  // The waits this flow files are its board's to resume, so it opts in.
  const tools = createTaskToolsCapability(boardOf, undefined, { resumesWaits: true, dispatches: true });
  const seed = handler({
    name: "seed",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => {
      const board = (await boardOf(ctx))!;
      await board.createTask({ id: "root", goal: "the first job", assignee: "researcher" });
      const claimed = (await board.claim("w"))!;
      const ticket = ticketForClaim(board.collectionId, claimed, board.partition);
      await board.linkRun("root", { sessionId: "s-root", requestId: "r-root", attempt: claimed.attempts }, { claim: ticket });
      await board.complete("root", "done", { claim: ticket });
      return null;
    }
  });
  const list = handler({
    name: "list",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => (await boardOf(ctx))!.list().map((t) => ({ id: t.id, followUpOf: t.followUpOf, wait: t.wait }))
  });
  return defineFlow({ internal: { actions: { ...heard } },
    kind: "wait-board",
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session", delivery: {} }) },
    actions: {
      run: {
        block: sequencer({ name: "turn" }).step(generator({ name: "agent", model, prompt: "p", uses: [tools] })),
        inputSchema: z.object({}).passthrough()
      },
      seed: { block: seed },
      list: { block: list }
    }
  })({ id: "wait-board" });
}

const call =
  (toolCallId: string, toolName: string, args: Record<string, unknown>): StepFn =>
  () => ({ toolCalls: [{ toolCallId, toolName, args }], finishReason: "tool-calls" });
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

type Row = { id: string; followUpOf?: string; wait?: { requestId?: string } };

describe("a follow-up waited on keeps its own id", () => {
  it("files the follow-up under its own id with createTask, and getTask's wait takes that row's slot", async () => {
    const { model, seen } = stepModel([
      call("f1", "createTask", { goal: "follow-up", followUpOf: "root" }),
      call("g1", "getTask", { id: "root-f1", wait: true }),
      finalAnswer
    ]);
    const flow = flowOf(model);
    const state = runtimeFor(flow);
    try {
      await act(state, flow, "seed");
      const parked = await act(state, flow, "run");
      expect(toolResults(seen[1]!.messages)).toContain('"taskId":"root-f1"');
      const rows = (await act(state, flow, "list")).output as Row[];
      const follow = rows.filter((r) => r.followUpOf === "root");
      expect(follow).toEqual([expect.objectContaining({ id: "root-f1" })]);
      expect(follow[0]!.wait?.requestId).toBe(parked.requestId);
    } finally {
      await state.dispose();
    }
  });
});
