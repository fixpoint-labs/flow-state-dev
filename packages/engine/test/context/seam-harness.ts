/**
 * Test harness for driving the dispatch seam directly.
 *
 * Several suites need "a child session minted by the real writer" as a
 * precondition — the lineage-root resource tests, the tombstone-revival
 * control, the children listing's label cases — without caring how the child
 * request then runs. They all build the seam over a stub dispatch operation
 * and put one `{ key }` dispatch through it; this is that, written once.
 *
 * Nothing here is under test. A suite that IS testing the seam (refusals,
 * adoption, provenance) builds its own `createRequestHost` so the assertion
 * sits next to the thing it exercises.
 */
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { DispatchOutcome, FlowInstance } from "@flow-state-dev/core/types";
import { createRequestHost, type RequestHostInputs } from "../../src/context/create-request-host";
import type { DispatchOperation } from "../../src/context/dispatch-operation";

/** The entry every child dispatched through this harness is addressed to. */
export const CHILD_ENTRY = { type: "internal", target: "work" } as const;

/**
 * A flow with one public action and one `internal` entry, `work` — the
 * smallest shape the seam admits a `{ key }` dispatch on.
 */
export function dispatchableFlow(kind: string): FlowInstance {
  return defineFlow({
    kind,
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({ name: `${kind}-run`, execute: () => ({}) })
      }
    },
    internal: {
      actions: { work: { block: handler({ name: `${kind}-work`, execute: () => ({}) }) } }
    }
  })({ id: kind }) as unknown as FlowInstance;
}

export type DispatchChildOptions = {
  /** The running request's identity. `lineageId` is inherited by the child verbatim. */
  identity: RequestHostInputs["identity"];
  /** Replaces the stub that reports `req_child` without running anything. */
  dispatchOperation?: DispatchOperation;
  /** Server-derived facts to stamp beside the address. */
  provenance?: Record<string, unknown>;
  payload?: unknown;
};

/**
 * Dispatch one `{ key }` child of `identity.sessionId` through the real seam,
 * returning the seam's own outcome so a caller can assert on `adopted`.
 */
export function dispatchChild(
  stores: RequestHostInputs["stores"],
  flow: FlowInstance,
  key: string,
  options: DispatchChildOptions
): Promise<DispatchOutcome> {
  const { seam } = createRequestHost({
    stores,
    flow,
    identity: options.identity,
    dispatchOperation: options.dispatchOperation ?? (async () => ({ requestId: "req_child" })),
    // Healthy gate inputs; the in-memory registry is per-process, so liveness
    // is refused regardless — it plays no part in a dispatch.
    liveness: { staleThresholdMs: 60_000, heartbeatIntervalMs: 10_000, staleSweepIntervalMs: 30_000 }
  });
  return seam({
    ...CHILD_ENTRY,
    session: { key },
    payload: options.payload ?? {},
    from: "test-dispatcher",
    ...(options.provenance !== undefined ? { provenance: options.provenance } : {})
  });
}

/** `dispatchChild`, throwing on a refusal and returning the child's bare session id. */
export async function spawnChild(
  stores: RequestHostInputs["stores"],
  flow: FlowInstance,
  key: string,
  options: DispatchChildOptions
): Promise<string> {
  const outcome = await dispatchChild(stores, flow, key, options);
  if (!outcome.ok) throw new Error(`dispatch refused: ${outcome.refused} — ${outcome.detail}`);
  return outcome.sessionId;
}
