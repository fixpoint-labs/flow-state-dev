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
  readRequestSpend,
  reportHarnessSpend,
  type FlowInstance,
  type GeneratorModel,
  type GeneratorModelCallOptions,
  type GeneratorModelResult,
  type GeneratorModelResultPayload,
  type RequestEnding,
  type SuspensionRecord
} from "@flow-state-dev/core/types";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { detectInterruptedRequests } from "../src/execution/request-recovery";
import { createRequestSpendLedger } from "../src/execution/request-spend-ledger";

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

  it("hands on what an onStarted observer spent before it threw", async () => {
    // A request whose startup observer fails never reaches its main path, but
    // the model call the observer made was still spent.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const boom = handler({ name: "boom", inputSchema: z.any(), execute: async () => { throw new Error("startup failed"); } });
    const flow = defineFlow({
      kind: "spend-startup",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      request: { onStarted: sequencer({ name: "start" }).step(generator({ name: "warm", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" })).step(boom) },
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "noop", inputSchema: z.any(), execute: async () => ({}) }) } }
    })({ id: "spend-startup" });

    await expect(runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", stores: createInMemoryStores(), runtimeConfig: { modelResolver: resolverReporting(usage4x4) } })).rejects.toThrow("startup failed");
    expect(endings.map((ending) => [ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total])).toEqual([["failed", 8]]);
  });

  it("waits for an onStarted side-chain's spend before a failed startup ends", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const slow = Object.assign(
      () => ({
        modelId: "openai/gpt-6-luna",
        async generate() {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { text: "ok", usage: usage4x4 };
        }
      }),
      { resolveId: (id: string) => id }
    );
    const boom = handler({ name: "boom", inputSchema: z.any(), execute: async () => { throw new Error("startup failed"); } });
    const warm = generator({ name: "warm", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-startup-side",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      request: { onStarted: sequencer({ name: "start" }).sideChain(warm).step(boom) },
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "noop", inputSchema: z.any(), execute: async () => ({}) }) } }
    })({ id: "spend-startup-side" });

    await expect(runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", stores: createInMemoryStores(), runtimeConfig: { modelResolver: slow } })).rejects.toThrow("startup failed");
    expect(endings.map((ending) => [ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total])).toEqual([["failed", 8]]);
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

  it("keeps a continuation's newer count when the interrupted run's ending finishes after it", async () => {
    // The interrupted run's observer is still going when a continuation takes
    // the request, spends more and suspends. The older ending's write must not
    // put back the smaller count.
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const usage3 = { promptTokens: 2, completionTokens: 1, totalTokens: 3 };
    const modelResolver = Object.assign(
      () => ({ modelId: "openai/gpt-6-luna", async generate() { return { text: "ok", usage: usage3 }; } }),
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
    let releaseObserver: () => void = () => {};
    let observerHeld = false;
    const holdFirstObserver = handler({
      name: "hold-first",
      inputSchema: z.any(),
      execute: async () => {
        if (observerHeld) return;
        observerHeld = true;
        await new Promise<void>((resolve) => (releaseObserver = resolve));
      }
    });
    const gate = handler({
      name: "approve",
      inputSchema: z.any(),
      execute: async (value, ctx) => {
        await ctx.suspend!({ reason: "approval", message: "Go?" });
        return value;
      }
    });
    const ask = (name: string) => generator({ name, model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-late-ending",
      request: { onFinished: holdFirstObserver },
      actions: {
        run: {
          inputSchema: z.object({}),
          block: sequencer({ name: "seq", durable: true }).step(ask("first")).step(waitOnce).step(ask("second")).step(gate)
        }
      }
    })({ id: "spend-late-ending" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider, modelResolver };
    const disconnect = new AbortController();

    const older = runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-late", signal: disconnect.signal, stores, runtimeConfig });
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect.abort();
    while (!observerHeld) await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await stores.request.get("r-late"))?.status).toBe("interrupted");
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({ requestId: "r-late", stores, flowRegistry: registry, runtimeConfig });
    await finished;
    expect((await stores.request.get("r-late"))?.status).toBe("suspended");
    const settled = await stores.request.get("r-late");

    releaseObserver();
    await older;

    const after = await stores.request.get("r-late");
    expect(after?.spentByModel?.["openai/gpt-6-luna"]?.total).toBe(6);
    expect(after?.spentThroughItemIndex).toBe(settled?.spentThroughItemIndex);
  });

  it("counts an interrupted run's observer once when a continuation starts while the observer is still going", async () => {
    // The continuation reads the log while the older run is alive: the
    // observer's call is that run's to hand on, not unreported crash spend.
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    const endings: RequestEnding[] = [];
    let calls = 0;
    const usage3 = { promptTokens: 2, completionTokens: 1, totalTokens: 3 };
    const modelResolver = Object.assign(
      () => ({ modelId: "openai/gpt-6-luna", async generate() { calls++; return { text: "ok", usage: usage3 }; } }),
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
    let releaseObserver: () => void = () => {};
    let observerHeld = false;
    const holdFirst = handler({
      name: "hold-first",
      inputSchema: z.any(),
      execute: async () => {
        if (observerHeld) return;
        observerHeld = true;
        await new Promise<void>((resolve) => (releaseObserver = resolve));
      }
    });
    const ask = (name: string) => generator({ name, model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const flow = defineFlow({
      kind: "spend-live-observer",
      session: { [SESSION_REQUEST_END_HOOK]: () => (ending) => void endings.push(ending) },
      request: { onFinished: sequencer({ name: "notify-seq" }).sideChain(holdFirst).step(ask("notify")) },
      actions: {
        run: { inputSchema: z.object({}), block: sequencer({ name: "seq", durable: true }).step(ask("first")).step(waitOnce) }
      }
    })({ id: "spend-live-observer" });
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({ checkpoints: stores.checkpoints, suspensions: stores.suspensions, leases: stores.leases });
    const runtimeConfig = { durabilityProvider: provider, modelResolver };
    const disconnect = new AbortController();

    const older = runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-live", signal: disconnect.signal, stores, runtimeConfig });
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect.abort();
    while (!observerHeld) await new Promise((resolve) => setTimeout(resolve, 5));
    await stores.request.flushItems("r-live");
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({ requestId: "r-live", stores, flowRegistry: registry, runtimeConfig });
    await finished;
    releaseObserver();
    await older;

    // Every call is 3 tokens, and the endings together hand on each call once
    // (the continuation replays the observer's step rather than calling again).
    const total = endings.reduce((sum, ending) => sum + (ending.spend.byModel["openai/gpt-6-luna"]?.total ?? 0), 0);
    expect(total).toBe(calls * 3);
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
      let endDeadRun: () => void = () => {};
      // On the first run this step doesn't return, standing in for a process
      // that died mid-step. The test ends that run once it is done, so its
      // timers don't outlive the test.
      const stall = handler({
        name: "stall",
        inputSchema: z.any(),
        execute: async (value) => {
          if (!crashed) return value;
          stalledOnce = true;
          return new Promise<never>((_resolve, reject) => {
            endDeadRun = () => reject(new Error("the process died"));
          });
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

      const deadRun = runAction({ orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u1", requestId: "r-crash", stores, runtimeConfig });
      while (!stalledOnce) await new Promise((resolve) => setTimeout(resolve, 5));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await detectInterruptedRequests({ stores, staleThresholdMs: -1 })).map((swept) => swept.entry.requestId)).toEqual(["r-crash"]);
      crashed = false;
      const registry = createFlowRegistry();
      registry.register(flow as never);
      const { finished } = await continueRequest({ requestId: "r-crash", stores, flowRegistry: registry, runtimeConfig });

      const outcome = await finished;
      // The dead run never ended, so the continuation's one ending hands on both runs.
      const endingsBeforeTeardown = endings.map((ending) => [ending.status, ending.spend.byModel["openai/gpt-6-luna"]?.total]);
      endDeadRun();
      await deadRun.catch(() => undefined);
      // The first answer was replayed, not asked again.
      expect(calls).toBe(2);
      expect(outcome.error?.message).toBe("Token budget exceeded: consumed 11 > 10");
      expect(endingsBeforeTeardown).toEqual([["failed", 11]]);
    }
  );
});

/**
 * FIX-2288: a harness reports as its run goes, keyed by run, and a framework
 * package reads what the request has spent so far. Why it matters: a task card
 * shows a count that rises while a run works, so the read must see each
 * report as it lands, a run reported many times must count once (its latest
 * report, never the sum of its reports), and the ending must still hand on
 * exactly what the reads showed.
 */
describe("request spend read mid-run", () => {
  it("reads each report as it lands, replaces a run's earlier report, and hands on the run once at the ending", async () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    const endings: RequestEnding[] = [];
    const reads: unknown[] = [];
    const harness = handler({
      name: "harness",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        const report = (inputTokens: number | null, outputTokens: number | null) =>
          reportHarnessSpend(ctx, { runId: "run-1", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens, outputTokens, costUsd: null, billing: "subscription" });
        report(null, null);
        reads.push(readRequestSpend(ctx)?.harnessRuns);
        report(100, 20);
        reads.push(readRequestSpend(ctx)?.harnessRuns.map((run) => [run.inputTokens, run.outputTokens]));
        report(1000, 200);
        reads.push(readRequestSpend(ctx)?.harnessRuns.map((run) => [run.inputTokens, run.outputTokens]));
        return {};
      }
    });
    const ask = generator({ name: "ask", model: "openai/gpt-6-luna", prompt: () => "p", user: () => "u" });
    const readModels = handler({
      name: "read-models",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        reads.push(readRequestSpend(ctx)?.byModel);
        return {};
      }
    });
    const flow = defineFlow({
      kind: "spend-read",
      actions: { run: { inputSchema: z.object({}), block: sequencer({ name: "seq" }).tap(recordingEnd(endings)).step(ask).step(readModels).step(harness) } }
    })();

    const result = await run(flow, { modelResolver: resolverReporting(usage4x4) }, "read");

    expect(result.error).toBeUndefined();
    expect(reads[0]).toEqual({ "openai/gpt-6-luna": { prompt: 4, completion: 4, total: 8, cacheReadTokens: 0, cacheCreationTokens: 0 } });
    // Before any tokens: the run is there, with its model, and null tokens (never 0).
    expect(reads[1]).toEqual([{ runId: "run-1", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: null, outputTokens: null, costUsd: null, billing: "subscription" }]);
    expect(reads[2]).toEqual([[100, 20]]);
    // The latest report replaces the earlier ones: 1 000 + 200, never 1 100 + 220.
    expect(reads[3]).toEqual([[1000, 200]]);
    expect(endings[0]!.spend.harnessRuns).toEqual([
      { runId: "run-1", harness: "claude-code", model: "claude-sonnet-4-5", inputTokens: 1000, outputTokens: 200, costUsd: null, billing: "subscription" }
    ]);
  });

  it("keeps two runs apart, and a report with no run id as a settled run of its own", async () => {
    const endings: RequestEnding[] = [];
    const harness = handler({
      name: "harness",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        reportHarnessSpend(ctx, { runId: "a", harness: "codex", model: "gpt-5", inputTokens: 1, outputTokens: 1, costUsd: null, billing: null });
        reportHarnessSpend(ctx, { runId: "b", harness: "codex", model: "gpt-5", inputTokens: 2, outputTokens: 2, costUsd: null, billing: null });
        reportHarnessSpend(ctx, { harness: "cursor", inputTokens: 5, outputTokens: 5, costUsd: null, billing: null });
        reportHarnessSpend(ctx, { harness: "cursor", inputTokens: 5, outputTokens: 5, costUsd: null, billing: null });
        reportHarnessSpend(ctx, { runId: "a", harness: "codex", model: "gpt-5", inputTokens: 3, outputTokens: 3, costUsd: null, billing: null });
        return {};
      }
    });
    const flow = defineFlow({ kind: "spend-runs", actions: { run: { inputSchema: z.object({}), block: sequencer({ name: "seq" }).tap(recordingEnd(endings)).step(harness) } } })();

    await run(flow, {}, "runs");

    // Run "a" was reported last, so it is last; the two id-less reports are two runs.
    expect(endings[0]!.spend.harnessRuns.map((r) => [r.runId ?? "-", r.harness, r.inputTokens])).toEqual([
      ["b", "codex", 2],
      ["-", "cursor", 5],
      ["-", "cursor", 5],
      ["a", "codex", 3]
    ]);
  });

  it("keys model calls in the order each model was last called, so a task names the model it called last", () => {
    // A task card reads the last key as the request's model: A, then B, then A again must read A.
    const ledger = createRequestSpendLedger();
    const call = (model: string) =>
      ledger.addModelResult({ model, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } } as GeneratorModelResultPayload);
    call("model-a");
    call("model-b");
    call("model-a");
    expect(Object.keys(ledger.pending().byModel)).toEqual(["model-b", "model-a"]);
    expect(Object.keys(ledger.total().byModel)).toEqual(["model-b", "model-a"]);
    expect(ledger.total().byModel["model-a"]!.total).toBe(4);
  });

  it("reads undefined outside a request", () => {
    expect(readRequestSpend({})).toBeUndefined();
  });
});
