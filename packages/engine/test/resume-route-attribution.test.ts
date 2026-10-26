/**
 * Who the public resume route records as having resumed a request: the
 * signed-in caller, never a `resumedBy` the body names (BP-031). The body is
 * the caller's to write, so a body field would let anyone put a resume on
 * someone else's name in the record people read to see who decided.
 */
import { defineFlow, handler, sequencer, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ args: [] as Array<Record<string, unknown>> }));
vi.mock("../src/durability/resume-under-lease", () => ({
  resumeUnderLease: async (_deps: unknown, args: Record<string, unknown>) => {
    recorded.args.push(args);
    return { ok: true, handle: { requestId: "req_attribution", liveStream: null } };
  }
}));

import { createFlowRegistry, createInMemoryStores } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { ResolvedPrincipal } from "../src/transports/types";
import type { RequestRecord } from "../src/stores/types";

const OWNER = "u1";

async function resume(body: Record<string, unknown>, principal?: ResolvedPrincipal): Promise<Response> {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "resume-attribution",
      actions: {
        go: {
          block: sequencer({ name: "s", durable: true }).step(
            handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute: async () => ({}) })
          )
        }
      }
    })()
  );
  const requestId = "req_attribution";
  const record: RequestRecord = {
    id: requestId,
    flowKind: "resume-attribution",
    actionName: "go",
    userId: OWNER,
    orgId: DEFAULT_ORG_ID,
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
    flowKind: "resume-attribution",
    actionName: "go",
    userId: OWNER,
    reason: "human_approval",
    message: "Approve?",
    status: "pending",
    blockInstanceId: "b1",
    stepIndex: 0,
    createdAt: 1
  };
  await provider.suspend(suspension);
  return handleResumeSuspension(
    new Request(`https://x/api/flows/resume-attribution/requests/${requestId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { kind: "resume_suspension", flowKind: "resume-attribution", requestId },
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

beforeEach(() => {
  recorded.args = [];
});

describe("resume route: who resumed", () => {
  it("records the signed-in caller, not the body's resumedBy", async () => {
    const response = await resume(
      { suspensionId: "sus_1", action: "approve", resumedBy: "someone-else" },
      { userId: OWNER, orgId: DEFAULT_ORG_ID }
    );
    expect(response.status).toBe(202);
    expect(recorded.args).toHaveLength(1);
    expect(recorded.args[0]!.resumedBy).toBe(OWNER);
  });

  it("records the request's owner, not the body's resumedBy, when nothing authenticates", async () => {
    // No resolver means no signed-in caller, and the body is still the
    // caller's to write, so the record names the request's owner, as the
    // answer route does.
    const response = await resume({ suspensionId: "sus_1", action: "approve", resumedBy: "someone-else" });
    expect(response.status).toBe(202);
    expect(recorded.args[0]!.resumedBy).toBe(OWNER);
  });
});
