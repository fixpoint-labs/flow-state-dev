/**
 * Observability off (production) still replays a finished step from its
 * `block_trace`. A loop that stops twice runs each pass once and keeps a
 * record for every block full capture keeps, with no input, prompt, or
 * resource-load payload. A generator step (recorded as a ref to its message,
 * not inline) is not called again on resume. `/continue` crash recovery skips
 * the steps that finished before the crash when a durability provider is
 * configured; without one it behaves as it did before (re-runs with
 * observability off).
 * Every persisted item, block records and a generator's messages alike, gets
 * its own index, in emission order.
 */
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { parseBlockInstanceId } from "@flow-state-dev/core/items/internal";
import type { FlowInstance, GeneratorModel } from "@flow-state-dev/core/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { detectInterruptedRequests } from "../src/execution/request-recovery";
import { handleContinueRequest } from "../src/routes/recovery-routes";
import type { InboundTransportHost } from "../src/transports/types";

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

/** `blockName@path` of each retained, completed trace, sorted. */
function completedTraceKeys(items: readonly { type: string }[]): string[] {
  return (items.filter((i) => i.type === "block_trace") as BlockTraceItem[])
    .filter((t) => t.status === "completed" && t.transient !== true)
    .map((t) => `${t.blockName}@${parseBlockInstanceId(t.blockInstanceId)?.path}`)
    .sort();
}

function durableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

