/**
 * A request's spend ledger (FIX-2145): one count of what a request spent, fed
 * by every model result and by each harness when it settles a run, read by
 * `ctx.request.tokenUsage` and handed to request-end hooks as `spend`.
 *
 * Why it matters: the count used to be summed from trace items, which carry no
 * usage with trace observability off (the default under NODE_ENV=production),
 * so a request counted 0 tokens there and an action's token budget never
 * acted. Per-worker usage is built on this count, so it must hold in
 * production as in development, count every model call once, and keep a
 * harness's spend out of the model budget.
 */
import { DEFAULT_ORG_ID, boolean, defineFlow, evaluator, generator, handler, sequencer } from "@flow-state-dev/core";
import { mockEvaluationModel } from "@flow-state-dev/testing";
import {
  SESSION_REQUEST_END_HOOK,
  onRequestEnded,
  reportHarnessSpend,
  type FlowInstance,
  type GeneratorModel,
  type GeneratorModelCallOptions,
  type GeneratorModelResult,
  type RequestEnding,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { detectInterruptedRequests } from "../src/execution/request-recovery";

const previousObservability = process.env.FSDEV_TRACE_OBSERVABILITY;
afterEach(() => {
  if (previousObservability === undefined) delete process.env.FSDEV_TRACE_OBSERVABILITY;
  else process.env.FSDEV_TRACE_OBSERVABILITY = previousObservability;
});

/** A resolver whose one model answers every call with `usage`. */
function resolverReporting(usage: { promptTokens: number; completionTokens: number; totalTokens: number }) {
  return Object.assign(
    () => ({
      modelId: "openai/gpt-6-luna",
      async generate() {
        return { text: "ok", usage };
      }
    }),
    { resolveId: (id: string) => id }
  );
}

/** A step-capable model that answers `generateStep` from `script`, one entry per call. */
function stepModel(script: Array<(options: GeneratorModelCallOptions) => GeneratorModelResult>, modelId = "step-model") {
  let calls = 0;
  const model: GeneratorModel = {
    modelId,
    async generate() {
      throw new Error("the owned loop calls generateStep");
    },
    async generateStep(options) {
      const entry = script[calls++];
      if (entry === undefined) throw new Error(`no script entry for step ${calls - 1}`);
      return entry(options);
    }
  };
  return model;
}

const usage4x4 = { promptTokens: 4, completionTokens: 4, totalTokens: 8 };

/** A tap that registers a request-end hook recording the ending. */
function recordingEnd(endings: RequestEnding[]) {
  return handler({
    name: "record-end",
    inputSchema: z.any(),
    execute: (_input, ctx) => {
      onRequestEnded(ctx, (ending) => {
        endings.push(ending);
      });
    }
  });
}

function run(flow: FlowInstance, runtimeConfig: Record<string, unknown>, id: string) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    sessionId: `s-${id}`,
    requestId: `r-${id}`,
    stores: createInMemoryStores(),
    runtimeConfig
  });
}

