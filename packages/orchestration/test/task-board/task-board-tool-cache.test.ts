/**
 * Task Board tool-cache wiring (FIX-610 Layer B).
 *
 * Exercises the patterns-side contract: the board's installFlowState
 * handler writes the cache-store resolver onto `ctx.request.state`,
 * and any nested execution scope — `.forEach` iterations, worker
 * sequencers, handler bodies — resolves the same store from there.
 *
 * The worker simulates what the substrate's `wrapToolExecuteWithCache`
 * does inside a generator: build a canonical key from the args, look
 * up the bound store, miss-then-store on the first call, hit on the
 * second. This proves the cache binding propagates through every
 * scope without needing the AI SDK loop in this test.
 */
import { describe, expect, it } from "vitest";
import {
  handler,
  canonicalizeToolArgs,
  type ToolCacheStore,
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import type { TaskWorker } from "../../src/tasks";

import { taskBoard, taskWorkerInputSchema } from "../../src/task-board";

const RESOLVER_BAG_KEY = "__fsd_fix610_resolverBag";
const STORE_SLOT = "resolveToolCacheStore";
const WRITER_SLOT = "writeToolObservation";

function readResolverBag(ctx: BlockContext): Record<string, unknown> | undefined {
  const req = ctx.request as unknown as Record<string, unknown>;
  const bag = req[RESOLVER_BAG_KEY];
  return typeof bag === "object" && bag !== null ? (bag as Record<string, unknown>) : undefined;
}

function readBoundCacheStore(ctx: BlockContext): ToolCacheStore | undefined {
  const bag = readResolverBag(ctx);
  const resolver = bag?.[STORE_SLOT];
  return typeof resolver === "function"
    ? (resolver as () => ToolCacheStore | undefined)()
    : undefined;
}

function recordObservation(
  ctx: BlockContext,
  payload: { toolName: string; args: unknown; result?: unknown; cached: boolean },
): void {
  const bag = readResolverBag(ctx);
  const writer = bag?.[WRITER_SLOT];
  if (typeof writer === "function") {
    (writer as (p: typeof payload) => void)(payload);
  }
}

describe("taskBoard - tool-cache wiring", () => {
  it("shares a per-run cache store across tasks; identical calls execute once", async () => {
    let executions = 0;
    const toolArgs = { topic: "x", limit: 5 };
    const toolName = "lookup";
    const seenStores = new Set<ToolCacheStore>();
    const observedHitOnSecondTask = { value: false };

    const cacheableWorker: TaskWorker = handler({
      name: "cacheable-worker",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.object({ cached: z.boolean() }),
      execute: (input, ctx) => {
        const store = readBoundCacheStore(ctx);
        if (store === undefined) {
          throw new Error("tool cache store was not bound on ctx.request.state");
        }
        seenStores.add(store);

        const key = `run:r:${toolName}:${canonicalizeToolArgs(toolArgs)}`;
        const hit = store.get(key);
        if (hit !== undefined) {
          if (input.taskId === "t2") observedHitOnSecondTask.value = true;
          recordObservation(ctx, {
            toolName,
            args: toolArgs,
            result: hit.output,
            cached: true,
          });
          return { cached: true };
        }

        executions++;
        const output = { echoed: toolArgs };
        store.set(key, { output, storedAt: Date.now(), toolName });
        recordObservation(ctx, {
          toolName,
          args: toolArgs,
          result: output,
          cached: false,
        });
        return { cached: false };
      },
    }) as TaskWorker;

    const board = taskBoard({
      name: "cache-board",
      collection: { collectionId: "cache" },
      // Serial execution so the second task deterministically observes
      // the first task's write — no in-flight join race.
      concurrency: 1,
      workers: cacheableWorker,
      toolCache: true,
      initialTasks: [
        { id: "t1", goal: "first call", assignee: "cacheable-worker" },
        { id: "t2", goal: "second call", assignee: "cacheable-worker" },
      ],
    });

    const result = await testBlock(board.block, { input: undefined });
    expect(result.error).toBeNull();

    expect(seenStores.size).toBe(1);
    expect(executions).toBe(1);
    expect(observedHitOnSecondTask.value).toBe(true);
  });
});
