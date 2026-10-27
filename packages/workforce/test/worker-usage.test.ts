/**
 * Per-worker token usage (FIX-2145): every request a worker's session runs
 * adds what it spent, model calls and harness runs alike, to the user's
 * `worker-usage/**` record for that worker and UTC day, and `workerUsage`
 * reads it back over a period.
 *
 * Why it matters: a user sees which worker used how much of their
 * subscriptions and keys. A total that misses model calls, shows someone
 * else's spend, shows a dollar figure nobody was billed, or ignores the
 * period would mislead them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { reportHarnessSpend, type FlowInstance, type HarnessRunSpend } from "@flow-state-dev/core/types";
import { abortRequest, createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkerInstallation } from "../src/workers/installation";
import { WORKER_USAGE_ACTION, workerUsageAction, type WorkerUsageRow } from "../src/workers/worker-usage";

const input = z.object({ message: z.string(), harness: z.any().optional(), waitForAbort: z.boolean().optional() });
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

/** A model that answers every call with 4 + 4 tokens. */
const modelResolver = Object.assign(
  () => ({
    modelId: "openai/gpt-6-luna",
    async generate() {
      return { text: "ok", usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 } };
    }
  }),
  { resolveId: (id: string) => id }
);

/** A host over `stores`, with `workers` as its standard workers. */
function host(workers: readonly string[] = ["coder", "em"], stores = inMemoryStores()) {
  const started = Promise.withResolvers<void>();
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers.map((id) => ({ id, declared: { flow: "work" }, body: "Work." })),
    workerFlows: () => flows as never
  });
  const resolve = handler({
    name: "work-resolve",
    inputSchema: input,
    resources: { ...installation.resources },
    execute: async (value, ctx) => {
      await installation.resolveWorker(ctx, "work");
      return value;
    }
  });
  const harness = handler({
    name: "work-harness",
    inputSchema: input,
    execute: async (value, ctx) => {
      if (value.harness !== undefined) reportHarnessSpend(ctx, value.harness as HarnessRunSpend);
      if (value.waitForAbort === true) {
        started.resolve();
        await new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }
      return value;
    }
  });
  const ask = generator({ name: "work-ask", model: "openai/gpt-6-luna", inputSchema: input, prompt: () => "p", user: (i: { message: string }) => i.message });
  const work = defineFlow({
    kind: "work",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      respond: {
        inputSchema: input,
        block: sequencer({ name: "work-turn", inputSchema: input }).step(resolve).step(harness).tap(ask),
        userMessage: (i: { message: string }) => i.message
      },
      [WORKER_USAGE_ACTION]: workerUsageAction(installation)
    }
  });
  flows = { work };
  const copy = work() as unknown as FlowInstance;
  return { copy, started: started.promise, state: createFlowState({ flows: { work: copy }, stores: { default: { primary: stores } }, runtimeConfig: { modelResolver } as never }) };
}

async function harnessOf(h: ReturnType<typeof host>) {
  const runtime = await h.state.getRuntime();
  const router = await h.state.getRouter();
  const open = async (userId: string, worker: string, conversation: string) => {
    const sessionId = `${userId}-${worker}${conversation}`;
    if ((await runtime.stores.session.get(sessionId)) == null) {
      const created = await router.POST(
        new Request("http://localhost/api/flows/work/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, sessionId, state: { workerId: worker } })
        }),
        { params: { path: ["work", "sessions"] } }
      );
      expect(created.status).toBe(201);
    }
    return sessionId;
  };
  const act = async (userId: string, worker: string, actionName: string, value: unknown, conversation = "") => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: h.copy,
      actionName,
      input: value,
      userId,
      sessionId: await open(userId, worker, conversation),
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig, modelResolver }
    });
    expect(result.error).toBeUndefined();
    return result.output;
  };
  /** One turn in one of the user's conversations with `worker`. */
  const turn = (userId: string, worker: string, harness?: HarnessRunSpend, conversation = "") =>
    act(userId, worker, "respond", { message: "go", ...(harness === undefined ? {} : { harness }) }, conversation);
  /** A turn the user stops after its harness reported `harness`. */
  const stoppedTurn = async (userId: string, worker: string, harness: HarnessRunSpend) => {
    const requestId = `stopped-${userId}-${worker}`;
    const running = runAction({
      orgId: DEFAULT_ORG_ID,
      flow: h.copy,
      actionName: "respond",
      input: { message: "go", harness, waitForAbort: true },
      userId,
      requestId,
      sessionId: await open(userId, worker, ""),
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig, modelResolver }
    });
    await h.started;
    await runtime.stores.request.setFieldsIfStatus(requestId, { abortRequested: true }, ["in_progress"], Date.now());
    abortRequest(requestId);
    await running;
    expect((await runtime.stores.request.get(requestId))?.status).toBe("aborted");
  };
  const usage = async (userId: string, days?: number) =>
    ((await act(userId, "em", WORKER_USAGE_ACTION, days === undefined ? {} : { days })) as { workers: WorkerUsageRow[] }).workers;
  return { turn, stoppedTurn, usage };
}

