/**
 * FIX-140: Suspension and resume integration tests.
 *
 * Verifies the ctx.suspend() → suspended status → resume endpoint → flow
 * completion lifecycle for durable actions.
 */
import { buildReplayLog, defineFlow, handler, parseBlockInstanceId, sequencer } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { DurabilityProvider } from "../src/durability/types";
import type { StoreRegistry } from "../src/stores/types";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import type { ResumeContext } from "@flow-state-dev/core/types";

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

describe("ctx.suspend() — initial suspension", () => {
  it("sets request status to suspended and creates a SuspensionRecord", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.unknown(),
      execute: async (input, ctx) => {
        const decision = await ctx.suspend!({
          reason: "human_approval",
          message: `Approve transfer of $${input.amount}?`,
          data: { amount: input.amount }
        });
        return decision;
      }
    });

    const flow = defineFlow({
      kind: "suspend-test",
      actions: {
        transfer: {
          block: sequencer({ name: "transferSeq", durable: true })
            .step(approvalStep),
          inputSchema: z.object({ amount: z.number() })
        }
      }
    })();

    const { stores, provider } = createDurableStores();

    const result = await runAction({
      flow,
      actionName: "transfer",
      input: { amount: 1000 },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(result.output).toBeUndefined();
    expect(result.error).toBeUndefined();

    const request = await stores.request.get(result.requestId!);
    expect(request?.status).toBe("suspended");

    const suspensions = await provider.listSuspended({ status: "pending" });
    expect(suspensions.length).toBe(1);
    expect(suspensions[0].reason).toBe("human_approval");
    expect(suspensions[0].requestId).toBe(result.requestId);

    const suspItem = result.items.find((i) => i.type === "suspension");
    expect(suspItem).toBeDefined();
  });

  it("emits a SuspensionItem in the response items", async () => {
    const step = handler({
      name: "waitForInput",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        return ctx.suspend!({
          reason: "human_input",
          message: "Please provide feedback",
          resumeSchema: { type: "object", properties: { feedback: { type: "string" } } }
        });
      }
    });

    const flow = defineFlow({
      kind: "suspend-item-test",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(step),
          inputSchema: z.any()
        }
      }
    })();

    const { stores, provider } = createDurableStores();

    const result = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    const suspItem = result.items.find((i) => i.type === "suspension") as any;
    expect(suspItem).toBeDefined();
    expect(suspItem.reason).toBe("human_input");
    expect(suspItem.message).toBe("Please provide feedback");
    expect(suspItem.resumeSchema).toBeDefined();
  });

  it("records the nested suspending block's identity so the ReplayLog can recover it (FIX-811)", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });

    const flow = defineFlow({
      kind: "nested-suspend-identity",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(approvalStep),
          inputSchema: z.any()
        }
      }
    })();

    const { stores, provider } = createDurableStores();

    const result = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    // The suspending block is nested below the root sequencer, so the outer ctx
    // has no identity — the leaf id must come from the error stamp. It lands on
    // the suspension *item* (the ReplayLog's source), not the record, whose
    // `blockInstanceId` is the sequencer checkpoint key.
    const [suspension] = await provider.listSuspended({ status: "pending" });
    const suspItem = result.items.find((i) => i.type === "suspension") as any;
    const parsed = parseBlockInstanceId(suspItem.blockInstanceId);
    expect(parsed).toBeDefined();
    expect(parsed!.requestId).toBe(result.requestId);

    // The ReplayLog (built from the item log alone) recovers the pending
    // suspension keyed by the suspending block's logical path.
    const replayLog = buildReplayLog(result.items as RuntimeItem[]);
    const pending = replayLog.pendingSuspension();
    expect(pending).toBeDefined();
    expect(pending!.suspensionId).toBe(suspension.suspensionId);
    expect(pending!.blockLogicalId).toBe(`${parsed!.requestId}:${parsed!.path}`);
  });
});

