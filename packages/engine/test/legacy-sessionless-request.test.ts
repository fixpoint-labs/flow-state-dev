/**
 * A request recorded before every request named its session is history. It
 * can still be read and stopped (its gate is still found), and it is never
 * run again: a resume, an answer, a continuation or a retry is refused by name,
 * `legacy-sessionless-request`, and never runs it in a new session. A stop
 * settles it `aborted` without running anything, since a run needs a session.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { continueRequest, createFlowRegistry, runAction } from "../src";
import { createInMemoryStores, LegacySessionlessRequestError } from "../src/host";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { retryRequest } from "../src/execution/request-recovery";
import { handleAbortRequest } from "../src/routes/abort-routes";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import { handleContinueRequest, handleRetryRequest } from "../src/routes/recovery-routes";
import { handleAnswerSuspension } from "../src/routes/answer-routes";
import type { RuntimeConfig } from "../src/runtime-config";
import type { ExecutionResult } from "../src/execution/types";

const USER = "u1";

function legacyFlow(seen: string[]): FlowInstance {
  const approve = handler({
    name: "approve-step",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_i, ctx) => {
      seen.push("ran");
      const answer = await ctx.suspend!({ reason: "user_approval", message: "Approve?" });
      seen.push("after-approval");
      return answer;
    }
  });
  const fail = handler({
    name: "fail-step",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async () => {
      seen.push("failed-run");
      throw new Error("boom");
    }
  });
  return defineFlow({
    kind: "legacy",
    actions: {
      approve: { block: sequencer({ name: "a" }).step(approve) },
      fail: { block: sequencer({ name: "f" }).step(fail) }
    }
  })({ id: "legacy" });
}

function harness(flow: FlowInstance) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const finished: Promise<ExecutionResult>[] = [];
  const runtimeConfig: RuntimeConfig = { durabilityProvider: provider, requestHost: {} };
  const cont = async (opts: Parameters<typeof continueRequest>[0]) => {
    const result = await continueRequest({ ...opts, stores, flowRegistry: registry, runtimeConfig });
    finished.push(result.finished);
    return result;
  };
  const parked = { provider, stores, continueRequest: cont };
  runtimeConfig.requestHost!.parkedStop = parked;
  return { stores, provider, registry, runtimeConfig, finished, parked, cont };
}

/** Run `action` in a session, then strip the session off its record and gates: the shape an old row has. */
async function seedLegacyRequest(h: ReturnType<typeof harness>, flow: FlowInstance, action: "approve" | "fail") {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: action,
    input: {},
    userId: USER,
    sessionId: "s-before",
    stores: h.stores,
    runtimeConfig: h.runtimeConfig
  });
  const requestId = result.requestId!;
  const record = (await h.stores.request.get(requestId))!;
  const { sessionId: _dropped, ...withoutSession } = record;
  await h.stores.request.set(requestId, withoutSession as typeof record, "any");
  for (const gate of (await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId)) {
    const { sessionId: _gone, ...bare } = gate;
    await h.provider.suspend(bare as typeof gate);
  }
  const [gate] = (await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
  return { requestId, gate };
}

async function sessionIds(h: ReturnType<typeof harness>): Promise<string[]> {
  return (await h.stores.session.list()).map((s) => s.id);
}