const CLAUDE_KEY: HarnessRunSpend = { harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "api-key" };
const CLAUDE_PLAN: HarnessRunSpend = { harness: "claude-code", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, billing: "subscription" };

describe("per-worker token usage", () => {
  it("adds every turn's model calls and harness runs to the worker's record, with a cost only where an API key was billed", async () => {
    const h = host();
    try {
      const { turn, usage } = await harnessOf(h);
      await turn("alice", "coder", CLAUDE_KEY);
      await turn("alice", "coder", CLAUDE_PLAN);
      await turn("alice", "coder", { harness: "claude-code", inputTokens: null, outputTokens: null, costUsd: null, billing: "subscription" });

      const coder = (await usage("alice")).find((row) => row.worker === "coder");
      expect(coder).toEqual({
        worker: "coder",
        gone: false,
        tokens: { input: 2012, output: 412 },
        costUsd: 0.42,
        bySource: [
          { source: "claude-code", kind: "harness", billing: "api-key", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, runs: 1, unreported: 0 },
          { source: "claude-code", kind: "harness", billing: "subscription", inputTokens: 1000, outputTokens: 200, costUsd: null, runs: 2, unreported: 1 },
          { source: "openai/gpt-6-luna", kind: "model", billing: null, inputTokens: 12, outputTokens: 12, costUsd: null, runs: 3, unreported: 0 }
        ]
      });
    } finally {
      await h.state.dispose();
    }
  });

  it("keeps each user's spend their own", async () => {
    const h = host();
    try {
      const { turn, usage } = await harnessOf(h);
      await turn("alice", "coder", CLAUDE_KEY);
      await turn("bob", "coder");

      expect((await usage("alice")).find((row) => row.worker === "coder")?.tokens).toEqual({ input: 1004, output: 204 });
      expect((await usage("bob")).find((row) => row.worker === "coder")?.tokens).toEqual({ input: 4, output: 4 });
    } finally {
      await h.state.dispose();
    }
  });

  it("counts a turn the user stopped after its harness ran", async () => {
    // A stop cancels the request's own writes; recording what it spent is
    // how it ended, and must still land.
    const h = host();
    try {
      const { stoppedTurn, usage } = await harnessOf(h);
      await stoppedTurn("alice", "coder", CLAUDE_KEY);

      expect((await usage("alice")).find((row) => row.worker === "coder")?.bySource).toEqual([
        { source: "claude-code", kind: "harness", billing: "api-key", inputTokens: 1000, outputTokens: 200, costUsd: 0.42, runs: 1, unreported: 0 }
      ]);
    } finally {
      await h.state.dispose();
    }
  });

  it("lands two turns that end at once for one worker and day, from two conversations", async () => {
    const h = host();
    try {
      const { turn, usage } = await harnessOf(h);
      await Promise.all([turn("alice", "coder", CLAUDE_KEY, "-a"), turn("alice", "coder", CLAUDE_KEY, "-b")]);

      expect((await usage("alice")).find((row) => row.worker === "coder")?.tokens).toEqual({ input: 2008, output: 408 });
    } finally {
      await h.state.dispose();
    }
  });

  it("keeps a worker that left the roster, marked gone", async () => {
    const stores = inMemoryStores();
    const before = host(["coder", "em"], stores);
    try {
      await (await harnessOf(before)).turn("alice", "coder", CLAUDE_KEY);
    } finally {
      await before.state.dispose();
    }
    const after = host(["em"], stores);
    try {
      const rows = await (await harnessOf(after)).usage("alice");
      expect(rows.map((row) => [row.worker, row.gone, row.tokens.input])).toEqual([["coder", true, 1004]]);
    } finally {
      await after.state.dispose();
    }
  });

  it("reads only the days asked for, counted in UTC days back from today", async () => {
    const h = host();
    try {
      const { turn, usage } = await harnessOf(h);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse("2026-10-19T12:00:00Z"));
      await turn("alice", "coder");
      vi.setSystemTime(Date.parse("2026-10-27T12:00:00Z"));
      await turn("alice", "em");

      expect((await usage("alice", 7)).map((row) => row.worker)).toEqual(["em"]);
      expect((await usage("alice", 30)).map((row) => row.worker)).toEqual(["coder", "em"]);
      expect((await usage("alice", 1)).map((row) => row.worker)).toEqual(["em"]);
      expect(Date.now() - Date.parse("2026-10-19T12:00:00Z")).toBe(8 * DAY);
    } finally {
      await h.state.dispose();
    }
  });
});