describe("resume after suspension", () => {
  it("resumes and completes the flow when approved", async () => {
    let suspendCallCount = 0;

    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.unknown(),
      execute: async (input, ctx) => {
        suspendCallCount++;
        const decision = await ctx.suspend!({
          reason: "human_approval",
          message: `Approve $${input.amount}?`
        });
        return { approved: true, decision };
      }
    });

    const confirmStep = handler({
      name: "confirmStep",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: async (input) => {
        return `Transfer confirmed: ${JSON.stringify(input)}`;
      }
    });

    const flow = defineFlow({
      kind: "resume-test",
      actions: {
        transfer: {
          block: sequencer({ name: "transferSeq", durable: true })
            .step(approvalStep)
            .step(confirmStep),
          inputSchema: z.object({ amount: z.number() })
        }
      }
    })();

    const { stores, provider } = createDurableStores();

    // Phase 1: initial run → suspends
    const initial = await runAction({
      flow,
      actionName: "transfer",
      input: { amount: 500 },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(initial.output).toBeUndefined();
    const suspensions = await provider.listSuspended({ status: "pending" });
    expect(suspensions.length).toBe(1);
    const suspension = suspensions[0];

    // Update suspension to approved
    await provider.suspend({
      ...suspension,
      status: "approved",
      resolvedAt: Date.now(),
      resumeData: { note: "looks good" }
    });

    const resumeContext: ResumeContext = {
      suspensionId: suspension.suspensionId,
      action: "approve",
      data: { note: "looks good" }
    };

    // Phase 2: resume run → completes
    const resumed = await runAction({
      flow,
      actionName: "transfer",
      input: { amount: 500 },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: {
        resumeOf: initial.requestId,
        resumeContext
      }
    });

    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toContain("Transfer confirmed");

    const resumedRequest = await stores.request.get(resumed.requestId!);
    expect(resumedRequest?.status).toBe("completed");
  });

  it("throws SuspensionRejectedError when action is reject", async () => {
    const step = handler({
      name: "waitStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        return ctx.suspend!({
          reason: "human_approval",
          message: "Approve?"
        });
      }
    });

    const flow = defineFlow({
      kind: "reject-test",
      actions: {
        ask: {
          block: sequencer({ name: "rejectSeq", durable: true }).step(step),
          inputSchema: z.any()
        }
      }
    })();

    const { stores, provider } = createDurableStores();

    // Phase 1: suspend
    const initial = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    const suspensions = await provider.listSuspended({ status: "pending" });
    const suspension = suspensions[0];

    await provider.suspend({
      ...suspension,
      status: "rejected",
      resolvedAt: Date.now()
    });

    // Phase 2: resume with rejection
    const resumed = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider },
      metadata: {
        resumeOf: initial.requestId,
        resumeContext: {
          suspensionId: suspension.suspensionId,
          action: "reject" as const
        }
      }
    });

    expect(resumed.error).toBeDefined();
    expect(resumed.error!.message).toContain("rejected");
  });
});

describe("suspension without durability provider", () => {
  it("fails with a clear error instead of creating an irrecoverable suspended state", async () => {
    const step = handler({
      name: "suspendStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        return ctx.suspend!({
          reason: "human_input",
          message: "Provide input"
        });
      }
    });

    const flow = defineFlow({
      kind: "no-provider-test",
      actions: {
        ask: {
          block: sequencer({ name: "seq", durable: true }).step(step),
          inputSchema: z.any()
        }
      }
    })();

    const stores = createInMemoryStores();

    const result = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: {}
    });

    const request = await stores.request.get(result.requestId!);
    expect(request?.status).toBe("failed");
  });
});