describe("request spend ledger", () => {
  it("counts a model call with trace observability off, so an action's token budget acts in production", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const block = generator({ name: "spend", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-budget-off",
      actions: { run: { inputSchema: z.object({}), block, tokenBudget: { maxTotalTokens: 5, onExceeded: "error" } } }
    })();

    const result = await run(flow, { modelResolver: resolverReporting({ promptTokens: 4, completionTokens: 4, totalTokens: 8 }) }, "budget-off");

    expect(result.error?.message).toBe("Token budget exceeded: consumed 8 > 5");
  });

  it("hands a request-end hook what the request spent: model calls by model, and harness runs apart from the token count", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const seen: number[] = [];
    const harness = handler({
      name: "harness",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        reportHarnessSpend(ctx, { harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" });
        seen.push(ctx.request.tokenUsage.totalConsumed);
        return {};
      }
    });
    const ask = () => generator({ name: "ask", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-ending",
      actions: {
        run: { inputSchema: z.object({}), block: sequencer({ name: "seq" }).tap(recordingEnd(endings)).step(ask()).step(ask()).step(harness) }
      }
    })();

    const result = await run(flow, { modelResolver: resolverReporting(usage4x4) }, "ending");

    expect(result.error).toBeUndefined();
    // Two calls of 4 + 4, and the harness run is not a model call.
    expect(seen).toEqual([16]);
    expect(endings).toHaveLength(1);
    expect(endings[0]!.spend).toEqual({
      byModel: { "openai/gpt-6-luna": { prompt: 8, completion: 8, total: 16, cacheReadTokens: 0, cacheCreationTokens: 0 } },
      harnessRuns: [{ harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" }]
    });
  });

  it("counts an evaluator a generator calls as a tool", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const judge = evaluator({
      name: "judge",
      model: mockEvaluationModel({ answers: { ok: { type: "boolean", probability: 0.9 } }, usage: { inputTokens: 3, outputTokens: 2 }, modelId: "judge-model" }),
      inputSchema: z.object({}),
      state: () => "s",
      questions: { ok: boolean("ok?") }
    });
    const model = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "judge", args: {} }], finishReason: "tool-calls", usage: usage4x4 }),
      () => ({ text: "done", finishReason: "stop", usage: usage4x4 })
    ]);
    const flow = defineFlow({
      kind: "spend-evaluator-tool",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: sequencer({ name: "seq" }).tap(recordingEnd(endings)).step(generator({ name: "agent", model, prompt: "p", tools: [judge] }))
        }
      }
    })();

    const result = await run(flow, {}, "evaluator-tool");

    expect(result.error).toBeUndefined();
    const { "step-model": agent, ...others } = endings[0]!.spend.byModel;
    expect(agent?.total).toBe(16);
    expect(Object.values(others).map((entry) => entry.total)).toEqual([5]);
  });

  it("adds the hook a session config's slot returns to every request of the flow, with the request's context", async () => {
    const endings: Array<{ ending: RequestEnding; sessionId: string }> = [];
    const flow = defineFlow({
      kind: "spend-session-slot",
      session: {
        [SESSION_REQUEST_END_HOOK]: (ctx) => (ending) => {
          endings.push({ ending, sessionId: ctx.session.identity.id });
        }
      },
      actions: { run: { inputSchema: z.object({}), block: generator({ name: "ask", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" }) } }
    })();

    await run(flow, { modelResolver: resolverReporting(usage4x4) }, "slot-1");
    await run(flow, { modelResolver: resolverReporting(usage4x4) }, "slot-2");

    expect(endings.map(({ ending, sessionId }) => [sessionId, ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total])).toEqual([
      ["s-slot-1", "completed", 8],
      ["s-slot-2", "completed", 8]
    ]);
  });

  it("counts the steps a generator finished before its tool suspended, once, across the suspension and the resume", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const gate = handler({
      name: "approve",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Go?" });
        return { ok: true };
      }
    });
    const model = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "approve", args: {} }], finishReason: "tool-calls", usage: usage4x4 }),
      () => ({ text: "done", finishReason: "stop", usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } })
    ]);
    const flow = defineFlow({
      kind: "spend-suspend",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      actions: {
        run: { inputSchema: z.object({}), block: sequencer({ name: "seq", durable: true }).step(generator({ name: "agent", model, prompt: "p", tools: [gate] })) }
      }
    })({ id: "spend-suspend" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });

    const initial = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", stores, runtimeConfig: { durabilityProvider: provider } });
    const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: {} });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId: initial.requestId!,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: {}, resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });

    expect((await finished).error).toBeUndefined();
    expect(endings.map((ending) => [ending.status, ending.spend.byModel["step-model"]?.total])).toEqual([
      ["suspended", 8],
      ["completed", 3]
    ]);
  });

  it("keeps counting a resumed request's token budget from what it spent before it suspended", async () => {
    // The ledger is built per run, and a resume does not call the model again
    // for the steps before the gate: without the carried count, a request
    // that spent 8 + 3 under a budget of 10 would read 3 and pass.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const gate = handler({
      name: "approve",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Go?" });
        return { ok: true };
      }
    });
    const model = stepModel([
      () => ({ toolCalls: [{ toolCallId: "c1", toolName: "approve", args: {} }], finishReason: "tool-calls", usage: usage4x4 }),
      () => ({ text: "done", finishReason: "stop", usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } })
    ]);
    const flow = defineFlow({
      kind: "spend-suspend-budget",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: sequencer({ name: "seq", durable: true }).step(generator({ name: "agent", model, prompt: "p", tools: [gate] })),
          tokenBudget: { maxTotalTokens: 10, onExceeded: "error" }
        }
      }
    })({ id: "spend-suspend-budget" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });

    const initial = await runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", stores, runtimeConfig: { durabilityProvider: provider } });
    const [suspension] = (await provider.listSuspended({ status: "pending" })) as SuspensionRecord[];
    await provider.suspend({ ...suspension!, status: "approved", resolvedAt: Date.now(), resumeData: {} });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId: initial.requestId!,
      stores,
      flowRegistry: registry,
      resumeContext: { suspensionId: suspension!.suspensionId, action: "approve", data: {}, resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });

    expect((await finished).error?.message).toBe("Token budget exceeded: consumed 11 > 10");
    // Each ending is still handed only what its own run spent.
    expect(endings.map((ending) => [ending.status, ending.spend.byModel["step-model"]?.total])).toEqual([
      ["suspended", 8],
      ["failed", 3]
    ]);
  });

  it("keeps counting a request's token budget across a continuation after the client went away", async () => {
    // A disconnect leaves the request `interrupted`, and a continuation
    // replays the steps it finished rather than calling the model again: the
    // count it carries is the only record of what they spent.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const usages = [usage4x4, { promptTokens: 2, completionTokens: 1, totalTokens: 3 }];
    let calls = 0;
    const modelResolver = Object.assign(
      () => ({
        modelId: "openai/gpt-6-luna",
        async generate() {
          return { text: "ok", usage: usages[Math.min(calls++, usages.length - 1)] };
        }
      }),
      { resolveId: (id: string) => id }
    );
    let waited = false;
    const waitOnce = handler({
      name: "wait-once",
      inputSchema: z.any(),
      execute: async (value, ctx) => {
        if (waited) return value;
        waited = true;
        await new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
        return value;
      }
    });
    const ask = (name: string) => generator({ name, model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-interrupt-budget",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: sequencer({ name: "seq", durable: true }).step(ask("first")).step(waitOnce).step(ask("second")),
          tokenBudget: { maxTotalTokens: 10, onExceeded: "error" }
        }
      }
    })({ id: "spend-interrupt-budget" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider, modelResolver };
    const disconnect = new AbortController();

    const running = runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-interrupt", signal: disconnect.signal, stores, runtimeConfig });
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect.abort();
    await running;
    expect((await stores.request.get("r-interrupt"))?.status).toBe("interrupted");
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({ requestId: "r-interrupt", stores, flowRegistry: registry, runtimeConfig });

    const outcome = await finished;
    // The first answer was replayed, not asked again.
    expect(calls).toBe(2);
    expect(outcome.error?.message).toBe("Token budget exceeded: consumed 11 > 10");
  });

  it("hands on what an interrupted request's observer spent once, not again at the continuation", async () => {
    // The interrupted ending hands on what `onFinished` spent after the
    // record settled. The continuation must not read that call's trace as a
    // dead run's spend and hand it on a second time.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    let calls = 0;
    const modelResolver = Object.assign(
      () => ({
        modelId: "openai/gpt-6-luna",
        async generate() {
          calls += 1;
          return { text: "ok", usage: calls === 1 ? usage4x4 : { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
        }
      }),
      { resolveId: (id: string) => id }
    );
    let waited = false;
    const waitOnce = handler({
      name: "wait-once",
      inputSchema: z.any(),
      execute: async (value, ctx) => {
        if (waited) return value;
        waited = true;
        await new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
        return value;
      }
    });
    const ask = (name: string) => generator({ name, model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-interrupt-observer",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      request: { onFinished: ask("notify") },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: sequencer({ name: "seq", durable: true }).step(ask("first")).step(waitOnce).step(ask("second"))
        }
      }
    })({ id: "spend-interrupt-observer" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider, modelResolver };
    const disconnect = new AbortController();

    const running = runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-observer", signal: disconnect.signal, stores, runtimeConfig });
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect.abort();
    await running;
    expect((await stores.request.get("r-observer"))?.status).toBe("interrupted");
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({ requestId: "r-observer", stores, flowRegistry: registry, runtimeConfig });
    await finished;

    // first (8) + notify (3), then second (3) + notify (3).
    expect(calls).toBe(4);
    expect(endings.map((ending) => [ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total])).toEqual([
      ["interrupted", 11],
      ["completed", 6]
    ]);
  });

  it.each(["false", "true"])(
    "keeps counting a request's token budget across a continuation after its process died (observability %s)",
    async (observability) => {
      // A run whose process died settles nothing: what its finished steps
      // spent is only in the log their traces left. The continuation replays
      // them without calling the model, so without that count a request that
      // spent 8 + 3 under a budget of 10 would read 3 and pass, and a worker's
      // usage would never see the 8.
      process.env.FSDEV_TRACE_OBSERVABILITY = observability;
      const endings: RequestEnding[] = [];
      const usages = [usage4x4, { promptTokens: 2, completionTokens: 1, totalTokens: 3 }];
      let calls = 0;
      const modelResolver = Object.assign(
        () => ({
          modelId: "openai/gpt-6-luna",
          async generate() {
            return { text: "ok", usage: usages[Math.min(calls++, usages.length - 1)] };
          }
        }),
        { resolveId: (id: string) => id }
      );
      let crashed = true;
      let stalledOnce = false;
      // On the first run this step never returns, standing in for a process that died mid-step.
      const stall = handler({
        name: "stall",
        inputSchema: z.any(),
        execute: async (value) => {
          if (!crashed) return value;
          stalledOnce = true;
          return new Promise<never>(() => {});
        }
      });
      const ask = (name: string) => generator({ name, model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
      const flow = defineFlow({
        kind: "spend-crash-budget",
        session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
        actions: {
          run: {
            inputSchema: z.object({}),
            block: sequencer({ name: "seq", durable: true }).step(ask("first")).step(stall).step(ask("second")),
            tokenBudget: { maxTotalTokens: 10, onExceeded: "error" }
          }
        }
      })({ id: "spend-crash-budget" });
      const stores = createInMemoryStores();
      const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
      const runtimeConfig = { durabilityProvider: provider, modelResolver };

      void runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-crash", stores, runtimeConfig });
      while (!stalledOnce) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await detectInterruptedRequests({ stores, staleThresholdMs: -1 })).map((swept) => swept.entry.requestId)).toEqual(["r-crash"]);
      crashed = false;
      const registry = createFlowRegistry();
      registry.register(flow as never);
      const { finished } = await continueRequest({ requestId: "r-crash", stores, flowRegistry: registry, runtimeConfig });

      const outcome = await finished;
      // The first answer was replayed, not asked again.
      expect(calls).toBe(2);
      expect(outcome.error?.message).toBe("Token budget exceeded: consumed 11 > 10");
      // The dead run never ended, so the continuation's one ending hands on both runs.
      expect(endings.map((ending) => [ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total])).toEqual([["failed", 11]]);
    }
  );
});
