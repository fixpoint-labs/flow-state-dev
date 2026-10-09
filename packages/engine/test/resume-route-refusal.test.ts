/**
 * The public resume route's answer when the shared resume path refuses:
 * another resume holding the lease is a 409 the caller can retry; any other
 * refusal is a broken invariant, never reported as a concurrency conflict.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

const refusal = vi.hoisted(() => ({ value: { ok: false, busy: true } as Record<string, unknown> }));
vi.mock("../src/durability/resume-under-lease", () => ({
  resumeUnderLease: async () => refusal.value
}));

import { createFlowRegistry, createInMemoryStores } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { RequestRecord } from "../src/stores/types";

async function resume(): Promise<Response> {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "resume-refusal",
      actions: {
        go: {
          block: sequencer({ name: "s", durable: true }).step(
            handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute: async () => ({}) })
          )
        }
      }
    })()
  );
  const requestId = "req_refusal";
  const record: RequestRecord = {
    id: requestId,
    flowKind: "resume-refusal",
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
    flowKind: "resume-refusal",
    actionName: "go",
    userId: "u1",
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: 1
  };
  await provider.suspend(suspension);
  return handleResumeSuspension(
    new Request(`https://x/api/flows/resume-refusal/requests/${requestId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspensionId: "sus_1", action: "approve" })
    }),
    { kind: "resume_suspension", flowKind: "resume-refusal", requestId },
    {
      host: {} as never,
      registry,
      stores,
      durabilityProvider: provider,
      seams: {} as never,
      requestContext: {} as never
    }
  );
}

describe("resume route: refusals from the shared resume path", () => {
  it("another resume holding the lease answers 409", async () => {
    refusal.value = { ok: false, busy: true };
    expect((await resume()).status).toBe(409);
  });

  it("any other refusal answers 500, not a concurrency conflict", async () => {
    refusal.value = { ok: false, busy: false, refusal: "unexpected" };
    expect((await resume()).status).toBe(500);
  });
});