describe("same-request continuation (FIX-811)", () => {
  /** Register a flow under its kind so `continueRequest` can resolve it. */
  function registryFor(flow: FlowInstance) {
    const registry = createFlowRegistry();
    registry.register(flow as never);
    return registry;
  }

  /**
   * Resolve a pending suspension via the same-request continuation path:
   * mark the suspension resolved, then re-enter the SAME request id.
   */
  async function resolve(
    flow: FlowInstance,
    stores: StoreRegistry,
    provider: DurabilityProvider,
    requestId: string,
    suspension: SuspensionRecord,
    action: "approve" | "reject",
    data?: unknown
  ) {
    await provider.suspend({
      ...suspension,
      status: action === "approve" ? "approved" : "rejected",
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

  it("resumes the SAME request id with the full ordered item log and no orphan request", async () => {
    const preStep = handler({
      name: "preStep",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.object({ amount: z.number(), prepared: z.boolean() }),
      execute: async (input) => ({ amount: input.amount, prepared: true })
    });
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.object({ amount: z.number(), prepared: z.boolean() }),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const confirmStep = handler({
      name: "confirmStep",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: async (input) => `confirmed:${JSON.stringify(input)}`
    });

    const flow = defineFlow({
      kind: "fix811-same-id",
      actions: {
        transfer: {
          block: sequencer({ name: "transferSeq", durable: true })
            .step(preStep)
            .step(approvalStep)
            .step(confirmStep),
          inputSchema: z.object({ amount: z.number() })
        }
      }
    })({ id: "fix811-same-id" });

    const { stores, provider } = createDurableStores();

    const initial = await runAction({
      flow,
      actionName: "transfer",
      input: { amount: 500 },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const finished = await resolve(
      flow,
      stores,
      provider,
      requestId,
      suspension,
      "approve",
      { note: "ok" }
    );
    const resumed = await finished;

    // Same request id — continuation re-entered, not a new request.
    expect(resumed.requestId).toBe(requestId);
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toContain("confirmed");

    // No orphan: exactly one request record exists.
    const allRequests = await stores.request.list();
    expect(allRequests.length).toBe(1);

    // GET returns pre + suspension + suspension_resume + post, in order.
    const record = await stores.request.get(requestId);
    const types = (record!.items ?? []).map((i) => i.type);
    const suspIdx = types.indexOf("suspension");
    const resumeIdx = types.indexOf("suspension_resume");
    expect(suspIdx).toBeGreaterThanOrEqual(0);
    expect(resumeIdx).toBe(suspIdx + 1);
    // The pre-suspension block_trace exists and precedes the suspension.
    const preTraceIdx = (record!.items ?? []).findIndex(
      (i) => i.type === "block_trace" && (i as any).blockName === "preStep"
    );
    expect(preTraceIdx).toBeGreaterThanOrEqual(0);
    expect(preTraceIdx).toBeLessThan(suspIdx);
  });

  it("emits a suspension_resume item with resolution / resolvedBy / resumeData", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const flow = defineFlow({
      kind: "fix811-resume-item",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(approvalStep),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-resume-item" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });

    const finished = await resolve(
      flow,
      stores,
      provider,
      requestId,
      suspension,
      "approve",
      { decision: "yes" }
    );
    await finished;

    const record = await stores.request.get(requestId);
    const resumeItem = (record!.items ?? []).find(
      (i) => i.type === "suspension_resume"
    ) as any;
    expect(resumeItem).toBeDefined();
    expect(resumeItem.resolution).toBe("approved");
    expect(resumeItem.resolvedBy).toBe("reviewer");
    expect(resumeItem.resumeData).toEqual({ decision: "yes" });
    expect(resumeItem.suspensionId).toBe(suspension.suspensionId);
  });

  it("replays a completed pre-suspension block instead of re-executing it", async () => {
    const preSpy = vi.fn(async (input: { value: number }) => ({ doubled: input.value * 2 }));
    const preStep = handler({
      name: "preStep",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ doubled: z.number() }),
      execute: preSpy
    });
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.object({ doubled: z.number() }),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const readerStep = handler({
      name: "readerStep",
      inputSchema: z.any(),
      outputSchema: z.object({ readDoubled: z.number() }),
      execute: async (_input, ctx) => {
        const pre = ctx.getBlockOutput!(preStep) as { doubled: number } | undefined;
        return { readDoubled: pre?.doubled ?? -1 };
      }
    });

    const flow = defineFlow({
      kind: "fix811-replay",
      actions: {
        run: {
          block: sequencer({ name: "runSeq", durable: true })
            .step(preStep)
            .step(approvalStep)
            .step(readerStep),
          inputSchema: z.object({ value: z.number() })
        }
      }
    })({ id: "fix811-replay" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: { value: 21 },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect(preSpy).toHaveBeenCalledTimes(1);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const finished = await resolve(flow, stores, provider, requestId, suspension, "approve");
    const resumed = await finished;

    // preStep replayed from the log — its execute was NOT called a second time.
    expect(preSpy).toHaveBeenCalledTimes(1);
    // A later sibling read the replayed block's output via ctx.getBlockOutput.
    expect(resumed.output).toEqual({ readDoubled: 42 });
    expect((await stores.request.get(requestId))?.status).toBe("completed");
  });

  it("resumes two sequential gates one at a time (per-call matching, no shared flag)", async () => {
    const gateA = handler({
      name: "gateA",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Gate A?" })
    });
    const gateB = handler({
      name: "gateB",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Gate B?" })
    });
    const done = handler({
      name: "done",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: async () => "both gates passed"
    });

    const flow = defineFlow({
      kind: "fix811-multigate",
      actions: {
        run: {
          block: sequencer({ name: "gatesSeq", durable: true })
            .step(gateA)
            .step(gateB)
            .step(done),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-multigate" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;

    // Resolve gate A → must re-suspend at gate B (still suspended).
    const [suspA] = await provider.listSuspended({ status: "pending" });
    await (await resolve(flow, stores, provider, requestId, suspA, "approve"));
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    const pendingAfterA = await provider.listSuspended({ status: "pending" });
    expect(pendingAfterA.length).toBe(1);
    expect(pendingAfterA[0].suspensionId).not.toBe(suspA.suspensionId);

    // Resolve gate B → completes.
    const finishedB = await resolve(flow, stores, provider, requestId, pendingAfterA[0], "approve");
    const resumed = await finishedB;
    expect(resumed.output).toBe("both gates passed");
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    const record = await stores.request.get(requestId);
    const resumeItems = (record!.items ?? []).filter((i) => i.type === "suspension_resume");
    expect(resumeItems.length).toBe(2);
  });

  it("preserves accumulator state across a suspend/resume cycle on one request", async () => {
    const stateSchema = z.object({ tally: z.number().default(0) });
    // Mutate state in a pre-step (replayed, runs once), then suspend in a
    // separate step (re-runs on resume). This isolates the state-restore
    // assertion from the suspending step's documented re-execution.
    const bump = handler({
      name: "bump",
      inputSchema: z.any(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, ctx) => {
        ctx.sequencer!.patchState({ tally: (ctx.sequencer!.state as any).tally + 5 });
        return { ok: true };
      }
    });
    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const report = handler({
      name: "report",
      inputSchema: z.any(),
      outputSchema: z.object({ tally: z.number() }),
      execute: async (_input, ctx) => ({ tally: (ctx.sequencer!.state as any).tally })
    });

    const flow = defineFlow({
      kind: "fix811-state",
      actions: {
        run: {
          block: sequencer({ name: "stateSeq", durable: true, stateSchema })
            .step(bump)
            .step(gate)
            .step(report),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-state" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const finished = await resolve(flow, stores, provider, requestId, suspension, "approve");
    const resumed = await finished;

    // The +5 mutation from before the suspension survived the re-entry.
    expect(resumed.output).toEqual({ tally: 5 });
  });

  it("leaves the record suspended when continuation fails before the in_progress transition", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const flow = defineFlow({
      kind: "fix811-ponr",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(approvalStep),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-ponr" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });

    // Make flow-resolve fail BEFORE the point of no return: continueRequest
    // throws synchronously (returned promise rejects) for an unknown flow.
    const emptyRegistry = createFlowRegistry();
    await expect(
      continueRequest({
        requestId,
        stores,
        flowRegistry: emptyRegistry,
        resumeContext: { suspensionId: suspension.suspensionId, action: "approve" },
        runtimeConfig: { durabilityProvider: provider }
      })
    ).rejects.toThrow();

    // Record is untouched — still suspended and re-attemptable.
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // A subsequent valid continuation succeeds.
    const finished = await resolve(flow, stores, provider, requestId, suspension, "approve");
    await finished;
    expect((await stores.request.get(requestId))?.status).toBe("completed");
  });

  it("resolves a ctx.suspend() called directly from a bare root handler (Bug 1)", async () => {
    // The action block is a BARE handler (no sequencer wrapper), so the suspend
    // is reached from the ROOT scope where `parentChain.parent` is undefined.
    // Before the fix the resolving gate's callerLogicalId was undefined and
    // never matched `pendingBlockLogicalId`, so the root gate re-suspended
    // forever instead of returning the resume payload.
    const rootHandler = handler({
      name: "rootApproval",
      inputSchema: z.object({ amount: z.number() }),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) => {
        const decision = await ctx.suspend!({
          reason: "human_approval",
          message: "Approve?"
        });
        return { approved: true, decision };
      }
    });

    const flow = defineFlow({
      kind: "fix811-root-suspend",
      actions: {
        transfer: {
          // Durable at the action level so ctx.suspend() is available without
          // a sequencer wrapper.
          block: rootHandler,
          durable: true,
          inputSchema: z.object({ amount: z.number() })
        }
      }
    })({ id: "fix811-root-suspend" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "transfer",
      input: { amount: 500 },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const finished = await resolve(
      flow,
      stores,
      provider,
      requestId,
      suspension,
      "approve",
      { note: "ok" }
    );
    const resumed = await finished;

    // The root gate resolved — record completed and the resume payload reached
    // the handler's output.
    expect((await stores.request.get(requestId))?.status).toBe("completed");
    expect(resumed.output).toEqual({ approved: true, decision: { note: "ok" } });
  });

  it("continues the prior event sequence without restarting at 1 (Bug 2)", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const flow = defineFlow({
      kind: "fix811-seq-continuity",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(approvalStep),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-seq-continuity" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;

    const preSuspendEvents = await stores.request.getEvents(requestId);
    const preSuspensionMax = preSuspendEvents.reduce(
      (m, e) => Math.max(m, e.sequence_number),
      0
    );
    expect(preSuspensionMax).toBeGreaterThan(0);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    const finished = await resolve(flow, stores, provider, requestId, suspension, "approve");
    await finished;

    // Every post-resume event must continue strictly above the pre-suspension
    // max — no restart at sequence 1, no collision with the suspend-run events.
    const afterEvents = await stores.request.getEvents(requestId);
    const postResume = afterEvents.filter((e) => e.sequence_number > preSuspensionMax);
    expect(postResume.length).toBeGreaterThan(0);
    // The full log is strictly increasing with no duplicate sequence numbers.
    const seqs = afterEvents.map((e) => e.sequence_number);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it("reverts to pending and deregisters on a pre-transition failure, then a retry completes (Bugs 3 & 4)", async () => {
    const approvalStep = handler({
      name: "approvalStep",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const flow = defineFlow({
      kind: "fix811-pretransition-revert",
      actions: {
        ask: {
          block: sequencer({ name: "askSeq", durable: true }).step(approvalStep),
          inputSchema: z.any()
        }
      }
    })({ id: "fix811-pretransition-revert" });

    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow,
      actionName: "ask",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });

    // Inject a PRE-TRANSITION failure: checkpoint restore (stores.checkpoints
    // .latest) runs before the suspended → in_progress transition. A throwing
    // double surfaces a failure that the detached runAction must recover from
    // by reverting the suspension and leaving the record suspended.
    let failNext = true;
    const throwingStores: StoreRegistry = {
      ...stores,
      checkpoints: {
        ...stores.checkpoints,
        latest: async (rid: string, bid: string) => {
          if (failNext) throw new Error("injected pre-transition failure");
          return stores.checkpoints.latest(rid, bid);
        }
      }
    };

    // Mark the suspension resolved (mirrors `resolve`).
    await provider.suspend({
      ...suspension,
      status: "approved",
      resolvedAt: Date.now(),
      resolvedBy: "reviewer",
      resumeData: { note: "ok" }
    });

    const { finished } = await continueRequest({
      requestId,
      stores: throwingStores,
      flowRegistry: registryFor(flow),
      resumeContext: {
        suspensionId: suspension.suspensionId,
        action: "approve",
        data: { note: "ok" },
        resumedBy: "reviewer"
      },
      runtimeConfig: { durabilityProvider: provider }
    });
    await expect(finished).rejects.toThrow(/injected pre-transition failure/);

    // (a) Suspension reverted to pending — retryable.
    const reloaded = await provider.loadSuspension(requestId, suspension.suspensionId);
    expect(reloaded?.status).toBe("pending");
    expect(reloaded?.resolvedAt).toBeUndefined();
    expect(reloaded?.resumeData).toBeUndefined();

    // (b) Request record still suspended — never crossed the point of no return.
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // (c) Active-request entry deregistered — no leaked heartbeat (Bug 3).
    expect(await stores.activeRequests.get(requestId)).toBeUndefined();

    // (d) A subsequent valid continuation completes.
    failNext = false;
    const reloadedPending = await provider.loadSuspension(requestId, suspension.suspensionId);
    const retry = await resolve(
      flow,
      stores,
      provider,
      requestId,
      reloadedPending!,
      "approve",
      { note: "ok" }
    );
    await retry;
    expect((await stores.request.get(requestId))?.status).toBe("completed");
  });
});
