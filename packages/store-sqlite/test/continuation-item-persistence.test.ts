/**
 * FIX-865: the `continuation` boundary item the engine emits on crash-recovery
 * `/continue` re-entry must round-trip through a REAL persistent store, not
 * just `createInMemoryStores()` (the only backing the engine's own
 * `continuation-item.test.ts` exercises). Confirms the new item type isn't
 * silently dropped or malformed by SQLite's request-item persistence path
 * (the same path FIX-839 hardened for `block_trace`).
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { ContinuationItem } from "@flow-state-dev/core/items";
import { createCheckpointDurabilityProvider, continueRequest, createFlowRegistry, runAction } from "@flow-state-dev/engine";
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

function continuationItems(items: readonly { type: string }[] | undefined): ContinuationItem[] {
  return ((items ?? []) as ContinuationItem[]).filter((i) => i.type === "continuation");
}

describe("continuation item persists and round-trips through SQLite (FIX-865)", () => {
  let dir: string | undefined;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    // This flow declares no generator intents; an ambient FSDEV_DEFAULT_MODEL/
    // FSDEV_INTENT_* override (e.g. from a dev shell profile) would otherwise
    // make createModelResolver throw on a mismatch it has no bearing on here.
    for (const key of Object.keys(process.env)) {
      if (key === "FSDEV_DEFAULT_MODEL" || key.startsWith("FSDEV_INTENT_")) {
        delete process.env[key];
      }
    }
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("a crash-recovery /continue against a SQLite-backed store persists exactly one continuation item, readable back by a fresh store handle on the same db file", async () => {
    dir = mkdtempSync(join(tmpdir(), "fsdev-continuation-item-"));
    const filename = join(dir, "db.sqlite");

    const preStep = handler({
      name: "preStep",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true })
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_i, ctx) => ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const flow = defineFlow({
      kind: "sqlite-continuation-item",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(preStep).step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "sqlite-continuation-item" });

    // Process A: run to the suspending gate, persisted to disk.
    const stores = createSQLiteStores({ filename });
    const provider = providerFor(stores);
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const suspended = await stores.request.get(requestId);
    expect(suspended?.status).toBe("suspended");
    const priorItemCount = suspended!.items!.length;

    // Simulate the crash: flip the record to `interrupted`, as the stale-request
    // sweeper would after a real process death, then close this store handle.
    await stores.request.set(requestId, { ...suspended!, status: "interrupted", interruptedAt: Date.now() }, "any");
    stores.close();

    // Process B: a FRESH store handle over the SAME db file — the actual
    // cross-restart shape — continues the interrupted request.
    const freshStores = createSQLiteStores({ filename });
    const freshProvider = providerFor(freshStores);
    const registry = createFlowRegistry();
    registry.register(flow as never);

    const { finished } = await continueRequest({
      requestId,
      stores: freshStores,
      flowRegistry: registry,
      runtimeConfig: { durabilityProvider: freshProvider }
    });
    await finished;

    const after = await freshStores.request.get(requestId);
    const items = continuationItems(after?.items);
    expect(items).toHaveLength(1);
    expect(items[0].trigger).toBe("recovery");
    expect(items[0].priorItemCount).toBe(priorItemCount);

    // Read back via yet another fresh handle — proves the row (and the new
    // item type within its JSON items column) actually round-trips, not just
    // survives within the same in-memory `freshStores` instance.
    freshStores.close();
    const readBackStores = createSQLiteStores({ filename });
    const readBack = await readBackStores.request.get(requestId);
    const readBackItems = continuationItems(readBack?.items);
    expect(readBackItems).toHaveLength(1);
    expect(readBackItems[0].priorItemCount).toBe(priorItemCount);
    readBackStores.close();
  });
});
