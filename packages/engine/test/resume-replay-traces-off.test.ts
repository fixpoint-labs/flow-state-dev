/**
 * Resume replay with trace observability off (the production default).
 *
 * A resumed request skips every block that already completed by replaying the
 * block's recorded `block_trace` output. Those records must exist whatever the
 * observability setting: with it off, a resume would otherwise run every
 * finished step's side effects again (and append to state twice). These tests
 * drive a durable sequencer that runs a side effect, stops for a person, and
 * loops back with the answer, with observability forced off, and check that
 * each pass runs exactly once and that the record kept for replay carries no
 * observability payload (inputs, prompts).
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

/** Real executions of the side-effecting step, counted outside every store. */
const runs: string[] = [];

function buildFlow(kind: string): FlowInstance {
  const stateSchema = z.object({
    pass: z.number().default(0),
    answers: z.array(z.string()).default([]),
  });
  const work = handler({
    name: "work",
    inputSchema: z.any(),
    outputSchema: z.object({ asked: z.string().nullable() }),
    execute: async (input: { prompt?: string } | undefined, ctx) => {
      const pass = ((ctx.sequencer!.state as { pass: number }).pass ?? 0) + 1;
      ctx.sequencer!.patchState({ pass });
      runs.push(`pass ${pass}: ${input?.prompt ?? "brief"}`);
      // Passes 1 and 2 each ask a question; pass 3 finishes.
      return { asked: pass <= 2 ? `question ${pass}` : null };
    },
  });
  const ask = handler({
    name: "ask",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { asked: string | null }, ctx) => {
      if (input.asked === null) return { done: true };
      const answer = (await ctx.suspend!({
        reason: "human_input",
        message: input.asked,
        allow: ["submit"],
      })) as string;
      const prior = (ctx.sequencer!.state as { answers: string[] }).answers ?? [];
      ctx.sequencer!.patchState({ answers: [...prior, answer] });
      return { again: true, prompt: `answer: ${answer}` };
    },
  });
  const report = handler({
    name: "report",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_input, ctx) => ctx.sequencer!.state,
  });
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.any(),
        block: sequencer({ name: "loop", durable: true, stateSchema })
          .step(work)
          .step(ask)
          .loopBack("work", { when: (v: { again?: boolean }) => v?.again === true, maxIterations: 4 })
          .step(report),
      },
    },
  })({ id: kind });
}

async function driveTwoAnswers(kind: string) {
  runs.length = 0;
  const flow = buildFlow(kind);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const started = (await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    orgId: DEFAULT_ORG_ID,
    stores,
    runtimeConfig: { durabilityProvider: provider },
  } as never)) as { requestId: string; finished?: Promise<unknown> };
  const requestId = started.requestId;
  await started.finished;

  const answer = async (data: string) => {
    const pending = await provider.listSuspended({ status: "pending" });
    expect(pending).toHaveLength(1);
    const suspension = pending[0]!;
    await provider.suspend({ ...suspension, status: "submitted", resolvedAt: Date.now(), resumeData: data });
    const { finished } = (await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension.suspensionId, action: "submit", data, resumedBy: "alice" },
      runtimeConfig: { durabilityProvider: provider },
    } as never)) as { finished: Promise<{ output: unknown }> };
    return { suspension, output: (await finished).output };
  };

  const afterStart = [...runs];
  const first = await answer("A1");
  const afterFirst = [...runs];
  const second = await answer("A2");
  const record = await stores.request.get(requestId);
  return { afterStart, first, afterFirst, second, afterSecond: [...runs], record };
}

describe("resume replay with trace observability off", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("never runs a completed step again across two answers", async () => {
    const r = await driveTwoAnswers("replay-traces-off");

    expect(r.afterStart).toEqual(["pass 1: brief"]);
    // Answering resumes without running pass 1 again, and pass 2's own
    // question is a new stop, not answered by the first answer.
    expect(r.afterFirst).toEqual(["pass 1: brief", "pass 2: answer: A1"]);
    expect(r.second.suspension.message).toBe("question 2");
    expect(r.afterSecond).toEqual(["pass 1: brief", "pass 2: answer: A1", "pass 3: answer: A2"]);
    // State a step appends to is not appended twice by a replayed step.
    expect(r.record?.status).toBe("completed");
    expect(r.second.output).toMatchObject({ pass: 3, answers: ["A1", "A2"] });
  });

  it("keeps only identity and output on the record replay reads", async () => {
    const r = await driveTwoAnswers("replay-traces-off-lean");
    const traces = (r.record?.items ?? []).filter((i) => i.type === "block_trace") as BlockTraceItem[];

    expect(traces.length).toBeGreaterThan(0);
    for (const trace of traces) {
      // Only completed blocks are recorded: a suspended or failed block has
      // no output to replay.
      expect(trace.status).toBe("completed");
      expect(trace.output).toBeDefined();
      // Observability payload stays off in production.
      expect(trace.input).toBeUndefined();
      expect(trace.generator).toBeUndefined();
      expect(trace.resourceLoads).toBeUndefined();
      expect(trace.declaredResources).toBeUndefined();
    }
  });
});
