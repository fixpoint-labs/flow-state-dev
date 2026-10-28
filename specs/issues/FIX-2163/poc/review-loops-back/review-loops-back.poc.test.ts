/**
 * POC for FIX-2163 — retained design evidence, not production code.
 *
 * The question: FIX-2163 puts a person's review in the harness manager's
 * settle step, after the coding run, inside the same durable request. An
 * accepted review must complete the run WITHOUT running the coding run again,
 * and a revision must loop back to the run step once, with the person's words.
 * Does that hold with trace observability off, as in production, on `main`
 * after FIX-2137 (#3749)? FIX-2132's POC found it did not before FIX-2137.
 *
 * Shape mirrors `harness-manager/src/manager.ts`: run → review → loopBack(run)
 * on a revision → report. `ctx.suspend` with `human_input` stands in for
 * FIX-2129's `waitForUser({ kind: "review" })`, which is not on `main` yet.
 * Run with `bash specs/issues/FIX-2163/poc/review-loops-back/run.sh`.
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

type Verdict = { verdict: "accepted" } | { verdict: "revise"; words: string };

function buildFlow(kind: string): FlowInstance {
  const stateSchema = z.object({ pass: z.number().default(0), reviews: z.array(z.string()).default([]) });
  const codingRun = handler({
    name: "coding-run",
    inputSchema: z.any(),
    outputSchema: z.object({ commits: z.number() }),
    execute: async (input: { prompt?: string } | undefined, ctx) => {
      const pass = ((ctx.sequencer!.state as { pass: number }).pass ?? 0) + 1;
      ctx.sequencer!.patchState({ pass });
      runs.push(`pass ${pass}: ${input?.prompt ?? "brief"}`);
      return { commits: pass };
    },
  });
  const review = handler({
    name: "review",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { commits: number }, ctx) => {
      if (input.commits === 0) return { done: true };
      const answer = (await ctx.suspend!({
        reason: "human_input",
        message: `Review ${input.commits} commit(s). The judge: done (0.9).`,
        allow: ["submit"],
      })) as Verdict;
      const prior = (ctx.sequencer!.state as { reviews: string[] }).reviews ?? [];
      ctx.sequencer!.patchState({ reviews: [...prior, answer.verdict] });
      if (answer.verdict === "accepted") return { done: true };
      return { again: true, prompt: `revise: ${answer.words}` };
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
          .step(review)
          .loopBack("coding-run", { when: (v: { again?: boolean }) => v?.again === true, maxIterations: 4 })
          .step(report),
      },
    },
  })({ id: kind });
}

async function drive(kind: string, answers: Verdict[]) {
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

  const steps: { status: unknown; runs: string[]; suspension: SuspensionRecord }[] = [];
  let output: unknown;
  for (const answer of answers) {
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
    output = ((await finished) as { output: unknown }).output;
    steps.push({ status: (await stores.request.get(requestId))?.status, runs: [...runs], suspension });
  }
  return { steps, output };
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

for (const traces of [false, true]) {
  describe(`FIX-2163 POC · a review after the coding run, traces ${traces ? "on" : "off"}`, () => {
    it("accepted: completes with the coding run run once", async () => {
      const r = await withTraces(traces, () => drive(`fix2163-accept-${traces}`, [{ verdict: "accepted" }]));
      console.log(`[traces ${traces ? "on" : "off"}, accept]`, JSON.stringify({ runs: r.steps.at(-1)!.runs, output: r.output }));
      expect(r.steps[0]!.status).toBe("completed");
      expect(r.steps[0]!.runs).toEqual(["pass 1: brief"]);
      expect(r.output).toMatchObject({ pass: 1, reviews: ["accepted"] });
    });

    it("revise, then accept: one more run with the words, no run repeated, state not doubled", async () => {
      const r = await withTraces(traces, () =>
        drive(`fix2163-revise-${traces}`, [{ verdict: "revise", words: "rename the flag" }, { verdict: "accepted" }]),
      );
      console.log(`[traces ${traces ? "on" : "off"}, revise+accept]`, JSON.stringify({ runs: r.steps.at(-1)!.runs, output: r.output }));
      expect(r.steps[0]!.status).toBe("suspended");
      expect(r.steps[0]!.runs).toEqual(["pass 1: brief", "pass 2: revise: rename the flag"]);
      expect(r.steps[1]!.status).toBe("completed");
      expect(r.steps[1]!.runs).toEqual(["pass 1: brief", "pass 2: revise: rename the flag"]);
      expect(r.output).toMatchObject({ pass: 2, reviews: ["revise", "accepted"] });
    });
  });
}
