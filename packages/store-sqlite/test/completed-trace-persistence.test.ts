/**
 * FIX-839: a block that ran to completion BEFORE a suspension must persist a
 * `completed` block_trace, so resume memoization (`ReplayLog.getCompletedOutput`)
 * skips the already-finished block on replay instead of re-running it.
 *
 * Trigger: a step that emits an intervening non-transient `item.done` while its
 * own block_trace is still `in_progress`. The intervening item.done flushes the
 * in_progress trace to `request_items`; the trace's later in-place mutation to
 * `completed` (same object reference) was — before the fix — diffed away by the
 * store's reference-equality persistence diff, leaving the row at `in_progress`.
 * A streaming generator is the real-world shape (its mid-run message/reasoning
 * item.done events do this); a handler emitting one message reproduces it
 * deterministically without a model.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import { createCheckpointDurabilityProvider, runAction } from "@flow-state-dev/server";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/server";
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

describe("completed block traces persist on a suspended request (FIX-839)", () => {
  let dir: string | undefined;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // block_trace capture is gated on trace observability; force it on so the
    // persisted traces exist deterministically regardless of NODE_ENV.
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

  it("a non-suspending step that ran before the suspension records a completed trace", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsd-trace-persist-"));
    const filename = join(dir, "request.db");

    const completesFirst = handler({
      name: "completes-first",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        // Intervening non-transient item.done: flushes the enclosing
        // in_progress block_trace to the store before this block completes.
        ctx.emit.message("working...");
        // Drain the coalesced persistItems microtask so the in_progress trace
        // reference is recorded prior to this block's completion mutation.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { ok: true };
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
      kind: "trace-persist",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .step(completesFirst)
            .step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "trace-persist" });

    const stores = createSQLiteStores({ filename });
    const provider = providerFor(stores);
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = result.requestId!;
    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("suspended");

    const traces = (record?.items ?? []).filter(
      (i): i is BlockTraceItem => i.type === "block_trace"
    );
    const completed = traces.filter((t) => t.status === "completed");

    // The issue's observation was "every trace in_progress, zero completed".
    // The non-suspending first step ran to completion, so its trace must
    // persist as completed.
    expect(completed.length).toBeGreaterThan(0);
    // The suspending gate's trace legitimately stays in_progress — the fix
    // must not coerce traces, only persist the content they actually carry.
    expect(traces.length).toBeGreaterThan(completed.length);

    stores.close();
  });
});
