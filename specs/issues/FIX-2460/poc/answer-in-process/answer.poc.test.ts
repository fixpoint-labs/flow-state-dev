/**
 * POC for the testing package's durability spec — retained design evidence,
 * not production code. Run with `bash run.sh` from this directory's parent
 * repo root (see README.md).
 *
 * The question: can the published testing package run an action that calls
 * `ctx.suspendForUser`, over in-memory stores, see it park, and answer the
 * stop through the engine's OWN answer route (no second answer path), using
 * only entries the engine already exports? And what does `testFlow` do with
 * that action today?
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  createInProcessFetch,
  disposeFlowApiRouter,
  resolveDurabilityProvider,
  runAction
} from "@flow-state-dev/engine";
import { z } from "zod";
import { testFlow } from "../src";

const USER = "u1";

/** An approval step: does work, asks the user, returns what came back. */
function approvalFlow(seen: string[]) {
  const draft = handler({
    name: "draft",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.object({ amount: z.number() }),
    execute: async (input) => {
      seen.push("draft");
      return input;
    }
  });
  const approve = handler({
    name: "approve",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.any(),
    execute: async (input, ctx) => {
      const answer = await ctx.suspendForUser({ kind: "approval", prompt: `Refund ${input.amount}?` });
      seen.push(`answered:${JSON.stringify(answer)}`);
      return { refunded: "approved" in answer && answer.approved ? input.amount : 0 };
    }
  });
  return defineFlow({
    kind: "refunds",
    actions: { refund: { block: sequencer({ name: "refund" }).step(draft).step(approve) } }
  })({ id: "refunds" });
}

async function settled(stores: ReturnType<typeof createInMemoryStores>, requestId: string) {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record && ["completed", "failed", "aborted", "incomplete"].includes(record.status)) return record;
    await new Promise((r) => setTimeout(r, 10));
  }
  return stores.request.get(requestId);
}

describe("POC · answering a user stop in a test", () => {
  it("control · testFlow today cannot park the stop", async () => {
    const seen: string[] = [];
    const run = await testFlow({ flow: approvalFlow(seen), action: "refund", input: { amount: 5 }, userId: USER });
    console.log("[control] testFlow status:", run.status, "error:", run.error?.message);
    expect(run.status).not.toBe("suspended");
  });

  it("durable in-memory run parks, and the engine's answer route resumes it", async () => {
    const seen: string[] = [];
    const flow = approvalFlow(seen);
    const stores = createInMemoryStores();
    const durabilityProvider = resolveDurabilityProvider({ stores, durable: true })!;
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const router = createFlowApiRouter({
      registry,
      stores,
      durabilityProvider,
      staleSweepIntervalMs: 0
    } as never);

    try {
      const first = await runAction({
        flow,
        actionName: "refund",
        input: { amount: 5 },
        userId: USER,
        sessionId: "s1",
        orgId: DEFAULT_ORG_ID,
        stores,
        runtimeConfig: { durabilityProvider }
      } as never);
      const requestId = (first as { requestId: string }).requestId;
      const parked = await stores.request.get(requestId);
      const [stop] = (await durabilityProvider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
      console.log("[park] status:", parked?.status, "stop:", JSON.stringify({ id: stop?.suspensionId, kind: (stop as { kind?: string })?.kind, allow: (stop as { allow?: unknown })?.allow }));
      expect(parked?.status).toBe("suspended");
      expect(stop).toBeDefined();

      const fetcher = createInProcessFetch(router);
      const res = await fetcher(`/api/flows/refunds/requests/${requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER, suspensionId: stop!.suspensionId, action: "approve" })
      });
      console.log("[answer] route status:", res.status, await res.text());
      expect(res.status).toBe(202);

      const done = await settled(stores, requestId);
      console.log("[after] status:", done?.status, "result:", JSON.stringify(done?.result), "seen:", seen);
      expect(done?.status).toBe("completed");
      expect(seen[0]).toBe("draft");
      expect(seen[1]).toContain('"approved":true');
      expect(done?.result).toEqual({ output: { refunded: 5 } });

      // The route's own refusals come with it: a second answer is already resolved.
      const again = await fetcher(`/api/flows/refunds/requests/${requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER, suspensionId: stop!.suspensionId, action: "approve" })
      });
      console.log("[refusal] second answer:", again.status, await again.text());
      expect(again.status).toBe(409);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("control · the same answer with no durability provider is refused by the route", async () => {
    const seen: string[] = [];
    const flow = approvalFlow(seen);
    const stores = createInMemoryStores();
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const router = createFlowApiRouter({ registry, stores, staleSweepIntervalMs: 0 } as never);
    try {
      const first = await runAction({
        flow, actionName: "refund", input: { amount: 5 }, userId: USER, sessionId: "s1",
        orgId: DEFAULT_ORG_ID, stores, runtimeConfig: {}
      } as never);
      const requestId = (first as { requestId: string }).requestId;
      const status = (await stores.request.get(requestId))?.status;
      const res = await createInProcessFetch(router)(`/api/flows/refunds/requests/${requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER, suspensionId: "none", action: "approve" })
      });
      console.log("[control-2] run status:", status, "answer:", res.status, await res.text());
      expect(status).not.toBe("suspended");
      expect(res.status).not.toBe(202);
    } finally {
      await disposeFlowApiRouter(router);
    }
  });

  it("a developer's own ctx.suspend parks the same way and the engine's resume route continues it", async () => {
    const seen: string[] = [];
    const wait = handler({
      name: "wait",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        const got = await ctx.suspend!({ reason: "external_event", message: "waiting on a webhook" });
        seen.push(`resumed:${JSON.stringify(got)}`);
        return { got };
      }
    });
    const flow = defineFlow({ kind: "hooks", actions: { run: { block: wait } } })({ id: "hooks" });
    const stores = createInMemoryStores();
    const durabilityProvider = resolveDurabilityProvider({ stores, durable: true })!;
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const router = createFlowApiRouter({ registry, stores, durabilityProvider, staleSweepIntervalMs: 0 } as never);
    try {
      const first = await runAction({
        flow, actionName: "run", input: {}, userId: USER, sessionId: "s2",
        orgId: DEFAULT_ORG_ID, stores, runtimeConfig: { durabilityProvider }
      } as never);
      const requestId = (first as { requestId: string }).requestId;
      const parked = await stores.request.get(requestId);
      const [stop] = (await durabilityProvider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
      console.log("[suspend] status:", parked?.status, "source:", parked?.source, "stop:", stop?.suspensionId);
      expect(parked?.status).toBe("suspended");
      const res = await createInProcessFetch(router)(`/api/flows/hooks/requests/${requestId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: USER, suspensionId: stop!.suspensionId, action: "approve", data: { ok: true } })
      });
      console.log("[resume] route status:", res.status, (await res.text()).slice(0, 200));
      const done = await settled(stores, requestId);
      console.log("[resume-after] status:", done?.status, "result:", JSON.stringify(done?.result), "seen:", seen);
      expect(done?.status).toBe("completed");
    } finally {
      await disposeFlowApiRouter(router);
    }
  });
});
