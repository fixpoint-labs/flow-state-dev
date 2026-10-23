/**
 * A person's stop expires at its deadline while a server runs, not on the
 * ten-minute interval (FIX-2063 D3): one left in the store before the sweeper
 * started, and one parked after.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStores } from "../src/stores";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createDurabilitySweeper } from "../src/durability/durability-sweeper";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { runAction } from "../src";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function approval(id: string, expiresAt: number): SuspensionRecord {
  return {
    suspensionId: id,
    requestId: `req_${id}`,
    flowKind: "review",
    actionName: "submit",
    userId: "devuser",
    reason: "human_approval",
    message: "Publish?",
    status: "pending",
    blockInstanceId: "seq_1",
    stepIndex: 1,
    createdAt: Date.now(),
    expiresAt
  };
}

async function statusWithin(read: () => Promise<string | undefined>, ms: number): Promise<string | undefined> {
  const until = Date.now() + ms;
  let status = await read();
  while (status === "pending" && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50));
    status = await read();
  }
  return status;
}

describe("durability sweeper: a person's deadline", () => {
  it("expires an approval left in the store before the server started, at its deadline", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider(stores);
    await provider.suspend(approval("a", Date.now() + 300));

    const sweeper = createDurabilitySweeper({
      provider,
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      continueRequest: (async () => ({ finished: Promise.resolve() })) as never
    });
    disposers.push(() => sweeper.dispose());

    const status = await statusWithin(async () => (await provider.loadSuspension("req_a", "a"))?.status, 3_000);
    expect(status).toBe("expired");
  });

  it("expires an approval this process parks after the server started, at its deadline", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider(stores);
    // Started with nothing pending, so the timer is armed for the interval.
    const sweeper = createDurabilitySweeper({
      provider,
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      continueRequest: (async () => ({ finished: Promise.resolve() })) as never
    });
    disposers.push(() => sweeper.dispose());
    await new Promise((r) => setTimeout(r, 100));

    const gated = handler({
      name: "gated",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_i, ctx) => ctx.suspend!({ reason: "human_approval", message: "Publish?", timeoutMs: 500 })
    });
    const flow = defineFlow({ kind: "review", actions: { submit: { block: sequencer({ name: "seq" }).step(gated) } } })({
      id: "review"
    });
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "submit",
      input: {},
      userId: "devuser",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    } as never);
    const [gate] = await provider.listSuspended({ status: "pending" });
    expect(gate?.requestId).toBe(result.requestId);

    const status = await statusWithin(async () => (await provider.loadSuspension(gate!.requestId, gate!.suspensionId))?.status, 3_000);
    expect(status).toBe("expired");
  });

  it("retries an overdue approval shortly when another holder had its lease, not an interval later", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider(stores);
    await provider.suspend(approval("c", Date.now() - 100));
    // Held past the first retry tick (5 s), released well before the interval.
    await provider.acquireLease("req_c", { holder: "someone-else", durationMs: 6_500 });

    const sweeper = createDurabilitySweeper({
      provider,
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      continueRequest: (async () => ({ finished: Promise.resolve() })) as never
    });
    disposers.push(() => sweeper.dispose());

    const status = await statusWithin(async () => (await provider.loadSuspension("req_c", "c"))?.status, 14_000);
    expect(status).toBe("expired");
  }, 20_000);

  it("OFF STATE: an approval with no deadline stays pending", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider(stores);
    await provider.suspend({ ...approval("b", 0), expiresAt: undefined });

    const sweeper = createDurabilitySweeper({
      provider,
      stores,
      retention: { sweepIntervalMs: 600_000 },
      prune: false,
      continueRequest: (async () => ({ finished: Promise.resolve() })) as never
    });
    disposers.push(() => sweeper.dispose());

    await new Promise((r) => setTimeout(r, 1_500));
    expect((await provider.loadSuspension("req_b", "b"))?.status).toBe("pending");
  });
});
