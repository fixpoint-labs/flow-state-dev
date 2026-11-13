// FIX-824.
/**
 * A profile names only slots that do something or have their store on the way.
 * `queue` and `scheduler` backed nothing and have no store coming, so a typed
 * profile that names either fails to compile (`pnpm typecheck` checks the
 * `@ts-expect-error` lines below). `blobs` backs attachments, so a
 * profile with `primary`, `bus` and `blobs` still constructs.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowState, inMemoryStores, type CapabilitySlotMap, type StoreAdapter } from "../../src";
import { createInMemoryBus } from "../../src/host";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";

const adapter = (capabilities: StoreAdapter["capabilities"]): StoreAdapter => ({
  capabilities,
  resolve: async (slots) =>
    slots.includes("bus") ? { bus: createInMemoryBus() } : slots.includes("blobs") ? { blobs: createMemoryBlobStore() } : {}
});

// @ts-expect-error `queue` is not a profile slot: queues come from a worker adapter.
const withQueue: CapabilitySlotMap = { primary: inMemoryStores(), queue: inMemoryStores() };
// @ts-expect-error `scheduler` is not a profile slot: schedules come from the schedule index.
const withScheduler: CapabilitySlotMap = { primary: inMemoryStores(), scheduler: inMemoryStores() };

const flow = defineFlow({
  kind: "slots-flow",
  actions: {
    ping: handler({ name: "ping", inputSchema: z.object({}), execute: () => ({ ok: true }) })
  }
})();

describe("profile slots", () => {
  it("still constructs a profile with primary, bus and blobs", async () => {
    const state = createFlowState({
      flows: [flow],
      stores: { default: { primary: inMemoryStores(), bus: adapter(["bus"]), blobs: adapter(["blobs"]) } }
    });
    await state.ready();
    expect(state.meta.declaredSlots).toEqual({ default: ["primary", "bus", "blobs"] });
    await state.dispose();
  });

  it("names the retired slots only in the expected type errors above", () => {
    expect(Object.keys(withQueue)).toContain("queue");
    expect(Object.keys(withScheduler)).toContain("scheduler");
  });
});
