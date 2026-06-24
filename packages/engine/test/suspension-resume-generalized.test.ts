/**
 * FIX-849: generalized HITL resolution beyond binary approve/reject.
 *
 * Two seams are exercised:
 *  - the continuation transport (runAction/continueRequest + resumeContext):
 *    `submit` returns the validated payload and stamps `resolution:"submitted"`;
 *    `skip` returns the SUSPENSION_SKIPPED sentinel and stamps
 *    `resolution:"skipped"`; a skipped gate replayed at a later gate returns the
 *    sentinel again (not the persisted data).
 *  - the resume route (handleResumeSuspension): an action outside the
 *    suspension's `allow` set is a 409; a `submit` payload that violates the
 *    persisted `resumeSchema` is a 400 with path-keyed errors.
 */
import { defineFlow, handler, sequencer, SUSPENSION_SKIPPED } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";
import type { FlowInstance, ResumeAction, SuspensionRecord } from "@flow-state-dev/core/types";
import type { RequestRecord } from "../src/stores/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

/** Resolve a pending suspension via the same-request continuation path. */
async function resolve(
  flow: FlowInstance,
  stores: StoreRegistry,
  provider: DurabilityProvider,
  requestId: string,
  suspension: SuspensionRecord,
  action: ResumeAction,
  data?: unknown
) {
  const statusByAction = {
    approve: "approved",
    reject: "rejected",
    submit: "submitted",
    skip: "skipped"
  } as const;
  await provider.suspend({
    ...suspension,
    status: statusByAction[action],
    resolvedAt: Date.now(),
    resumeData: data
  });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registryFor(flow),
    resumeContext: { suspensionId: suspension.suspensionId, action, data, resumedBy: "reviewer" },
    runtimeConfig: { durabilityProvider: provider }
  });
  return finished;
}

describe("submit resolution", () => {
  it("returns the submitted payload and stamps resolution:submitted", async () => {
    const ask = handler({
      name: "ask",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const answer = await ctx.suspend!({
          reason: "human_input",
          message: "What is your name?",
          resumeSchema: { type: "object", properties: { name: { type: "string" } } },
          allow: ["submit"]
        });
        return answer;
      }
    });
    const flow = defineFlow({
      kind: "fix849-submit",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(ask),
          inputSchema: z.any()
        }
      }
    })({ id: "fix849-submit" });

    const { stores, provider } = createDurableStores();
    const initial = await runActionFor(flow, stores, provider);
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });
    expect(suspension.allow).toEqual(["submit"]);

    const resumed = await (await resolve(
      flow,
      stores,
      provider,
      requestId,
      suspension,
      "submit",
      { name: "Ada" }
    ));

    expect(resumed.output).toEqual({ name: "Ada" });
    const record = await stores.request.get(requestId);
    const resumeItem = (record!.items ?? []).find((i) => i.type === "suspension_resume") as any;
    expect(resumeItem.resolution).toBe("submitted");
    expect(resumeItem.resumeData).toEqual({ name: "Ada" });
  });
});

describe("skip resolution", () => {
  it("returns SUSPENSION_SKIPPED and stamps resolution:skipped", async () => {
    const ask = handler({
      name: "ask",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const answer = await ctx.suspend!({
          reason: "human_input",
          message: "Optional feedback?",
          allow: ["submit", "skip"]
        });
        return { skipped: answer === SUSPENSION_SKIPPED };
      }
    });
    const flow = defineFlow({
      kind: "fix849-skip",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true }).step(ask),
          inputSchema: z.any()
        }
      }
    })({ id: "fix849-skip" });

    const { stores, provider } = createDurableStores();
    const initial = await runActionFor(flow, stores, provider);
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });

    const resumed = await (await resolve(flow, stores, provider, requestId, suspension, "skip"));

    // The flow saw the sentinel (not a data payload) and branched accordingly.
    expect(resumed.output).toEqual({ skipped: true });
    const record = await stores.request.get(requestId);
    const resumeItem = (record!.items ?? []).find((i) => i.type === "suspension_resume") as any;
    expect(resumeItem.resolution).toBe("skipped");
  });

  it("replays a skipped gate as the sentinel after resuming a later gate", async () => {
    // Two gates. Gate A is skipped; the run re-suspends at gate B. When gate B is
    // resolved, the sequencer replays gate A from the durable log — gate A must
    // observe SUSPENSION_SKIPPED again, not the persisted resumeData. Gate A
    // records what it saw into sequencer state so the final report can prove it.
    const stateSchema = z.object({ aSkipped: z.boolean().default(false) });
    const gateA = handler({
      name: "gateA",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        const answer = await ctx.suspend!({
          reason: "human_input",
          message: "Gate A (optional)?",
          allow: ["submit", "skip"]
        });
        ctx.sequencer!.patchState({ aSkipped: answer === SUSPENSION_SKIPPED });
        return { ok: true };
      }
    });
    const gateB = handler({
      name: "gateB",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        await ctx.suspend!({ reason: "human_approval", message: "Gate B?" });
        return { ok: true };
      }
    });
    const report = handler({
      name: "report",
      inputSchema: z.any(),
      outputSchema: z.object({ aSkipped: z.boolean() }),
      execute: async (_input, ctx) => ({
        aSkipped: (ctx.sequencer!.state as { aSkipped: boolean }).aSkipped
      })
    });
    const flow = defineFlow({
      kind: "fix849-skip-replay",
      actions: {
        run: {
          block: sequencer({ name: "seq", durable: true, stateSchema })
            .step(gateA)
            .step(gateB)
            .step(report),
          inputSchema: z.any()
        }
      }
    })({ id: "fix849-skip-replay" });

    const { stores, provider } = createDurableStores();
    const initial = await runActionFor(flow, stores, provider);
    const requestId = initial.requestId!;

    // Skip gate A → re-suspends at gate B.
    const [suspA] = await provider.listSuspended({ status: "pending" });
    await (await resolve(flow, stores, provider, requestId, suspA, "skip"));
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // Resolve gate B → completes, replaying gate A as a skip.
    const [suspB] = await provider.listSuspended({ status: "pending" });
    const resumed = await (await resolve(flow, stores, provider, requestId, suspB, "approve"));

    expect(resumed.output).toEqual({ aSkipped: true });
  });
});

