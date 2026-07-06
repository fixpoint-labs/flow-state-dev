/**
 * Attached durable background-work recovery (investigation for FIX-815 follow-up).
 *
 * FIX-815's spec waved off "attached durable background work" (in-process
 * `.work()` / `.forEachBackground()` that survives a crash WITH a `durable: true`
 * parent) as "already served by FIX-811". FIX-811's own non-goals push durable
 * background work back to FIX-815. FIX-865 flags the open question directly:
 * "does a mid-drain background pool actually continue faithfully today, or get
 * re-run / dropped on continue? This needs to be pinned down."
 *
 * These tests pin it down against the current (post-FIX-811, post-FIX-839)
 * machinery. They use the in-memory store — the best case for trace persistence
 * (FIX-839's drop only affected SQLite/Postgres), so a failure here is a real,
 * adapter-independent gap. The crash is simulated exactly as the FIX-811 crash
 * tests do: suspend a durable sequencer (which drains background work first),
 * flip the record to `interrupted`, then `continueRequest` with no resumeContext.
 *
 * The contract under test: a background block that COMPLETED before the crash
 * must be replayed (its recorded output injected), NOT re-executed, on recovery.
 *
 * Each test asserts BOTH halves of that contract, because they fail independently:
 *   - not re-executed: a run counter stays at its pre-crash value; and
 *   - output injected (not dropped): the gate reads the drained background result
 *     via `ctx.getBlockOutput` and stashes it in its suspension `data`, so the
 *     re-suspension on recovery proves the replayed output is still observable to
 *     a later sibling. A drop-but-don't-re-run regression keeps the counter at 1
 *     yet loses the value, so the counter alone would go green falsely.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { FlowInstance } from "@flow-state-dev/core/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

describe("attached durable background-work recovery", () => {
  it("replays a completed `.work()` background block instead of re-running it on crash recovery", async () => {
    let bgRuns = 0;
    const bg = handler({
      name: "reindex",
      inputSchema: z.any(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: async () => {
        bgRuns += 1;
        return { done: true };
      }
    });
    // The gate reads the drained `.work()` result via getBlockOutput and stashes
    // it in the suspension data, so we can assert the value survives recovery.
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_i, ctx) =>
        ctx.suspend!({
          reason: "human_approval",
          message: "Approve?",
          data: { observed: ctx.getBlockOutput!(bg) }
        })
    });

    const flow = defineFlow({
      kind: "bgwork-crash-work",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .work(bg)
            .waitForWork()
            .step(gate),
          inputSchema: z.any()
        }
      }
    })({ id: "bgwork-crash-work" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    // Background work completed (drained by waitForWork) before the gate suspended,
    // and the gate observed its result.
    expect(bgRuns).toBe(1);
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    const [firstSusp] = await provider.listSuspended({ status: "pending" });
    expect((firstSusp.data as { observed?: unknown }).observed).toEqual({ done: true });

    // Simulate a crash mid-flight: the stale sweeper marks the record interrupted.
    const suspended = await stores.request.get(requestId);
    await stores.request.set(
      requestId,
      { ...suspended!, status: "interrupted", interruptedAt: Date.now() },
      "any"
    );

    // Continue under the same id — crash recovery (no resumeContext). The gate
    // re-runs (re-suspends, no resolution); the background block is replayed.
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    // (a) Not re-executed: a double-fire would push bgRuns to 2.
    expect(bgRuns).toBe(1);
    // (b) Output injected, not dropped: the re-run gate still observed the
    // replayed background result via getBlockOutput. A drop-but-don't-re-run
    // regression keeps bgRuns at 1 but loses this value.
    const pending = await provider.listSuspended({ status: "pending" });
    const reSusp = pending.find((s) => s.suspensionId !== firstSusp.suspensionId);
    expect(reSusp).toBeDefined();
    expect((reSusp!.data as { observed?: unknown }).observed).toEqual({ done: true });
  });

  it("replays completed `.forEachBackground()` iterations instead of re-running them on crash recovery", async () => {
    const elemRuns: Record<string, number> = {};
    const elem = handler({
      name: "reindexOne",
      inputSchema: z.string(),
      outputSchema: z.object({ done: z.boolean() }),
      execute: async (item: string) => {
        elemRuns[item] = (elemRuns[item] ?? 0) + 1;
        return { done: true };
      }
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_i, ctx) =>
        ctx.suspend!({
          reason: "human_approval",
          message: "Approve?",
          // All iterations share the element block name, so getBlockOutput
          // resolves to the most recent completed one — non-undefined proves
          // the fan-out results weren't dropped wholesale on replay.
          data: { observed: ctx.getBlockOutput!(elem) }
        })
    });

    const flow = defineFlow({
      kind: "bgwork-crash-foreach",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true })
            .forEachBackground((v: { items: string[] }) => v.items, elem)
            .waitForWork()
            .step(gate),
          inputSchema: z.object({ items: z.array(z.string()) })
        }
      }
    })({ id: "bgwork-crash-foreach" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { items: ["a", "b", "c"] },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 1 });
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    const [firstSusp] = await provider.listSuspended({ status: "pending" });
    expect((firstSusp.data as { observed?: unknown }).observed).toEqual({ done: true });

    const suspended = await stores.request.get(requestId);
    await stores.request.set(
      requestId,
      { ...suspended!, status: "interrupted", interruptedAt: Date.now() },
      "any"
    );

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    // (a) Every completed fan-out iteration was injected, not re-run.
    expect(elemRuns).toEqual({ a: 1, b: 1, c: 1 });
    // (b) The replayed iteration outputs are still observable on recovery.
    const pending = await provider.listSuspended({ status: "pending" });
    const reSusp = pending.find((s) => s.suspensionId !== firstSusp.suspensionId);
    expect(reSusp).toBeDefined();
    expect((reSusp!.data as { observed?: unknown }).observed).toEqual({ done: true });
  });
});
