/**
 * Conformance: parking a turn leaves its gate on the request's own item log.
 *
 * The durability sweep re-drives a request left parked behind a resolved gate
 * only when that gate is the request's latest, which it reads off the last
 * `suspension` item on the request record (`durability/stop-suspended.ts`).
 * So every request store must return, from `get`, the `suspension` item a park
 * wrote, and in order: after a second park, the second gate is the last one.
 *
 * Runs the real `runAction` against the adapter's registry, as a turn parks in
 * production.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import type { StoreRegistry } from "../types";
import { createCheckpointDurabilityProvider } from "../../durability/checkpoint-durability-provider";
import { runAction } from "../../execution/runAction";
import { continueRequest } from "../../execution/request-continuation";
import { createFlowRegistry } from "../../registry/flow-registry";
import type { RuntimeConfig } from "../../runtime-config";

export type CreateParkedGateConformanceTestsOptions = {
  name: string;
  /** A fresh registry on an empty store. */
  createStores: () => StoreRegistry | Promise<StoreRegistry>;
};

/** The suspension ids on a request's item log, in log order. */
async function gatesOnLog(stores: StoreRegistry, requestId: string): Promise<string[]> {
  const record = await stores.request.get(requestId);
  return (record?.items ?? [])
    .filter((item) => (item as { type?: string }).type === "suspension")
    .map((item) => (item as { suspensionId?: string }).suspensionId ?? "");
}

export function createParkedGateConformanceTests(options: CreateParkedGateConformanceTestsOptions): void {
  describe(`${options.name}: a park writes its gate to the request's item log`, () => {
    it("the parked request's record carries the gate, and after a second park the second gate is last", async () => {
      const stores = await options.createStores();
      const provider = createCheckpointDurabilityProvider(stores);
      const gate = (suspensionId: string) =>
        handler({
          name: suspensionId,
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: async (_i, ctx) => ctx.suspend!({ reason: "human_approval", suspensionId })
        });
      const flow = defineFlow({
        kind: "parked-gate-conformance",
        actions: {
          run: { block: sequencer({ name: "s" }).step(gate("gate_first")).step(gate("gate_second")) }
        }
      })({ id: "parked-gate-conformance" });
      const registry = createFlowRegistry();
      registry.register(flow as never);
      const runtimeConfig: RuntimeConfig = { durabilityProvider: provider };

      const first = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: {},
        userId: "u_conformance",
        sessionId: "s_conformance",
        stores,
        runtimeConfig
      });
      const requestId = first.requestId!;
      expect((await stores.request.get(requestId))?.status).toBe("suspended");
      expect(await gatesOnLog(stores, requestId)).toEqual(["gate_first"]);

      const firstGate = await provider.loadSuspension(requestId, "gate_first");
      await provider.suspend({ ...firstGate!, status: "approved", resolvedAt: Date.now() });
      const resumed = await continueRequest({
        requestId,
        stores,
        flowRegistry: registry,
        runtimeConfig,
        resumeContext: { suspensionId: "gate_first", action: "approve" }
      });
      await resumed.finished;
      expect((await stores.request.get(requestId))?.status).toBe("suspended");
      expect((await gatesOnLog(stores, requestId)).at(-1)).toBe("gate_second");
    });
  });
}
