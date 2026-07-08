/**
 * FIX-866 Contract C (Postgres/PGlite mirror) — a completed `.work()` background
 * block that finished BEFORE a crash must be REPLAYED (its recorded output
 * injected), not re-run, on `continueRequest` against the REAL Postgres store.
 *
 * This is the structural twin of the SQLite test
 * (`packages/store-sqlite/test/background-work-recovery.test.ts`) and the
 * in-memory engine coverage. Background `block_trace` items ride the same
 * request-store persistence path as foreground traces, so this confirms
 * FIX-839's content-diff persistence fix (`request-store.ts`) covers
 * `phase:"work"` traces on Postgres too.
 *
 * IMPORTANT — the replay source is the REQUEST RECORD's items (durable in the
 * `request_items` table), NOT the Postgres `TraceStore` (which is in-memory —
 * Postgres has no durable trace store). So every assertion reads
 * `stores.request.get(requestId)`'s items, exactly as SQLite does.
 *
 * The scenario satisfies the same four preconditions as the SQLite test:
 *   1. `.waitForWork()` barrier before the gate → `.work()` is COMPLETE
 *      pre-crash (Contract C), not in-flight (Contract A).
 *   2. Intervening non-transient `item.done` while the work `block_trace` is
 *      still `in_progress`, plus a macrotask await, so the in_progress trace
 *      flushes before completion — the FIX-839 content-diff trigger.
 *   3. `FSDEV_TRACE_OBSERVABILITY=true` — `block_trace` capture is gated off
 *      otherwise.
 *   4. Reachable `/resume` cold restart: a fresh `createPostgresStores` on the
 *      SAME PGlite instance (fresh in-memory persistence maps, same durable
 *      tables), pre-resolve the gate suspension, continue WITH a `resumeContext`.
 */
import { PGlite } from "@electric-sql/pglite";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { buildItemLookup, resolveBlockValue } from "@flow-state-dev/core/items";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry
} from "@flow-state-dev/engine";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/engine";
import { runAction } from "@flow-state-dev/engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createPostgresStores, type QueryExecutor } from "../src";

/** Wrap PGlite to match the QueryExecutor interface (same shape as stores.test.ts). */
function pgliteExecutor(pglite: PGlite): QueryExecutor {
  return {
    async query(text: string, values?: unknown[]) {
      const result = await pglite.query(text, values);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? 0
      };
    }
  };
}

function providerFor(stores: StoreRegistry): DurabilityProvider {
  return createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
}

/** The background `.work()` block_trace, keyed by its unique block name and its
 *  `phase:"work"` provenance. */
function backgroundTrace(
  items: readonly { type: string }[]
): BlockTraceItem | undefined {
  return (items as BlockTraceItem[]).find(
    (i) =>
      i.type === "block_trace" &&
      i.blockName === "reindex" &&
      i.provenance?.phase === "work"
  );
}

describe("completed background `.work()` trace replays across a cold restart on Postgres (Contract C)", () => {
  let pglite: PGlite | undefined;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(async () => {
    process.env = { ...originalEnv };
    await pglite?.close();
    pglite = undefined;
  });

  it("injects the completed `.work()` result instead of re-running the handler", async () => {
    // A single in-memory PGlite instance is the durable "database file"; a fresh
    // `createPostgresStores` on it models the cold restart.
    pglite = new PGlite();
    const executor = pgliteExecutor(pglite);

    let bgRuns = 0;
    const bg = handler({
      name: "reindex",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean(), runs: z.number() }),
      execute: async (_input, ctx) => {
        const runs = (bgRuns += 1);
        // Intervening non-transient item.done: flushes the enclosing
        // in_progress block_trace to `request_items` before this block
        // completes — the FIX-839 content-diff trigger for a phase:"work" trace.
        ctx.emit.message("reindexing...");
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { done: true, runs };
      }
    });
    const gate = handler({
      name: "approval-gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "approve?" })
    });

    const flow = defineFlow({
      kind: "bgwork-recovery-pg",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .work(bg)
            .waitForWork()
            .step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-recovery-pg" });

    // Process 1: run, drain the background work, park at the gate.
    const storesA = await createPostgresStores({ executor });
    const providerA = providerFor(storesA);
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores: storesA,
      runtimeConfig: { durabilityProvider: providerA }
    });
    const requestId = initial.requestId!;

    expect(bgRuns).toBe(1);
    const recordA = await storesA.request.get(requestId);
    expect(recordA?.status).toBe("suspended");

    const items = recordA?.items ?? [];
    expect(items.some((i) => i.type === "message")).toBe(true);
    const bgTraceA = backgroundTrace(items);
    expect(bgTraceA).toBeDefined();
    expect(bgTraceA!.status).toBe("completed");

    // Simulate process exit — drop the in-memory store handles (but NOT the
    // PGlite instance, which is the durable db). `close()` must not close the
    // shared executor's underlying PGlite.
    await storesA.close();

    // Process 2 (cold restart): fresh store registry (fresh persistence maps) on
    // the SAME PGlite instance / same durable tables.
    const storesB = await createPostgresStores({ executor, skipSchemaInit: true });
    const providerB = providerFor(storesB);
    const recordB = await storesB.request.get(requestId);
    expect(recordB?.status).toBe("suspended");
    expect(backgroundTrace(recordB?.items ?? [])!.status).toBe("completed");

    const [susp] = await providerB.listSuspended({ status: "pending" });
    await providerB.suspend({ ...susp, status: "approved", resolvedAt: Date.now() });

    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId,
      stores: storesB,
      flowRegistry: registry,
      resumeContext: {
        suspensionId: susp.suspensionId,
        action: "approve",
        data: undefined,
        resumedBy: "reviewer"
      },
      runtimeConfig: { durabilityProvider: providerB }
    });
    await finished;

    expect((await storesB.request.get(requestId))?.status).toBe("completed");

    // (a) INJECTED, not re-run: a double-fire would push bgRuns to 2.
    expect(bgRuns).toBe(1);

    // (b) The recorded output survived recovery.
    const finalItems = (await storesB.request.get(requestId))?.items ?? [];
    const finalBg = backgroundTrace(finalItems);
    expect(finalBg?.status).toBe("completed");
    const lookup = buildItemLookup(finalItems as never);
    expect(resolveBlockValue(finalBg!.output as never, lookup)).toEqual({
      done: true,
      runs: 1
    });

    await storesB.close();
  });
});