describe("a request recorded with no session", () => {
  it("is still stopped: its gate is found, it settles aborted, and nothing runs in a new session", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await seedLegacyRequest(h, flow, "approve");
    expect(gate?.sessionId).toBeUndefined();
    const before = await sessionIds(h);

    const response = await handleAbortRequest(
      new Request(`https://x/api/flows/legacy/requests/${requestId}/abort`, { method: "POST" }),
      { kind: "abort_request", flowKind: "legacy", requestId },
      { stores: h.stores, parked: h.parked }
    );
    expect(response.status).toBeLessThan(300);
    await Promise.all(h.finished.map((f) => f.catch(() => undefined)));

    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect((await h.provider.loadSuspension(requestId, gate!.suspensionId))?.status).toBe("stopped");
    expect(seen).toEqual(["ran"]);
    expect(await sessionIds(h)).toEqual(before);
  });

  it("refuses a resume by name, and its gate stays pending", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await seedLegacyRequest(h, flow, "approve");

    const response = await handleResumeSuspension(
      new Request(`https://x/api/flows/legacy/requests/${requestId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate!.suspensionId, action: "approve" })
      }),
      { kind: "resume_suspension", flowKind: "legacy", requestId },
      {
        host: { continueRequest: h.cont } as never,
        registry: h.registry,
        stores: h.stores,
        durabilityProvider: h.provider,
        seams: {} as never,
        requestContext: {} as never
      }
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "legacy-sessionless-request" });
    expect((await h.provider.loadSuspension(requestId, gate!.suspensionId))?.status).toBe("pending");
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
    expect(seen).toEqual(["ran"]);
  });

  it("refuses an answer by name, as the resume route does, and its gate stays pending", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await seedLegacyRequest(h, flow, "approve");

    const response = await handleAnswerSuspension(
      new Request(`https://x/api/flows/legacy/requests/${requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate!.suspensionId, action: "approve" })
      }),
      { kind: "answer_suspension", flowKind: "legacy", requestId },
      { host: { continueRequest: h.cont } as never, registry: h.registry, stores: h.stores, durabilityProvider: h.provider }
    );
    // A named 409, never the route's 500 for a continuation that throws.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "legacy-sessionless-request" });
    expect((await h.provider.loadSuspension(requestId, gate!.suspensionId))?.status).toBe("pending");
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
    expect(seen).toEqual(["ran"]);
  });

  it("refuses a crash continuation over HTTP by name, not as a session mismatch", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId } = await seedLegacyRequest(h, flow, "approve");
    // The shape a crash leaves: interrupted, with no session on the record.
    const record = (await h.stores.request.get(requestId))!;
    await h.stores.request.set(requestId, { ...record, status: "interrupted" }, "any");

    // The route's path always names a session; an old row has none to match it.
    const response = await handleContinueRequest(
      new Request(`https://x/api/flows/legacy/sessions/s-before/requests/${requestId}/continue`, { method: "POST" }),
      { kind: "continue_request", flowKind: "legacy", sessionId: "s-before", requestId },
      { host: { continueRequest: h.cont } as never, registry: h.registry, stores: h.stores, runtimeConfig: h.runtimeConfig }
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "legacy-sessionless-request" });
    expect((await h.stores.request.get(requestId))?.status).toBe("interrupted");
    expect(await h.stores.activeRequests.get(requestId)).toBeUndefined();
    expect(seen).toEqual(["ran"]);
  });

  it("refuses a continuation by name before registering anything", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await seedLegacyRequest(h, flow, "approve");

    await expect(
      h.cont({
        requestId,
        stores: h.stores,
        flowRegistry: h.registry,
        runtimeConfig: h.runtimeConfig,
        resumeContext: { suspensionId: gate!.suspensionId, action: "approve" }
      })
    ).rejects.toBeInstanceOf(LegacySessionlessRequestError);
    expect(await h.stores.activeRequests.get(requestId)).toBeUndefined();
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
    expect(seen).toEqual(["ran"]);
  });

  it("refuses a retry by name, over HTTP as a named 409, and starts nothing", async () => {
    const seen: string[] = [];
    const flow = legacyFlow(seen);
    const h = harness(flow);
    const { requestId } = await seedLegacyRequest(h, flow, "fail");
    expect((await h.stores.request.get(requestId))?.status).toBe("failed");
    const requestsBefore = (await h.stores.request.list()).length;

    await expect(
      retryRequest({ originalRequestId: requestId, stores: h.stores, flowRegistry: h.registry, runtimeConfig: h.runtimeConfig })
    ).rejects.toBeInstanceOf(LegacySessionlessRequestError);

    const response = await handleRetryRequest(
      new Request(`https://x/api/flows/legacy/requests/${requestId}/retry`, { method: "POST" }),
      { kind: "retry_request", flowKind: "legacy", sessionId: "s-before", requestId },
      { registry: h.registry, stores: h.stores, runtimeConfig: h.runtimeConfig }
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "legacy-sessionless-request" });
    expect((await h.stores.request.list()).length).toBe(requestsBefore);
    expect(seen).toEqual(["failed-run"]);
  });
});
