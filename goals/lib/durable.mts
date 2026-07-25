/**
 * Durable-execution scaffolding shared by the suspend/resume/crash-recovery goals.
 *
 * Six goals hand-rolled this ceremony before the migration. Only TWO consume
 * these helpers now — the `continue-interrupted-run` pair, which run in-process.
 * The four suspension goals still hand-roll it inside their `harness.mts`,
 * because a harness executes from `apps/kitchen-sink` and cannot import
 * `goals/lib`.
 *
 * That is below the README's own "reach for a helper at the third goal" bar on
 * consumer count, and it is kept deliberately: the duplication it removes is
 * real and pre-existing, and `approvePending` encodes the listSuspended → find →
 * suspend triple that was copy-pasted five times. If the harness-side copies are
 * ever worth deduping, the place for it is an importable helper under
 * `apps/kitchen-sink`, not here.
 */
import {
  createCheckpointDurabilityProvider,
  createFlowRegistry,
  createInMemoryStores,
} from "@flow-state-dev/engine";
import type { SuspensionRecord } from "@flow-state-dev/core/types";

/** A durability provider over the in-memory stores it was built from. */
export type DurabilityProvider = ReturnType<typeof createCheckpointDurabilityProvider>;
/** The in-memory store registry. */
export type Stores = ReturnType<typeof createInMemoryStores>;
/** The flow registry. */
export type FlowRegistry = ReturnType<typeof createFlowRegistry>;

/**
 * Silences the engine's default console runtime logger. A goal grades its own
 * assertions, not the execution trace, and the trace drowns the verdict.
 */
export const silentLogger = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
};

/**
 * In-memory stores plus a checkpoint durability provider over them, and the
 * `runtimeConfig` that wires the two together with the silent logger.
 */
export function durableStores(): {
  stores: Stores;
  provider: DurabilityProvider;
  runtimeConfig: { durabilityProvider: DurabilityProvider; logger: typeof silentLogger };
} {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return {
    stores,
    provider,
    runtimeConfig: { durabilityProvider: provider, logger: silentLogger },
  };
}

/** A registry with these flows registered. */
export function registryFor(...flows: unknown[]): FlowRegistry {
  const registry = createFlowRegistry();
  for (const flow of flows) registry.register(flow as never);
  return registry;
}

/**
 * Find the pending suspension for `requestId` and mark it approved with
 * `resumeData` — exactly what the resume endpoint / DevTool persists.
 *
 * Returns the record so the caller can build the matching `resumeContext`
 * (it needs `suspensionId`). Throws if no pending suspension exists, which is
 * always a goal failure: the run under test did not suspend.
 */
export async function approvePending(
  provider: DurabilityProvider,
  requestId: string,
  resumeData: unknown = {},
): Promise<SuspensionRecord> {
  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s) => s.requestId === requestId);
  if (suspension === undefined) {
    throw new Error(`no pending suspension for request ${requestId} — the run did not suspend`);
  }
  await provider.suspend({
    ...suspension,
    status: "approved",
    resolvedAt: Date.now(),
    resumeData,
  });
  return suspension;
}

/** The `resumeContext` that resolves `suspension` with an approval. */
export function approvalContext(
  suspension: SuspensionRecord,
  data: unknown = {},
  resumedBy?: string,
): { suspensionId: string; action: "approve"; data: unknown; resumedBy?: string } {
  return {
    suspensionId: suspension.suspensionId,
    action: "approve",
    data,
    ...(resumedBy !== undefined ? { resumedBy } : {}),
  };
}
