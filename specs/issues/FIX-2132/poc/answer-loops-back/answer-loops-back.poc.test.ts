/**
 * POC for FIX-2132 — retained design evidence, not production code.
 *
 * The question: the harness manager is a durable sequencer whose steps run a
 * coding run (a side effect we must never repeat), then decide, then loop back
 * to the run step for another step. FIX-2132 puts a person's stop (today
 * `ctx.suspend`, after FIX-2129 `ctx.waitForUser`) in a step AFTER the run
 * step, and loops back to the run step with the answer. That only works if:
 *
 *   1. resuming the request does NOT run the completed run step again;
 *   2. the run step's second pass (after loopBack) DOES run, once;
 *   3. a second stop in the second pass suspends anew: it is not answered by
 *      the first stop's recorded answer when the request replays;
 *   4. all of that holds with trace observability off, as in production
 *      (`NODE_ENV=production`), because replay of completed blocks reads the
 *      retained block_trace output (docs/architecture/execution-and-errors.md).
 *
 * Shape mirrors `harness-manager/src/manager.ts`: run → ask → loopBack(run).
 * Run with `bash specs/issues/FIX-2132/poc/answer-loops-back/run.sh`.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";

/** Counts real executions of the "coding run", outside every store. */
const runs: string[] = [];

function buildFlow(kind: string, guarded = false): FlowInstance {
  const stateSchema = z.object({ pass: z.number().default(0), answers: z.array(z.string()).default([]) });
  const codingRun = handler({
    name: "coding-run",
    inputSchema: z.any(),
    outputSchema: z.object({ asked: z.string().nullable() }),
    execute: async (input: { prompt?: string } | undefined, ctx) => {
      const pass = ((ctx.sequencer!.state as { pass: number }).pass ?? 0) + 1;
      ctx.sequencer!.patchState({ pass });
      // The side effect: the coding run itself. Guarded, it runs once per
      // (request, pass), and a replay reads its recorded result.
      const work = async () => {
        runs.push(`pass ${pass}: ${input?.prompt ?? "brief"}`);
        // Pass 1 and pass 2 each ask; pass 3 finishes.
        return { asked: pass <= 2 ? `question ${pass}` : null };
      };
      return guarded ? ctx.runOnce!(`coding-run:${pass}`, work) : work();
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
        block: sequencer({ name: "manager", durable: true, stateSchema })
          .step(codingRun)
          .step(ask)
          .loopBack("coding-run", { when: (v: { again?: boolean }) => v?.again === true, maxIterations: 4 })
          .step(report),
      },
    },
  })({ id: kind });
}

async function drive(kind: string, guarded = false) {
  runs.length = 0;
  const flow = buildFlow(kind, guarded);
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const started = await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    orgId: DEFAULT_ORG_ID,
    stores,
    runtimeConfig: { durabilityProvider: provider },
  } as never);
  const requestId = (started as { requestId: string }).requestId;
  await (started as { finished?: Promise<unknown> }).finished;

  const answerPending = async (answer: string): Promise<{ suspension: SuspensionRecord; output: unknown }> => {
    const pending = await provider.listSuspended({ status: "pending" });
    expect(pending).toHaveLength(1);
    const suspension = pending[0]!;
    await provider.suspend({ ...suspension, status: "submitted", resolvedAt: Date.now(), resumeData: answer });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension.suspensionId, action: "submit", data: answer, resumedBy: "alice" },
      runtimeConfig: { durabilityProvider: provider },
    } as never);
    const result = (await finished) as { output: unknown };
    return { suspension, output: result.output };
  };

  const afterStart = { status: (await stores.request.get(requestId))?.status, runs: [...runs] };
  const first = await answerPending("A1");
  const afterFirst = { status: (await stores.request.get(requestId))?.status, runs: [...runs] };
  const second = await answerPending("A2");
  const afterSecond = { status: (await stores.request.get(requestId))?.status, runs: [...runs] };
  return { afterStart, first, afterFirst, second, afterSecond };
}

function assertShape(r: Awaited<ReturnType<typeof drive>>) {
  // Premise 1: the first stop suspends after exactly one coding run.
  expect(r.afterStart.status).toBe("suspended");
  expect(r.afterStart.runs).toEqual(["pass 1: brief"]);
  // Premises 1-3: answering resumes WITHOUT re-running pass 1, runs pass 2 once
  // with the answer, and pass 2's own question suspends anew.
  expect(r.afterFirst.status).toBe("suspended");
  expect(r.afterFirst.runs).toEqual(["pass 1: brief", "pass 2: answer: A1"]);
  expect(r.second.suspension.message).toBe("question 2");
  // The second answer finishes the request, still with no repeated run.
  expect(r.afterSecond.status).toBe("completed");
  expect(r.afterSecond.runs).toEqual(["pass 1: brief", "pass 2: answer: A1", "pass 3: answer: A2"]);
  expect(r.second.output).toMatchObject({ pass: 3, answers: ["A1", "A2"] });
}

async function withTraces<T>(on: boolean, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FSDEV_TRACE_OBSERVABILITY;
  process.env.FSDEV_TRACE_OBSERVABILITY = on ? "1" : "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.FSDEV_TRACE_OBSERVABILITY;
    else process.env.FSDEV_TRACE_OBSERVABILITY = prev;
  }
}

describe("FIX-2132 POC · a person's stop after the run step, looping back with the answer", () => {
  it("traces ON (dev, the default in tests): the shape holds unguarded", async () => {
    const r = await withTraces(true, () => drive("fix2132-poc-on"));
    console.log("[on, unguarded]", JSON.stringify({ runs: r.afterSecond.runs, output: r.second.output }));
    assertShape(r);
  });

  it("traces OFF (production): unguarded, every answer runs the completed coding runs again", async () => {
    // A characterization, not the wanted shape: this is what the manager
    // would do in production if it relied on replay alone.
    const r = await withTraces(false, () => drive("fix2132-poc-off"));
    console.log("[off, unguarded]", JSON.stringify({ runs: r.afterSecond.runs, output: r.second.output }));
    expect(r.afterSecond.status).toBe("completed");
    expect(r.afterSecond.runs.length).toBeGreaterThan(3);
    expect(r.afterSecond.runs.filter((x) => x === "pass 1: brief").length).toBeGreaterThan(1);
  });

  it("traces OFF (production): the run guarded by ctx.runOnce, keyed by its pass, runs once each", async () => {
    const r = await withTraces(false, () => drive("fix2132-poc-off-guarded", true));
    console.log("[off, guarded]", JSON.stringify({ runs: r.afterSecond.runs, output: r.second.output }));
    expect(r.afterFirst.runs).toEqual(["pass 1: brief", "pass 2: answer: A1"]);
    expect(r.second.suspension.message).toBe("question 2");
    expect(r.afterSecond.status).toBe("completed");
    expect(r.afterSecond.runs).toEqual(["pass 1: brief", "pass 2: answer: A1", "pass 3: answer: A2"]);
    // A characterization: the guard holds the run, not the state later steps append.
    expect(r.second.output).toMatchObject({ pass: 3, answers: ["A1", "A1", "A2"] });
  });
});

