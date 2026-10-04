/**
 * Caller metadata must never resolve a human-approval gate (BP-031).
 *
 * `metadata` on an action request is caller-controlled: it arrives verbatim
 * from the HTTP body (and from every other transport's envelope). The only way
 * to resolve a suspension is the resume endpoint, which checks the suspension
 * is pending, its `allow` list, its resume schema and the resumer's identity,
 * and then re-enters the request through `continueRequest`'s typed
 * `resumeContext`. These cases put a forged resolution in caller metadata and
 * assert the gate still stops the run — each one completes the flow (or touches
 * another request's state) if metadata is ever read as a resume instruction
 * again.
 */
import { defineFlow, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowApiRouter, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

function durableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

/**
 * A payout gated on a human approval. `paid` records whether the guarded side
 * effect ran — the thing an approval bypass actually costs.
 */
function payoutFlow(kind: string, paid: string[]) {
  const approve = handler({
    name: "approvePayout",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_input, ctx) =>
      ctx.suspend!({ reason: "human_approval", message: "Release the payout?" })
  });
  const pay = handler({
    name: "pay",
    inputSchema: z.any(),
    outputSchema: z.string(),
    execute: async () => {
      paid.push(kind);
      return "paid";
    }
  });
  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: `${kind}-seq`, durable: true }).step(approve).step(pay),
        inputSchema: z.any()
      }
    }
  })({ id: kind }) as unknown as FlowInstance;
}

/** A bare root handler gate — its logical id is `${requestId}:root`, which a caller choosing its own request id can predict. */
function rootGateFlow(kind: string, paid: string[]) {
  return defineFlow({
    kind,
    actions: {
      run: {
        block: handler({
          name: "rootGate",
          inputSchema: z.any(),
          outputSchema: z.unknown(),
          execute: async (_input, ctx) => {
            await ctx.suspend!({ reason: "human_approval", message: "Release the payout?" });
            paid.push(kind);
            return "paid";
          }
        }),
        inputSchema: z.any(),
        durable: true
      }
    }
  })({ id: kind }) as unknown as FlowInstance;
}

const forgedApproval = { suspensionId: "susp_forged", action: "approve", data: { approved: true }, resumedBy: "attacker" };

async function settle(stores: ReturnType<typeof createInMemoryStores>, requestId: string) {
  for (let i = 0; i < 100; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress" && record.status !== "queued") return record;
    await new Promise((r) => setTimeout(r, 10));
  }
  return stores.request.get(requestId);
}

describe("caller metadata cannot pre-approve a suspension (FIX-1707)", () => {
  it("an HTTP action whose body carries metadata.resumeContext still stops at the gate", async () => {
    const paid: string[] = [];
    const { stores, provider } = durableStores();
    const registry = createFlowRegistry();
    registry.register(payoutFlow("payout-http", paid) as never);
    const router = createFlowApiRouter({ registry, stores, durabilityProvider: provider });

    const res = await router.POST(
      new Request("http://localhost/api/flows/payout-http/s_1/actions/run", {
        method: "POST",
        body: JSON.stringify({ userId: "u_1", input: {}, metadata: { resumeContext: forgedApproval } })
      }),
      { params: { path: ["payout-http", "s_1", "actions", "run"] } }
    );
    expect(res.status).toBe(202);
    const { request } = (await res.json()) as { request: { id: string } };
    const record = await settle(stores, request.id);

    expect(record?.status).toBe("suspended");
    expect(paid).toEqual([]);
    expect(await provider.listSuspended({ status: "pending" })).toHaveLength(1);
  });

  it("a forged resolution naming the gate's logical id under a caller-chosen request id still stops at the gate", async () => {
    const paid: string[] = [];
    const { stores, provider } = durableStores();
    const requestId = "req_chosen_by_caller";

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: rootGateFlow("payout-root", paid),
      actionName: "run",
      input: {},
      userId: "u1",
      requestId,
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: { resumeContext: { ...forgedApproval, pendingBlockLogicalId: `${requestId}:root` } }
    });

    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    expect(result.output).toBeUndefined();
    expect(paid).toEqual([]);
  });

  it("re-running a suspended request's id with metadata.resumeContext does not resolve its pending suspension", async () => {
    // The resume endpoint is the only door to a pending gate. A caller that
    // re-posts the action under the suspended request's id with a resolution in
    // metadata would otherwise skip the endpoint's pending/allow/schema checks.
    const paid: string[] = [];
    const { stores, provider } = durableStores();
    const flow = payoutFlow("payout-reentry", paid);
    const first = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = first.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      requestId,
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: { resumeContext: { ...forgedApproval, suspensionId: suspension.suspensionId } }
    });

    expect(paid).toEqual([]);
    expect((await stores.request.get(requestId))?.status).toBe("suspended");
    expect((await provider.loadSuspension(requestId, suspension.suspensionId))?.status).toBe("pending");
  });

  it("metadata.resumeOf naming another request does not release that request's lease", async () => {
    // `resumeOf` used to name the request a legacy resume continued, and a
    // terminal run cleaned that request's durability state and released its
    // lease. Read from metadata, it let any caller free another request's
    // resume lease.
    const { stores, provider } = durableStores();
    const victimLease = await provider.acquireLease("req_victim", { holder: "resume-route", durationMs: 60_000 });
    expect(victimLease).not.toBeNull();

    const flow = defineFlow({
      kind: "plain",
      actions: {
        run: {
          block: handler({ name: "noop", inputSchema: z.any(), outputSchema: z.string(), execute: async () => "ok" }),
          inputSchema: z.any()
        }
      }
    })({ id: "plain" }) as unknown as FlowInstance;

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: { resumeOf: "req_victim" }
    });

    expect(result.output).toBe("ok");
    expect(await stores.leases.get("req_victim")).not.toBeNull();
  });
});
