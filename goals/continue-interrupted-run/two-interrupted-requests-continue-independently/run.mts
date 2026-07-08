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
import {
  continueRequest,
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
  runAction,
} from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { ContinuationItem } from "@flow-state-dev/core/items";

// No generator/model intents declared by these flows (see goal.md's Model
// field); strip pinned overrides so createModelResolver doesn't throw. See
// the sibling goal's run.mts for the same fix.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("FSDEV_INTENT_") || key === "FSDEV_DEFAULT_MODEL") delete process.env[key];
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function fail(msg: string): never {
  console.error("FAIL —\n  - " + msg);
  process.exit(1);
}

function createDurableStores() {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider };
}

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
  stores: ReturnType<typeof createInMemoryStores>,
  runtimeConfig: { durabilityProvider: unknown; logger: unknown },
): Promise<string> {
  const initial = await runAction({
    flow,
    actionName: "run",
    input: {},
    userId: "goal-user",
    stores,
    runtimeConfig: runtimeConfig as never,
  });
  const requestId = initial.requestId!;
  const record = await stores.request.get(requestId);
  if (record?.status !== "suspended") fail(`expected ${flow.id} to suspend, got status "${record?.status}"`);
  await stores.request.set(requestId, { ...record, status: "interrupted", interruptedAt: Date.now() }, "any");
  return requestId;
}

async function continueAndApprove(
  requestId: string,
  flow: FlowInstance,
  registry: ReturnType<typeof createFlowRegistry>,
  stores: ReturnType<typeof createInMemoryStores>,
  provider: ReturnType<typeof createCheckpointDurabilityProvider>,
  runtimeConfig: { durabilityProvider: unknown; logger: unknown },
): Promise<{ continuation: ContinuationItem; finalStatus: string }> {
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
    fail(`expected exactly one continuation item for ${requestId}, found ${contItems.length}`);
  }

  // Resolve the re-suspended gate to drive this SAME id to completion.
  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s) => s.requestId === requestId);
  if (!suspension) fail(`expected a pending suspension for ${requestId} after crash-recovery re-entry`);
  await provider.suspend({ ...suspension, status: "approved", resolvedAt: Date.now(), resumeData: {} });

  const { finished: resolved } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: { suspensionId: suspension.suspensionId, action: "approve", data: {} },
    runtimeConfig: runtimeConfig as never,
  });
  const result = await resolved;
  if (result.requestId !== requestId) {
    fail(`resolving continue for ${requestId} produced a different id (${result.requestId})`);
  }

  const finalRecord = await stores.request.get(requestId);
  return { continuation: contItems[0], finalStatus: finalRecord?.status ?? "unknown" };
}

async function main(): Promise<void> {
  const counterA = { runs: 0 };
  const counterB = { runs: 0 };
  const flowA = buildFlow("goal-continue-two-a", counterA);
  const flowB = buildFlow("goal-continue-two-b", counterB);

  const { stores, provider } = createDurableStores();
  const runtimeConfig = { durabilityProvider: provider, logger: silentLogger };

  const registry = createFlowRegistry();
  registry.register(flowA as never);
  registry.register(flowB as never);

  const requestIdA = await runToInterrupted(flowA, stores, runtimeConfig);
  const requestIdB = await runToInterrupted(flowB, stores, runtimeConfig);
  if (requestIdA === requestIdB) fail("test setup produced the same request id for both flows");
  if (counterA.runs !== 1 || counterB.runs !== 1) {
    fail(`expected each flow's step to run exactly once before suspension, got A=${counterA.runs} B=${counterB.runs}`);
  }

  const resultA = await continueAndApprove(requestIdA, flowA, registry, stores, provider, runtimeConfig);
  const resultB = await continueAndApprove(requestIdB, flowB, registry, stores, provider, runtimeConfig);

  // (a) No cross-wiring: each continuation item is attributed to its own request.
  if (resultA.continuation.requestId !== requestIdA) {
    fail(`flowA's continuation item is attributed to "${resultA.continuation.requestId}", expected "${requestIdA}"`);
  }
  if (resultB.continuation.requestId !== requestIdB) {
    fail(`flowB's continuation item is attributed to "${resultB.continuation.requestId}", expected "${requestIdB}"`);
  }

  // (b) No cross-contaminated side effects: each counter only ever saw its
  // own flow's step run once, across the whole sequence (suspend + two
  // continues each, for both flows).
  if (counterA.runs !== 1) fail(`flowA's step counter is ${counterA.runs}, expected 1 — cross-contaminated or re-executed`);
  if (counterB.runs !== 1) fail(`flowB's step counter is ${counterB.runs}, expected 1 — cross-contaminated or re-executed`);

  // (c) Both requests reach "completed" under their own distinct ids.
  if (resultA.finalStatus !== "completed") fail(`flowA's request ${requestIdA} ended as "${resultA.finalStatus}", expected "completed"`);
  if (resultB.finalStatus !== "completed") fail(`flowB's request ${requestIdB} ended as "${resultB.finalStatus}", expected "completed"`);

  console.log(
    `PASS — two interrupted requests (${requestIdA}, ${requestIdB}) each continued independently: ` +
      `each got exactly one continuation item attributed to its own id, each flow's step counter stayed ` +
      `at 1 (no cross-contamination), and both reached "completed" under their own distinct request ids.`,
  );
}

main().catch((err) => {
  fail(err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err));
});
