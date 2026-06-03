/**
 * FIX-140: Suspension and resume integration tests.
 *
 * Verifies the ctx.suspend() → suspended status → resume endpoint → flow
 * completion lifecycle for durable actions.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
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
