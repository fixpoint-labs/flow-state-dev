/**
 * A follow-up dispatched with `wait` keeps the follow-up's own id
 * (FIX-1817 BR-25 with FIX-1816's wait): the id a follow-up takes is what makes
 * "one unfinished task per session" one atomic write, so the wait path must
 * not replace it with one of its own. Two follow-ups of one task filed at
 * once, waiting or not, land one; the other is refused naming it.
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
      await board.addTask({ id: "root", goal: "the first job", assignee: "researcher" });
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
    resources: { [BOARD]: defineTaskCollection({ id: BOARD, scope: "session" }) },
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

const followUp = (id: string, wait: boolean) => ({
  toolCallId: id,
  toolName: "dispatchTask",
  args: { goal: `follow-up ${id}`, followUpOf: "root", ...(wait ? { wait: true } : {}) }
});
const calls =
  (...list: Array<ReturnType<typeof followUp>>): StepFn =>
  () => ({ toolCalls: list, finishReason: "tool-calls" });
const finalAnswer: StepFn = (opts) => ({ text: `final: ${toolResults(opts.messages)}`, finishReason: "stop" });

type Row = { id: string; followUpOf?: string; wait?: unknown };

describe("a waiting follow-up keeps its own id", () => {
  it("files a waiting follow-up under the follow-up's id, waited on", async () => {
    const { model } = stepModel([calls(followUp("w1", true)), finalAnswer]);
    const flow = flowOf(model);
    const state = runtimeFor(flow);
    try {
      await act(state, flow, "seed");
      await act(state, flow, "run");
      const rows = (await act(state, flow, "list")).output as Row[];
      const follow = rows.find((r) => r.followUpOf === "root");
      expect(follow).toMatchObject({ id: "root-f1" });
      expect(follow!.wait).toBeDefined();
    } finally {
      await state.dispose();
    }
  });

  it("of one waiting and one plain follow-up filed in one step, lands one and refuses the other naming it", async () => {
    const { model, seen } = stepModel([calls(followUp("w1", true), followUp("p1", false)), finalAnswer, finalAnswer]);
    const flow = flowOf(model);
    const state = runtimeFor(flow);
    try {
      await act(state, flow, "seed");
      await act(state, flow, "run");
      const rows = (await act(state, flow, "list")).output as Row[];
      expect(rows.filter((r) => r.followUpOf === "root")).toHaveLength(1);
      const results = seen.slice(1).map((s) => toolResults(s.messages)).join(" | ");
      expect(results).toContain('task_id_taken: another task took the id \\"root-f1\\"');
    } finally {
      await state.dispose();
    }
  });

  it("of two waiting follow-ups filed by two turns at once, lands one and refuses the other naming it", async () => {
    const { model, seen } = stepModel([calls(followUp("w1", true)), calls(followUp("w2", true)), finalAnswer, finalAnswer]);
    const flow = flowOf(model);
    const state = runtimeFor(flow);
    try {
      await act(state, flow, "seed");
      await Promise.all([act(state, flow, "run"), act(state, flow, "run")]);
      const rows = (await act(state, flow, "list")).output as Row[];
      expect(rows.filter((r) => r.followUpOf === "root")).toHaveLength(1);
      const results = seen.slice(2).map((s) => toolResults(s.messages)).join(" | ");
      expect(results).toContain('task_id_taken: another task took the id \\"root-f1\\"');
    } finally {
      await state.dispose();
    }
  });
});
