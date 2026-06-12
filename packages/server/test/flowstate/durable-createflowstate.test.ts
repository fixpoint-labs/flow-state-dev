/**
 * End-to-end: `createFlowState({ durable: true })` builds a working durability
 * provider from its own resolved stores, so a durable action with `ctx.suspend()`
 * suspends and then resumes — the wiring kitchen-sink relies on for its HITL
 * approval gate.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowInstance } from "@flow-state-dev/core";

const approvalStep = handler({
  name: "approval",
  inputSchema: z.object({ request: z.string() }),
  outputSchema: z.string(),
  execute: async (input, ctx) => {
    const decision = (await ctx.suspend!({
      reason: "human_approval",
      message: `Approve ${input.request}?`,
      resumeSchema: z.object({ approved: z.boolean() })
    })) as { approved: boolean };
    return decision.approved ? "approved" : "rejected";
  }
});

const approvalFlow = defineFlow({
  kind: "approval-demo",
  actions: {
    go: {
      block: sequencer({ name: "approval-seq", durable: true }).step(approvalStep),
      durable: true
    }
  }
})();

describe("createFlowState durable: true — end to end", () => {
  it("suspends a durable action and resumes it via the provider built from stores", async () => {
    const fs = createFlowState({
      flows: { approvalFlow },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: (() => undefined) as never,
      durable: true
    });
    const { stores, runtimeConfig } = await fs.getRuntime();
    const provider = runtimeConfig.durabilityProvider;
    expect(provider).toBeDefined();

    // Phase 1: first run suspends at the approval gate.
    const initial = await runAction({
      flow: approvalFlow as FlowInstance,
      actionName: "go",
      input: { request: "deploy" },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig
    });
    const suspendedReq = await stores.request.get(initial.requestId!);
    expect(suspendedReq?.status).toBe("suspended");

    const pending = await provider!.listSuspended({ status: "pending" });
    expect(pending).toHaveLength(1);
    // The Zod resumeSchema must be persisted as a plain JSON Schema (no Zod
    // instance / functions), so the record survives clone + serialization.
    expect(pending[0]!.resumeSchema).toMatchObject({ type: "object" });
    expect(JSON.stringify(pending[0]!.resumeSchema)).toContain("approved");

    // Operator approves (what the DevTool Suspensions tab does via the resume
    // endpoint).
    await provider!.suspend({
      ...pending[0]!,
      status: "approved",
      resolvedAt: Date.now(),
      resumeData: { approved: true }
    });

    // Phase 2: resume run completes with the approved branch.
    const resumed = await runAction({
      flow: approvalFlow as FlowInstance,
      actionName: "go",
      input: { request: "deploy" },
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig,
      metadata: {
        resumeOf: initial.requestId,
        resumeContext: {
          suspensionId: pending[0]!.suspensionId,
          action: "approve",
          data: { approved: true }
        }
      }
    });
    expect(resumed.error).toBeUndefined();
    expect(resumed.output).toBe("approved");

    await fs.dispose();
  });
});