async function driveTwoAnswers() {
  runs.length = 0;
  const flow = buildFlow();
  const { stores, provider } = durableStores();
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

    // The lean records name exactly the blocks full capture records as
    // completed, so a dropped block fails here.
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    const full = completedTraceKeys((await driveTwoAnswers()).record?.items ?? []);
    expect(full).toContain("loop@root");
    expect(completedTraceKeys(r.record?.items ?? [])).toEqual(full);

    const traces = (r.record?.items ?? []).filter((i) => i.type === "block_trace") as BlockTraceItem[];
    for (const trace of traces) {
      expect(trace.status).toBe("completed");
      expect(trace.lean).toBe(true);
      expect(trace.output).toBeDefined();
      expect(trace.input).toBeUndefined();
      expect(trace.generator).toBeUndefined();
      expect(trace.resourceLoads).toBeUndefined();
      expect(trace.declaredResources).toBeUndefined();
    }
  });

  it("does not call a generator's model again on resume", async () => {
    let modelCalls = 0;
    const model: GeneratorModel = {
      modelId: "stub",
      generate: async () => {
        modelCalls += 1;
        return {
          text: "the draft",
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      },
    };
    // With an item visibility the generator emits its text as a message, and
    // its recorded output is a reference to that message, not an inline copy.
    const draft = generator({
      name: "draft",
      model,
      prompt: "write it",
      itemVisibility: { client: true, history: true },
    });
    const review = handler({
      name: "review",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: unknown, ctx) => {
        const verdict = await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
        return { draft: input, verdict };
      },
    });
    const flow = defineFlow({
      kind: "replay-traces-off-generator",
      actions: {
        run: { inputSchema: z.any(), block: sequencer({ name: "seq", durable: true }).step(draft).step(review) },
      },
    })({ id: "replay-traces-off-generator" });
    const { stores, provider } = durableStores();
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
    expect(modelCalls).toBe(1);
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: "ok" });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: "ok", resumedBy: "alice" },
      runtimeConfig: { durabilityProvider: provider },
    });
    const result = await finished;

    expect(modelCalls).toBe(1);
    expect(result.output).toEqual({ draft: "the draft", verdict: "ok" });
    // Its recorded output is a reference to the message, resolved on replay.
    const items = (await stores.request.get(requestId))?.items ?? [];
    const draftTrace = (items as BlockTraceItem[]).find((i) => i.type === "block_trace" && i.blockName === "draft");
    expect(draftTrace?.output?.kind).toBe("ref");
  });

  // With a durability provider, `/continue` replays finished steps and
  // restores the sequencer's state from its checkpoint, whatever the
  // observability setting. Without one it behaves as it always has: it skips
  // a finished step only from a full trace, so a run recorded with
  // observability off runs again from the top, and one recorded with it on is
  // skipped. That follows the records, not the setting at recovery.
  it.each([
    { provider: true, ran: "false", recovered: "false", runs: 1 },
    { provider: true, ran: "true", recovered: "true", runs: 1 },
    { provider: true, ran: "false", recovered: "true", runs: 1 },
    { provider: false, ran: "false", recovered: "false", runs: 2 },
    { provider: false, ran: "true", recovered: "true", runs: 1 },
    { provider: false, ran: "false", recovered: "true", runs: 2 },
    { provider: false, ran: "true", recovered: "false", runs: 1 },
  ])("recovers a crash through /continue (provider: $provider, observability $ran then $recovered)", async (c) => {
    process.env.FSDEV_TRACE_OBSERVABILITY = c.ran;
    let workRuns = 0;
    let crashed = true;
    const stalled = new Promise<never>(() => {});
    const stateSchema = z.object({ seen: z.array(z.string()).default([]) });
    const work = handler({
      name: "work",
      inputSchema: z.any(),
      outputSchema: z.object({ n: z.number() }),
      execute: async (_input, ctx) => {
        workRuns += 1;
        const prior = (ctx.sequencer!.state as { seen: string[] }).seen;
        ctx.sequencer!.patchState({ seen: [...prior, "work"] });
        return { n: workRuns };
      },
    });
    // On the first run this step never returns, standing in for a process
    // that died mid-step; after recovery it finishes.
    const slow = handler({
      name: "slow",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: unknown, ctx) =>
        crashed ? stalled : { after: input, state: ctx.sequencer!.state },
    });
    const flow = defineFlow({
      kind: "replay-traces-off-continue",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "seq", durable: true, stateSchema }).step(work).step(slow),
        },
      },
    })({ id: "replay-traces-off-continue" });
    const { stores, provider } = durableStores();
    const runtimeConfig = c.provider ? { durabilityProvider: provider } : {};
    const registry = createFlowRegistry();
    registry.register(flow as never);

    void runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      orgId: DEFAULT_ORG_ID,
      stores,
      runtimeConfig,
    } as never);
    // Let `work` finish and its items reach the store, as they would before a crash.
    for (let i = 0; i < 100 && workRuns === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
    const [running] = await stores.request.list();
    const requestId = running!.id;
    expect(running!.status).toBe("in_progress");
    expect(workRuns).toBe(1);

    // The stale sweep marks the dead run interrupted, the state /continue accepts.
    const swept = await detectInterruptedRequests({ stores, staleThresholdMs: -1 });
    expect(swept.map((s) => s.entry.requestId)).toEqual([requestId]);
    crashed = false;
    process.env.FSDEV_TRACE_OBSERVABILITY = c.recovered;

    let finished: Promise<{ output: unknown }> | undefined;
    const host = {
      continueRequest: async (opts: { requestId: string }) => {
        const handle = await continueRequest({
          requestId: opts.requestId,
          stores,
          flowRegistry: registry,
          runtimeConfig,
        });
        finished = handle.finished as Promise<{ output: unknown }>;
        return handle;
      },
    } as unknown as InboundTransportHost;
    const response = await handleContinueRequest(
      new Request("http://localhost/continue", { method: "POST" }),
      { kind: "continue_request", flowKind: "replay-traces-off-continue", sessionId: "s1", requestId },
      { registry, stores, runtimeConfig, host } as never
    );
    expect(response.status).toBe(202);
    const result = await finished!;

    expect(workRuns).toBe(c.runs);
    expect(result.output).toMatchObject({ after: { n: c.runs } });
    // The step's state write is there once: restored with the replayed step,
    // or written again by the re-run on a fresh state. The provider-free skip
    // restores no checkpoint, a known gap left as it was, so it is not checked.
    if (c.provider || c.runs === 2) {
      expect((result.output as { state: unknown }).state).toEqual({ seen: ["work"] });
    }
    expect((await stores.request.get(requestId))?.status).toBe("completed");
  });

  // Stores that keep items in a table order history by `itemIndex`, so two
  // items sharing one, or a later item with a lower one, reorder the log.
  it.each(["false", "true"])(
    "gives every persisted item a distinct, increasing index (observability %s)",
    async (observability) => {
      process.env.FSDEV_TRACE_OBSERVABILITY = observability;
      const model: GeneratorModel = {
        modelId: "stub",
        generate: async () => ({
          text: "the draft",
          finishReason: "stop",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }),
      };
      const draft = generator({
        name: "draft",
        model,
        prompt: "write it",
        itemVisibility: { client: true, history: true },
      });
      const after = handler({
        name: "after",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (input: unknown) => ({ got: input }),
      });
      const flow = defineFlow({
        kind: "replay-traces-off-index",
        actions: { run: { inputSchema: z.any(), block: sequencer({ name: "seq" }).step(draft).step(after).step(draft) } },
      })({ id: "replay-traces-off-index" });
      const stores = createInMemoryStores();
      const started = await runAction({
        flow,
        actionName: "run",
        input: {},
        userId: "u1",
        orgId: DEFAULT_ORG_ID,
        stores,
        runtimeConfig: {},
      } as never);
      const items = (await stores.request.get((started as { requestId: string }).requestId))?.items ?? [];

      expect(items.some((i) => i.type === "message")).toBe(true);
      const indexes = items.map((i) => i.itemIndex);
      expect(new Set(indexes).size).toBe(indexes.length);
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    }
  );

  it.each(["false", "true"])(
    "keeps ctx.wasRescued() true for a replayed rescued step after resume (observability %s)",
    async (observability) => {
      process.env.FSDEV_TRACE_OBSERVABILITY = observability;
      const failing = handler({
        name: "flaky",
        inputSchema: z.any(),
        outputSchema: z.object({ value: z.number() }),
        execute: () => {
          throw new Error("boom");
        },
      });
      const fallback = handler({
        name: "fallback",
        inputSchema: z.any(),
        outputSchema: z.object({ value: z.number() }),
        execute: () => ({ value: -1 }),
      });
      const safe = failing.rescue([{ block: fallback }]);
      const seen: boolean[] = [];
      const gate = handler({
        name: "gate",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (_input, ctx) => {
          seen.push(ctx.wasRescued(safe));
          await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
          return { rescued: ctx.wasRescued(safe) };
        },
      });
      const flow = defineFlow({
        kind: "replay-traces-off-rescued",
        actions: { run: { inputSchema: z.any(), block: sequencer({ name: "seq", durable: true }).step(safe).step(gate) } },
      })({ id: "replay-traces-off-rescued" });
      const { stores, provider } = durableStores();
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
      const [suspension] = await provider.listSuspended({ status: "pending" });
      await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now() });
      const { finished } = await continueRequest({
        requestId,
        stores,
        flowRegistry: registry,
        resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", resumedBy: "alice" },
        runtimeConfig: { durabilityProvider: provider },
      });
      const result = await finished;

      // The gate reads the same answer before the stop and after the resume.
      expect(seen).toEqual([true, true]);
      expect(result.output).toEqual({ rescued: true });
    }
  );
});
