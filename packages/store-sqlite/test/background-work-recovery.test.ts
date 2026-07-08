/**
 * FIX-866 Contract C — a completed `.work()` background block that finished
 * BEFORE a crash must be REPLAYED (its recorded output injected), not re-run,
 * on `continueRequest` against a REAL persistent store.
 *
 * This is the cross-store counterpart of the in-memory engine coverage
 * (`packages/engine/test/background-work-recovery.test.ts`). Background
 * `block_trace` items ride the SAME request-store persistence path as
 * foreground traces, so this confirms FIX-839's content-diff persistence fix
 * (`request-store.ts`) covers `phase:"work"` traces too.
 *
 * The scenario deliberately satisfies four preconditions, each of which the
 * test would otherwise pass vacuously:
 *   1. `.waitForWork()` barrier BEFORE the suspending gate, so the `.work()`
 *      actually completes pre-crash. Without it the fire-and-forget task could
 *      still be in flight when the gate suspends — that is an in-flight task
 *      that correctly re-runs (Contract A), NOT completed-trace replay.
 *   2. The work handler emits an intervening non-transient `item.done` while its
 *      own `block_trace` is still `in_progress`, then awaits a macrotask so that
 *      in_progress trace flushes to the store before the block completes. This
 *      is the exact FIX-839 trigger: the trace's in-place mutation to
 *      `completed` (same object reference, new content) would be diffed away by
 *      a reference-equality persistence diff, leaving the row `in_progress`.
 *   3. `FSDEV_TRACE_OBSERVABILITY=true` — `block_trace` capture (the ReplayLog's
 *      only source) is gated off otherwise, so the completed work would retain
 *      no trace and re-run, proving nothing about replay.
 *   4. Recovery via the REACHABLE `/resume` cold-restart path: a fresh store
 *      registry on the SAME db file (no in-memory continuation state),
 *      pre-resolve the gate suspension, `continueRequest` WITH a `resumeContext`.
 *      (NOT the unreachable suspended→`interrupted` flip — the sweeper never
 *      produces that state for a gate-suspended request.)
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { buildItemLookup, resolveBlockValue } from "@flow-state-dev/core/items";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  runAction
} from "@flow-state-dev/engine";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/engine";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createSQLiteStores } from "../src/index";

function providerFor(stores: StoreRegistry): DurabilityProvider {
  return createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
}

/** The background `.work()` block_trace: keyed by its unique block name and its
 *  `phase:"work"` provenance, so it can't be confused with the gate/sequencer
 *  traces. */
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

describe("completed background `.work()` trace replays across a cold restart (FIX-866 Contract C)", () => {
  let dir: string | undefined;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      dir = undefined;
    }
  });

  it("injects the completed `.work()` result instead of re-running the handler", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-bgwork-recovery-"));
    const filename = join(dir, "request.db");

    let bgRuns = 0;
    const bg = handler({
      name: "reindex",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean(), runs: z.number() }),
      execute: async (_input, ctx) => {
        const runs = (bgRuns += 1);
        // Intervening non-transient item.done: flushes the enclosing
        // in_progress block_trace to the store BEFORE this block completes.
        ctx.emit.message("reindexing...");
        // Drain the coalesced persistItems microtask so the in_progress trace
        // reference is recorded prior to this block's completion mutation —
        // exactly the FIX-839 content-diff trigger, now for a phase:"work" trace.
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
      kind: "bgwork-recovery",
      actions: {
        run: {
          // `.waitForWork()` drains the pool before the gate, so `.work()` is
          // guaranteed COMPLETE (Contract C), not in-flight (Contract A).
          block: sequencer({ name: "seq", durable: true })
            .work(bg)
            .waitForWork()
            .step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-recovery" });

    // Process 1: run, drain the background work, park at the gate.
    const storesA = createSQLiteStores({ filename });
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

    // The background work ran exactly once and completed before the suspension.
    expect(bgRuns).toBe(1);
    const recordA = await storesA.request.get(requestId);
    expect(recordA?.status).toBe("suspended");

    // The intervening item.done flushed (proves the content-diff path was
    // exercised, not a bare already-completed trace), and the background trace
    // persisted as `completed` — NOT stuck at `in_progress` (the FIX-839 bug).
    const items = recordA?.items ?? [];
    expect(items.some((i) => i.type === "message")).toBe(true);
    const bgTraceA = backgroundTrace(items);
    expect(bgTraceA).toBeDefined();
    expect(bgTraceA!.status).toBe("completed");

    // Simulate process exit — drop every in-memory handle to the db.
    storesA.close();

    // Process 2 (cold restart): fresh registry on the SAME file, no in-memory
    // continuation state. The completed background trace must still be durable.
    const storesB = createSQLiteStores({ filename });
    const providerB = providerFor(storesB);
    const recordB = await storesB.request.get(requestId);
    expect(recordB?.status).toBe("suspended");
    expect(backgroundTrace(recordB?.items ?? [])!.status).toBe("completed");

    // Recover via the reachable /resume path: pre-resolve the gate suspension,
    // continue WITH a resumeContext (the shape the resume route drives).
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

    // (b) The recorded output survived recovery: the persisted completed trace
    // still carries the pre-crash result (runs: 1).
    const finalItems = (await storesB.request.get(requestId))?.items ?? [];
    const finalBg = backgroundTrace(finalItems);
    expect(finalBg?.status).toBe("completed");
    const lookup = buildItemLookup(finalItems as never);
    expect(resolveBlockValue(finalBg!.output as never, lookup)).toEqual({
      done: true,
      runs: 1
    });

    storesB.close();
  });
});
