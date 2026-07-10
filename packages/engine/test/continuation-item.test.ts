/**
 * FIX-865: the engine emits exactly one `ContinuationItem` on crash-recovery
 * `/continue` re-entry — never on `/retry`, a fresh run, or `/resume`'s
 * suspension re-entry (which keeps emitting `suspension_resume`).
 *
 * These tests reuse the FIX-811 crash-simulation pattern from
 * suspension-resume.test.ts: suspend a durable sequencer, flip the record to
 * `interrupted` (as the stale sweeper would after a crash), then continue.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  retryRequest,
  runAction
} from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ContinuationItem } from "@flow-state-dev/core/items";

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

/** A durable sequencer with one pre-step and a suspending gate — the shared
 *  fixture for crash-recovery simulation across these tests. */
function buildCrashFlow(kind: string) {
  const preStep = handler({
    name: "preStep",
    inputSchema: z.any(),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true })
  });
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_i, ctx) => ctx.suspend!({ reason: "human_approval", message: "Approve?" })
  });
  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true }).step(preStep).step(gate),
        inputSchema: z.any()
      }
    }
  })({ id: kind });
}

/** Runs `flow` to its first suspension, then flips the record to
 *  `interrupted` to simulate a crash mid-flight. */
async function runToInterrupted(flow: FlowInstance, stores: ReturnType<typeof createInMemoryStores>, provider: ReturnType<typeof createCheckpointDurabilityProvider>) {
  const initial = await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    stores,
    runtimeConfig: { durabilityProvider: provider }
  });
  const requestId = initial.requestId!;
  const suspended = await stores.request.get(requestId);
  await stores.request.set(
    requestId,
    { ...suspended!, status: "interrupted", interruptedAt: Date.now() },
    "any"
  );
  return requestId;
}

function continuationItems(items: readonly { type: string }[] | undefined): ContinuationItem[] {
  return ((items ?? []) as ContinuationItem[]).filter((i) => i.type === "continuation");
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

describe("ContinuationItem — crash-recovery /continue (FIX-865)", () => {
  it("emits exactly one continuation item with trigger 'recovery' and a correct priorItemCount", async () => {
    const flow = buildCrashFlow("fix865-continue-basic");
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    const priorItemCount = (await stores.request.get(requestId))!.items!.length;

    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    const after = await stores.request.get(requestId);
    const items = continuationItems(after?.items);
    expect(items).toHaveLength(1);
    expect(items[0].trigger).toBe("recovery");
    expect(items[0].priorItemCount).toBe(priorItemCount);
  });

  it("does not emit a continuation item on a fresh run", async () => {
    const flow = buildCrashFlow("fix865-fresh-run");
    const { stores, provider } = createDurableStores();
    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(continuationItems(result.items)).toHaveLength(0);
  });

  it("does not emit a continuation item on /retry (a fresh request id)", async () => {
    const flow = buildCrashFlow("fix865-retry");
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    const { newRequestId, liveStream } = await retryRequest({
      originalRequestId: requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    const reader = liveStream.readable.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const retried = await stores.request.get(newRequestId);
    expect(continuationItems(retried?.items)).toHaveLength(0);
    // The original interrupted record is untouched by retry.
    const original = await stores.request.get(requestId);
    expect(continuationItems(original?.items)).toHaveLength(0);
  });

  it("emits suspension_resume (not continuation) on /resume's suspension re-entry", async () => {
    const flow = buildCrashFlow("fix865-resume");
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

    await provider.suspend({
      ...suspension,
      status: "approved",
      resolvedAt: Date.now(),
      resumeData: undefined
    });
    const { finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      resumeContext: { suspensionId: suspension.suspensionId, action: "approve", resumedBy: "reviewer" },
      runtimeConfig: { durabilityProvider: provider }
    });
    await finished;

    const after = await stores.request.get(requestId);
    expect((after?.items ?? []).some((i) => i.type === "suspension_resume")).toBe(true);
    expect(continuationItems(after?.items)).toHaveLength(0);
  });

  it("gives two independently-continued interrupted requests each their own single continuation item", async () => {
    const flowA = buildCrashFlow("fix865-multi-a");
    const flowB = buildCrashFlow("fix865-multi-b");
    const { stores, provider } = createDurableStores();

    const requestIdA = await runToInterrupted(flowA, stores, provider);
    const requestIdB = await runToInterrupted(flowB, stores, provider);

    const registry = createFlowRegistry();
    registry.register(flowA as never);
    registry.register(flowB as never);

    const { finished: finishedA } = await continueRequest({
      requestId: requestIdA,
      stores,
      flowRegistry: registry,
      runtimeConfig: { durabilityProvider: provider }
    });
    await finishedA;
    const { finished: finishedB } = await continueRequest({
      requestId: requestIdB,
      stores,
      flowRegistry: registry,
      runtimeConfig: { durabilityProvider: provider }
    });
    await finishedB;

    const afterA = await stores.request.get(requestIdA);
    const afterB = await stores.request.get(requestIdB);
    expect(continuationItems(afterA?.items)).toHaveLength(1);
    expect(continuationItems(afterB?.items)).toHaveLength(1);
    // No cross-contamination of ids between the two requests' continuation items.
    expect(continuationItems(afterA?.items)[0].requestId).toBe(requestIdA);
    expect(continuationItems(afterB?.items)[0].requestId).toBe(requestIdB);
  });
});

describe("continueRequest's live stream — includeTrace (FIX-865 gap fix)", () => {
  it("forwards block_trace items from the resumed portion when includeTrace is true", async () => {
    const flow = buildCrashFlow("fix865-continue-includetrace-on");
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    const { liveStream, finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider },
      includeTrace: true
    });
    const text = await drain(liveStream!.readable);
    await finished;

    expect(text).toContain("block_trace");
  });

  it("still filters out block_trace items by default (no includeTrace — regression check)", async () => {
    const flow = buildCrashFlow("fix865-continue-includetrace-off");
    const { stores, provider } = createDurableStores();
    const requestId = await runToInterrupted(flow, stores, provider);

    const { liveStream, finished } = await continueRequest({
      requestId,
      stores,
      flowRegistry: registryFor(flow),
      runtimeConfig: { durabilityProvider: provider }
    });
    const text = await drain(liveStream!.readable);
    await finished;

    expect(text).not.toContain("block_trace");
  });
});
