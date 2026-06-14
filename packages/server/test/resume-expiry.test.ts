/**
 * FIX-141: the resume endpoint must enforce suspension expiry itself, not rely
 * solely on the retention sweeper. An expired gate must be rejected (and marked
 * expired) the moment it is resumed, regardless of sweeper cadence or whether
 * retention is configured.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowRegistry, createInMemoryStores } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import type { RequestRecord } from "../src/stores/types";

function setup() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "resume-exp",
      actions: {
        go: {
          block: sequencer({ name: "s", durable: true }).step(
            handler({
              name: "h",
              inputSchema: z.any(),
              outputSchema: z.any(),
              execute: async () => ({})
            })
          )
        }
      }
    })()
  );
  return { stores, provider, registry };
}

async function seedSuspended(
  stores: ReturnType<typeof createInMemoryStores>,
  provider: ReturnType<typeof createCheckpointDurabilityProvider>,
  expiresAt: number | undefined
): Promise<string> {
  const requestId = "req_exp";
  const record: RequestRecord = {
    id: requestId,
    flowKind: "resume-exp",
    actionName: "go",
    userId: "u1",
    source: "http",
    status: "suspended",
    startedAtMs: 1,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1
  };
  await stores.request.set(requestId, record, "any");
  const suspension: SuspensionRecord = {
    suspensionId: "sus_1",
    requestId,
    flowKind: "resume-exp",
    actionName: "go",
    userId: "u1",
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: 1,
    expiresAt
  };
  await provider.suspend(suspension);
  return requestId;
}

function resumeRequest(requestId: string): Request {
  return new Request(
    `https://x/api/flows/resume-exp/requests/${requestId}/resume`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspensionId: "sus_1", action: "approve" })
    }
  );
}

function resumeCtx(
  stores: ReturnType<typeof createInMemoryStores>,
  provider: ReturnType<typeof createCheckpointDurabilityProvider>,
  registry: ReturnType<typeof createFlowRegistry>
) {
  // host/seams/requestContext are only reached after the expiry short-circuit,
  // so stubs suffice for these tests.
  return {
    host: {} as never,
    registry,
    stores,
    durabilityProvider: provider,
    seams: {} as never,
    requestContext: {} as never
  };
}

describe("resume endpoint — expiry enforcement (FIX-141)", () => {
  it("rejects an expired suspension with 410 and marks it expired", async () => {
    const { stores, provider, registry } = setup();
    const requestId = await seedSuspended(stores, provider, Date.now() - 1000);

    const res = await handleResumeSuspension(
      resumeRequest(requestId),
      { kind: "resume_suspension", flowKind: "resume-exp", requestId },
      resumeCtx(stores, provider, registry)
    );

    expect(res.status).toBe(410);
    const after = await provider.loadSuspension(requestId, "sus_1");
    expect(after?.status).toBe("expired");
  });
});
