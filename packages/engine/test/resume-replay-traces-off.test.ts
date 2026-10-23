/**
 * Observability off (production) still replays a finished step from its
 * `block_trace`. This loop stops twice; each pass runs once, and the kept
 * record has no input, prompt, or resource-load payload.
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

function buildFlow(): FlowInstance {
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
      return { asked: pass <= 2 ? `question ${pass}` : null };
    },
  });
  const ask = handler({
    name: "ask",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { asked: string | null }, ctx) => {
      if (input.asked === null) return ctx.sequencer!.state;
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
  return defineFlow({
    kind: "replay-traces-off",
    actions: {
      run: {
        inputSchema: z.any(),
        block: sequencer({ name: "loop", durable: true, stateSchema })
          .step(work)
          .step(ask)
          .loopBack("work", { when: (v: { again?: boolean }) => v?.again === true, maxIterations: 4 }),
      },
    },
  })({ id: "replay-traces-off" });
}

async function driveTwoAnswers() {
  runs.length = 0;
  const flow = buildFlow();
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
  await answer("A1");
  const afterFirst = [...runs];
  const second = await answer("A2");
  const record = await stores.request.get(requestId);
  return { afterStart, afterFirst, second, afterSecond: [...runs], record };
}

describe("resume replay with trace observability off", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("never runs a completed step again, and the kept record has no observability payload", async () => {
    const r = await driveTwoAnswers();

    expect(r.afterStart).toEqual(["pass 1: brief"]);
    expect(r.afterFirst).toEqual(["pass 1: brief", "pass 2: answer: A1"]);
    expect(r.second.suspension.message).toBe("question 2");
    expect(r.afterSecond).toEqual(["pass 1: brief", "pass 2: answer: A1", "pass 3: answer: A2"]);
    expect(r.record?.status).toBe("completed");
    expect(r.second.output).toMatchObject({ pass: 3, answers: ["A1", "A2"] });

    const traces = (r.record?.items ?? []).filter((i) => i.type === "block_trace") as BlockTraceItem[];
    expect(traces.length).toBeGreaterThan(0);
    for (const trace of traces) {
      expect(trace.status).toBe("completed");
      expect(trace.output).toBeDefined();
      expect(trace.input).toBeUndefined();
      expect(trace.generator).toBeUndefined();
      expect(trace.resourceLoads).toBeUndefined();
      expect(trace.declaredResources).toBeUndefined();
    }
  });
});
