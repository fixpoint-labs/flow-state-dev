/**
 * Durable human-in-the-loop approval pipeline (chat-agent `requestApproval`).
 *
 * Drives the real `runAction` / `continueRequest` engine against an in-memory
 * checkpoint durability provider to prove the resume semantics the demo flow
 * showcases:
 *   - the pre-suspension step runs once and is REPLAYED (not re-executed) on
 *     resume — its minted `approvalId` is identical before and after;
 *   - APPROVE runs the post-approval blocks and not the rejection block;
 *   - REJECT runs the rejection block and none of the post-approval blocks.
 */
import { describe, expect, it } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/items/internal";
import type {
  FlowInstance,
  SuspensionRecord
} from "@flow-state-dev/core/types";
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  runAction
} from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { approvalGate, approvalGateInput } from "../flows/chat-agent/approval-gate";

// The approval pipeline calls no model. A mock resolver keeps runAction from
// building the default resolver, which validates the ambient FSDEV_INTENT_*
// env overrides against this minimal flow's (absent) declared intents.
const modelResolver = createMockModelResolver({ policy: "allow" });

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });
  return { stores, provider };
}

// Minimal flow that exposes the chat-agent approval pipeline as a durable
// action — isolates the pipeline from the full chat-agent wiring (generators,
// memory, resources) which `requestApproval` never touches.
const approvalFlow = defineFlow({
  kind: "approval-test",
  actions: {
    requestApproval: {
      block: approvalGate,
      inputSchema: approvalGateInput,
      durable: true
    }
  }
})({ id: "approval-test" });

function registryFor(flow: FlowInstance) {
  const registry = createFlowRegistry();
  registry.register(flow as never);
  return registry;
}

// `RuntimeItem[]` accepts both what `runAction` returns and the persisted
// `OutputItem[]` (OutputItem ⊆ RuntimeItem); fields are read via narrow casts.
/** Assistant-message texts in emission order. */
function assistantTexts(items: readonly RuntimeItem[]): string[] {
  return items
    .filter(
      (i) => i.type === "message" && (i as { role?: string }).role === "assistant"
    )
    .flatMap((i) =>
      ((i as { content?: Array<{ text?: string }> }).content ?? [])
        .map((c) => c.text)
        .filter((t): t is string => typeof t === "string")
    );
}

describe("requestApproval durable pipeline", () => {
  it("approve runs the post-approval blocks and replays the prepare step", async () => {
    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow: approvalFlow,
      actionName: "requestApproval",
      input: { request: "deploy v2" },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider, modelResolver }
    });
    const requestId = initial.requestId!;
    expect((await stores.request.get(requestId))?.status).toBe("suspended");

    // The pre-step ran and the gate suspended; post-approval blocks have not run.
    const beforeId = approvalIdFrom(initial.items);
    expect(beforeId).toMatch(/^appr_/);
    expect(assistantTexts(initial.items).some((t) => t.startsWith("Executing"))).toBe(false);

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(stores, provider, requestId, suspension, "approve", { note: "ship it" });
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    const record = await stores.request.get(requestId);
    const texts = assistantTexts(record!.items ?? []);
    // Post-approval blocks ran; the rejection block did not.
    expect(texts.some((t) => t.startsWith("Executing approved action"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Done."))).toBe(true);
    expect(texts.some((t) => t.startsWith("Rejected"))).toBe(false);

    // The prepare step was replayed (injected), not re-run: the approvalId is
    // unchanged across the suspend/resume boundary.
    const afterId = approvalIdFrom(record!.items ?? []);
    expect(afterId).toBe(beforeId);
  });

  it("reject runs the rejection block and skips the post-approval blocks", async () => {
    const { stores, provider } = createDurableStores();
    const initial = await runAction({
      flow: approvalFlow,
      actionName: "requestApproval",
      input: { request: "delete prod db" },
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider, modelResolver }
    });
    const requestId = initial.requestId!;

    const [suspension] = await provider.listSuspended({ status: "pending" });
    await resolve(stores, provider, requestId, suspension, "reject", { note: "too risky" });
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    const record = await stores.request.get(requestId);
    const texts = assistantTexts(record!.items ?? []);
    expect(texts.some((t) => t.startsWith("Rejected — too risky"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Executing approved action"))).toBe(false);
    expect(texts.some((t) => t.startsWith("Done."))).toBe(false);
  });
});

/** Extract the minted approval id from the prepare step's message. */
function approvalIdFrom(items: readonly RuntimeItem[]): string | undefined {
  for (const text of assistantTexts(items)) {
    const match = text.match(/\b(appr_[0-9a-f]+)\b/);
    if (match) return match[1];
  }
  return undefined;
}

async function resolve(
  stores: ReturnType<typeof createDurableStores>["stores"],
  provider: ReturnType<typeof createDurableStores>["provider"],
  requestId: string,
  suspension: SuspensionRecord,
  action: "approve" | "reject",
  data?: unknown
): Promise<void> {
  await provider.suspend({
    ...suspension,
    status: action === "approve" ? "approved" : "rejected",
    resolvedAt: Date.now(),
    resumeData: data
  });
  const { finished } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registryFor(approvalFlow),
    resumeContext: { suspensionId: suspension.suspensionId, action, data, resumedBy: "reviewer" },
    runtimeConfig: { durabilityProvider: provider, modelResolver }
  });
  await finished;
}
