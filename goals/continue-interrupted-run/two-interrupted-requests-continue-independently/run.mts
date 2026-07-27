/**
 * Goal check — two interrupted requests continue independently.
 *
 * Real path, no mocking, out of CI. See goal.md for the contract, and the
 * sibling `continues-not-restarts` goal.md for why the interruption is
 * manufactured in-process rather than via a real second-process crash.
 *
 * Builds TWO independent durable sequencers (flowA, flowB), each with its own
 * handler-run counter, interrupts both, continues each by its own request id
 * (crash-recovery, then approval), and asserts no cross-contamination: each
 * continuation item is attributed to the right request, each counter only
 * ever sees its own flow's runs, and both requests reach "completed" under
 * their own distinct ids.
 *
 * Run: pnpm tsx goals/continue-interrupted-run/two-interrupted-requests-continue-independently/run.mts
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { continueRequest, runAction } from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ContinuationItem } from "@flow-state-dev/core/items";
import {
  approvalContext,
  approvePending,
  durableStores,
  registryFor,
  runGoal,
  stripIntentOverrides,
  type DurabilityProvider,
  type FlowRegistry,
  type Stores,
} from "../../lib/index.mts";

// No generator/model intents declared by these flows (see goal.md's Model
// field); clear pinned overrides so createModelResolver doesn't throw.
stripIntentOverrides();

function continuationItems(items: readonly { type: string }[] | undefined): ContinuationItem[] {
  return ((items ?? []) as ContinuationItem[]).filter((i) => i.type === "continuation");
}

/** Builds one independent durable flow: step (counter) → suspend. */
function buildFlow(kind: string, counter: { runs: number }): FlowInstance {
  const step = handler({
    name: "step",
    inputSchema: z.any(),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      counter.runs += 1;
      return { ok: true };
    },
  });
  const gate = handler({
    name: "gate",
    inputSchema: z.any(),
    outputSchema: z.unknown(),
    execute: async (_i: unknown, ctx: { suspend?: (payload: unknown) => unknown }) =>
      ctx.suspend!({ reason: "human_approval", message: "Approve?" }),
  });
  return defineFlow({
    kind,
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true }).step(step).step(gate),
        inputSchema: z.any(),
      },
    },
  })({ id: kind }) as FlowInstance;
}

/** Runs a flow to its first suspension, then flips the record to
 *  "interrupted" to simulate a crash mid-flight (same technique as the
 *  sibling goal / the engine's own crash-recovery tests). */
async function runToInterrupted(
  flow: FlowInstance,
  stores: Stores,
  runtimeConfig: unknown,
): Promise<{ requestId: string; failures: string[] }> {
  const initial = await runAction({
    flow: flow as never,
    actionName: "run",
    input: {},
    userId: "goal-user",
    stores,
    runtimeConfig: runtimeConfig as never,
  });
  const requestId = initial.requestId!;
  const record = await stores.request.get(requestId);
  if (record?.status !== "suspended") {
    return { requestId, failures: [`expected ${flow.id} to suspend, got status "${record?.status}"`] };
  }
  await stores.request.set(
    requestId,
    { ...record, status: "interrupted", interruptedAt: Date.now() },
    "any",
  );
  return { requestId, failures: [] };
}

async function continueAndApprove(
  requestId: string,
  registry: FlowRegistry,
  stores: Stores,
  provider: DurabilityProvider,
  runtimeConfig: unknown,
): Promise<{ continuation?: ContinuationItem; finalStatus: string; failures: string[] }> {
  // Crash-recovery re-entry: no resumeContext.
  const { finished: recovered } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    runtimeConfig: runtimeConfig as never,
  });
  await recovered;

  const afterRecovery = await stores.request.get(requestId);
  const contItems = continuationItems(afterRecovery?.items);
  if (contItems.length !== 1) {
    return {
      finalStatus: "unknown",
      failures: [`expected exactly one continuation item for ${requestId}, found ${contItems.length}`],
    };
  }

  // Resolve the re-suspended gate to drive this SAME id to completion.
  const suspension = await approvePending(provider, requestId);

  const { finished: resolved } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: approvalContext(suspension) as never,
    runtimeConfig: runtimeConfig as never,
  });
  const result = await resolved;

  const failures: string[] = [];
  if (result.requestId !== requestId) {
    failures.push(`resolving continue for ${requestId} produced a different id (${result.requestId})`);
  }
  const finalRecord = await stores.request.get(requestId);
  return { continuation: contItems[0], finalStatus: finalRecord?.status ?? "unknown", failures };
}

await runGoal(async () => {
  const failures: string[] = [];
  const counterA = { runs: 0 };
  const counterB = { runs: 0 };
  const flowA = buildFlow("goal-continue-two-a", counterA);
  const flowB = buildFlow("goal-continue-two-b", counterB);

  const { stores, provider, runtimeConfig } = durableStores();
  const registry = registryFor(flowA, flowB);

  const a = await runToInterrupted(flowA, stores, runtimeConfig);
  const b = await runToInterrupted(flowB, stores, runtimeConfig);
  failures.push(...a.failures, ...b.failures);
  if (failures.length > 0) return { failures, evidence: "" };

  if (a.requestId === b.requestId) failures.push("test setup produced the same request id for both flows");
  if (counterA.runs !== 1 || counterB.runs !== 1) {
    failures.push(
      `expected each flow's step to run exactly once before suspension, got A=${counterA.runs} B=${counterB.runs}`,
    );
  }

  const resultA = await continueAndApprove(a.requestId, registry, stores, provider, runtimeConfig);
  const resultB = await continueAndApprove(b.requestId, registry, stores, provider, runtimeConfig);
  failures.push(...resultA.failures, ...resultB.failures);

  // (a) No cross-wiring: each continuation item is attributed to its own request.
  if (resultA.continuation !== undefined && resultA.continuation.requestId !== a.requestId) {
    failures.push(
      `flowA's continuation item is attributed to "${resultA.continuation.requestId}", expected "${a.requestId}"`,
    );
  }
  if (resultB.continuation !== undefined && resultB.continuation.requestId !== b.requestId) {
    failures.push(
      `flowB's continuation item is attributed to "${resultB.continuation.requestId}", expected "${b.requestId}"`,
    );
  }

  // (b) No cross-contaminated side effects: each counter only ever saw its
  // own flow's step run once, across the whole sequence (suspend + two
  // continues each, for both flows).
  if (counterA.runs !== 1) failures.push(`flowA's step counter is ${counterA.runs}, expected 1 — cross-contaminated or re-executed`);
  if (counterB.runs !== 1) failures.push(`flowB's step counter is ${counterB.runs}, expected 1 — cross-contaminated or re-executed`);

  // (c) Both requests reach "completed" under their own distinct ids.
  if (resultA.finalStatus !== "completed") failures.push(`flowA's request ${a.requestId} ended as "${resultA.finalStatus}", expected "completed"`);
  if (resultB.finalStatus !== "completed") failures.push(`flowB's request ${b.requestId} ended as "${resultB.finalStatus}", expected "completed"`);

  return {
    failures,
    evidence:
      `two interrupted requests (${a.requestId}, ${b.requestId}) each continued independently: ` +
      `each got exactly one continuation item attributed to its own id, each flow's step counter stayed ` +
      `at 1 (no cross-contamination), and both reached "completed" under their own distinct request ids.`,
  };
});