describe("resume route — allow enforcement & payload validation", () => {
  function seedSuspended(
    stores: ReturnType<typeof createInMemoryStores>,
    provider: ReturnType<typeof createCheckpointDurabilityProvider>,
    overrides: Partial<SuspensionRecord>
  ): Promise<string> {
    const requestId = "req_gen";
    const request: RequestRecord = {
      id: requestId,
      flowKind: "gen",
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
    const suspension: SuspensionRecord = {
      suspensionId: "sus_1",
      requestId,
      flowKind: "gen",
      actionName: "go",
      userId: "u1",
      reason: "human_input",
      message: "Provide input",
      status: "pending",
      blockInstanceId: "b1",
      stepIndex: 0,
      createdAt: 1,
      ...overrides
    };
    return stores.request
      .set(requestId, request, "any")
      .then(() => provider.suspend(suspension))
      .then(() => requestId);
  }

  function ctxFor(
    stores: ReturnType<typeof createInMemoryStores>,
    provider: ReturnType<typeof createCheckpointDurabilityProvider>
  ) {
    // Guards short-circuit before the host/seams are reached, so stubs suffice.
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "gen",
        actions: {
          go: { block: sequencer({ name: "s", durable: true }).step(
            handler({ name: "h", inputSchema: z.any(), outputSchema: z.any(), execute: async () => ({}) })
          ) }
        }
      })()
    );
    return {
      host: {} as never,
      registry,
      stores,
      durabilityProvider: provider,
      seams: {} as never,
      requestContext: {} as never
    };
  }

  function resumeRequest(requestId: string, body: unknown): Request {
    return new Request(`https://x/api/flows/gen/requests/${requestId}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("returns 409 when the action is not in the suspension's allow set", async () => {
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, { allow: ["submit"] });

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "approve" }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctxFor(stores, provider)
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not permitted/);
    // Untouched — still pending.
    expect((await provider.loadSuspension(requestId, "sus_1"))?.status).toBe("pending");
  });

  it("returns 400 with path-keyed errors when a submit payload violates resumeSchema", async () => {
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, {
      allow: ["submit"],
      resumeSchema: {
        type: "object",
        properties: { age: { type: "number" } },
        required: ["age"]
      }
    });

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "submit", data: { age: "old" } }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctxFor(stores, provider)
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.validationErrors).toBeDefined();
    expect(Object.keys(body.validationErrors).length).toBeGreaterThan(0);
    // No transition — stays pending.
    expect((await provider.loadSuspension(requestId, "sus_1"))?.status).toBe("pending");
  });

  it("returns 400 (not 500) when a submit omits data against a schema", async () => {
    // The JSON-Schema validator throws on an `undefined` instance; the route must
    // treat that as a clean validation failure, not let it escape as a 500.
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, {
      allow: ["submit"],
      resumeSchema: { type: "object", properties: { age: { type: "number" } }, required: ["age"] }
    });

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "submit" }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctxFor(stores, provider)
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.validationErrors).toBeDefined();
    expect((await provider.loadSuspension(requestId, "sus_1"))?.status).toBe("pending");
  });

  it("resolves a bare approve against an optional resumeSchema (no 400)", async () => {
    // An approve is binary; its payload is optional metadata. A bare approve
    // against a suspension that carries a resumeSchema (e.g. an optional note)
    // must still resolve — validation only runs when the resumer sends data.
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, {
      reason: "human_approval",
      allow: ["approve", "reject"],
      resumeSchema: { type: "object", properties: { note: { type: "string" } } }
    });
    // A host whose continueRequest succeeds without an inline stream → 202.
    const ctx = {
      ...ctxFor(stores, provider),
      host: { continueRequest: async () => ({ requestId, liveStream: null }) } as never
    };

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "approve" }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctx
    );

    expect(res.status).toBe(202);
    expect((await provider.loadSuspension(requestId, "sus_1"))?.status).toBe("approved");
  });

  it("enforces expiry before payload validation (expired + invalid → 410)", async () => {
    // An expired gate must be marked expired even when the client sends an
    // invalid payload — the expiry check runs before the allow/validation guards,
    // so the gate can't be held pending indefinitely by bad submissions.
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, {
      allow: ["submit"],
      resumeSchema: { type: "object", properties: { age: { type: "number" } }, required: ["age"] },
      expiresAt: 1
    });

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "submit", data: { age: "nope" } }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctxFor(stores, provider)
    );

    expect(res.status).toBe(410);
    expect((await provider.loadSuspension(requestId, "sus_1"))?.status).toBe("expired");
  });

  it("rejects an unknown action with 400", async () => {
    const { stores, provider } = createDurableStores();
    const requestId = await seedSuspended(stores, provider, { allow: ["submit"] });

    const res = await handleResumeSuspension(
      resumeRequest(requestId, { suspensionId: "sus_1", action: "maybe" }),
      { kind: "resume_suspension", flowKind: "gen", requestId },
      ctxFor(stores, provider)
    );

    expect(res.status).toBe(400);
  });
});

/** Shared first-run helper: drive the flow to its first suspension. */
function runActionFor(flow: FlowInstance, stores: StoreRegistry, provider: DurabilityProvider) {
  return runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    stores,
    runtimeConfig: { durabilityProvider: provider }
  });
}
