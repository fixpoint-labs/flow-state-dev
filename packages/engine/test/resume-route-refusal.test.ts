/**
 * The public resume route's answer when the shared resume path refuses:
 * another resume holding the lease is a 409 the caller can retry; any other
 * refusal is a broken invariant, never reported as a concurrency conflict.
 * The same route records who resumed: the signed-in caller, or the request's
 * owner when nothing authenticates, never a `resumedBy` in the body (BP-031).
 */
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

const refusal = vi.hoisted(() => ({
  value: { ok: false, busy: true } as Record<string, unknown>,
  args: [] as Array<Record<string, unknown>>
}));
vi.mock("../src/durability/resume-under-lease", () => ({
  resumeUnderLease: async (_deps: unknown, args: Record<string, unknown>) => {
    refusal.args.push(args);
    return refusal.value;
  }
}));

import { createFlowRegistry, createInMemoryStores } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { ResolvedPrincipal } from "../src/transports/types";
import type { RequestRecord } from "../src/stores/types";

async function resume(
  body: Record<string, unknown> = { suspensionId: "sus_1", action: "approve" },
  principal?: ResolvedPrincipal
): Promise<Response> {
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
      body: JSON.stringify(body)
    }),
    { kind: "resume_suspension", flowKind: "resume-refusal", requestId },
    {
      host: {} as never,
      registry,
      stores,
      durabilityProvider: provider,
      ...(principal !== undefined ? { principal } : {}),
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
    refusal.value = { ok: false, refusal: "unexpected" };
    expect((await resume()).status).toBe(500);
  });
});

describe("resume route: who resumed", () => {
  // The body is the caller's to write, so a body field would let anyone put a
  // resume on someone else's name. With no resolver there is no signed-in
  // caller, so the record names the request's owner, as the answer route does.
  it.each([
    { who: "the signed-in caller", principal: { userId: "u1", orgId: DEFAULT_ORG_ID } },
    { who: "the request's owner, when nothing authenticates", principal: undefined }
  ])("records $who, not the body's resumedBy", async ({ principal }) => {
    refusal.value = { ok: true, handle: { requestId: "req_refusal", liveStream: null } };
    refusal.args = [];
    const response = await resume({ suspensionId: "sus_1", action: "approve", resumedBy: "someone-else" }, principal);
    expect(response.status).toBe(202);
    expect(refusal.args).toHaveLength(1);
    expect(refusal.args[0]!.resumedBy).toBe("u1");
  });
});
