/**
 * Regression tests for FIX-744: distinct-key resource-collection writes issued
 * from concurrent (parallel / forEach) branches must all survive into the
 * same-request in-memory scope cache — not just the durable store.
 *
 * The hazard: each single-key write used to snapshot the whole scope map, await
 * a store write, then replace the entire live cache ref with its stale snapshot.
 * Two concurrent distinct-key writes each snapshot the pre-write map and the
 * last persist clobbered the sibling's key in cache, so a post-fan-out `.list()`
 * saw fewer instances than were written. The store was always correct (per-key
 * `.set`); only the in-memory view a convergence read sees was stale.
 *
 * These tests drive concurrency two ways: directly via `Promise.all` over one
 * execution context (the tight, deterministic reproduction — the awaited
 * in-memory store `.set` supplies the microtask yield that interleaves the
 * writes), and end-to-end through a `.forEach` sequencer fan-out whose
 * convergence step reads `.list()` in the same request.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  defineResourceCollection,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

const memoSchema = z.object({ status: z.string() });

const memosCollection = defineResourceCollection({
  scope: "session",
  pattern: "memos/**",
  stateSchema: memoSchema,
  maxInstances: 50,
  eviction: "none"
});

function makeCtx() {
  const stores = createInMemoryStores();
  const flow = defineFlow({
    kind: "fix744-coll",
    actions: {
      run: {
        inputSchema: z.string(),
        block: handler({ name: "noop", resources: { memos: memosCollection }, execute: () => "ok" })
      }
    }
  })();
  return createExecutionContext({
    flow,
    actionName: "run",
    requestId: "req_1",
    sessionId: "sess_1",
    userId: "user_1",
    stores
  }).then((ctx) => ({ ctx, stores }));
}

function memosNs(ctx: any): ResourceCollectionRef<{ status: string }> {
  return ctx.resources.memos as any;
}

describe("FIX-744: parallel distinct-key collection writes survive in cache", () => {
  it("Promise.all of N distinct create()s: post-fan-out list() sees all N", async () => {
    const { ctx, stores } = await makeCtx();
    const ns = memosNs(ctx);
    const N = 5;

    await Promise.all(
      Array.from({ length: N }, (_, i) => ns.create(String(i), { status: "done" }))
    );

    const all = await ns.list();
    expect(all.map((r) => r.path).sort()).toEqual(
      Array.from({ length: N }, (_, i) => `memos/${i}`).sort()
    );
    expect(all).toHaveLength(N);

    // The durable store was always correct — this asserts the bug was
    // cache-only, so a regression that reintroduces it is unambiguous.
    const stored = await stores.resourceState.getAll("session", "sess_1");
    expect(Object.keys(stored).filter((k) => k.startsWith("memos/"))).toHaveLength(N);
  });

  it("forEach fan-out through runAction: convergence read sees all N", async () => {
    const N = 5;
    let seenByConvergence = -1;

    const writeMemo = (i: number) =>
      handler({
        name: `write-memo-${i}`,
        inputSchema: z.number(),
        outputSchema: z.object({ key: z.string() }),
        resources: { memos: memosCollection },
        execute: async (_input, ctx: any) => {
          await ctx.resources.memos.create(String(i), { status: "done" });
          return { key: `memos/${i}` };
        }
      });

    // .tap convergence: state-mutation-free read of the live cache (BP-012).
    const converge = handler({
      name: "converge",
      resources: { memos: memosCollection },
      execute: async (_input, ctx: any) => {
        const all = await ctx.resources.memos.list();
        seenByConvergence = all.length;
      }
    });

    const pipeline = sequencer({ name: "fanout", inputSchema: z.array(z.number()) })
      .forEach((item: number) => writeMemo(item))
      .tap(converge);

    const flow = defineFlow({
      kind: "fix744-fanout",
      actions: { run: { inputSchema: z.array(z.number()), block: pipeline } }
    })();

    const stores = createInMemoryStores();
    const response = createResponseEmitter({ requestId: "req_2", now: () => Date.now() });
    await runAction({
      flow,
      actionName: "run",
      input: Array.from({ length: N }, (_, i) => i),
      userId: "u",
      sessionId: "s",
      stores,
      responseEmitter: response,
      runtimeConfig: {}
    });

    expect(seenByConvergence).toBe(N);
  });

  it("Promise.all of distinct writeContent()s: each readContent survives in cache", async () => {
    const { ctx } = await makeCtx();
    const ns = memosNs(ctx);

    const refA = await ns.create("a", { status: "done" });
    const refB = await ns.create("b", { status: "done" });

    await Promise.all([refA.writeContent("body-a"), refB.writeContent("body-b")]);

    expect(await refA.readContent()).toBe("body-a");
    expect(await refB.readContent()).toBe("body-b");
  });
});
