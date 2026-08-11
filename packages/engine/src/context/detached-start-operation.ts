/**
 * The host operation that actually starts a detached request (FIX-982 P3a).
 *
 * `RequestHost.startDetached` prepares the child session — derives its id from
 * the seed and the running request's identity, creates it or adopts an existing
 * one, stamps the routing labels — and then hands off to *this* to start the
 * run. Until now nothing supplied the hand-off, and `createFlowState` said so in
 * as many words: *"no host start operation exists yet, and the verb refuses by
 * name rather than pretending otherwise."* So every detached start refused
 * `no-start-operation`, and detachment was declarable but never runnable.
 *
 * ## Why the start goes through the transport host rather than a dispatcher
 *
 * A detached request is an ordinary request in every respect that matters to the
 * runtime: it needs a request record, an `activeRequests` registration, an abort
 * registration, retention, and — under an external dispatcher — enqueue-time
 * materialization so the row is discoverable before any worker picks it up.
 * `host.dispatch` is the one seam that does all of that, and reaching past it to
 * a dispatcher would rebuild a subset of it that drifts.
 *
 * ## What makes this dispatch un-forgeable
 *
 * The envelope is assembled here, from values the seam derived, and two fields
 * carry the whole security posture:
 *
 * - **`source: WORKSTREAM_SOURCE`.** `resolveActionCore` treats this source as
 *   **terminal** — it resolves the flow's one workstream core or nothing, and
 *   never falls through to `flow.actions`. A caller cannot set a source, so a
 *   detached dispatch cannot be forged from a transport, and the `actionName`
 *   below is provenance rather than routing.
 * - **The principal.** Taken from the identity `startDetached` closed over, which
 *   is the running request's server-derived identity, never anything the calling
 *   block supplied. The child inherits its parent's principal, tenant and org
 *   because it *is* that principal's work.
 *
 * ## Fire-and-forget, deliberately
 *
 * `responseEmitter: null` — the whole point is that the launching request
 * returns while this keeps running, so there is no live stream to attach and no
 * caller waiting on `finished`. Consumers read the child's progress the durable
 * way: enumerate the parent's Workstreams, then that Workstream's requests.
 *
 * Fire-and-forget is exactly why the returned promise still waits for the host
 * to have **accepted** the dispatch. Nobody is holding the child's `finished`,
 * so without it a setup failure has nowhere to surface at all: the parent
 * reports success, and the row waits out its lease with nothing anywhere saying
 * why.
 *
 * It waits for that and nothing more, deliberately. The row itself is protected
 * by its lease — a child that dies at any point leaves a lease nobody renews,
 * and the next drain recovers the row. Waiting for a later milestone would only
 * change which failures cost one lease of latency, at the price of coupling the
 * launching request to the child's startup.
 */
import type { DetachedStartOperation } from "./create-request-host";
import type { InboundTransportHost } from "../transports/types";
import { WORKSTREAM_SOURCE } from "../execution/transport-sources";

export type DetachedStartOperationInputs = {
  /**
   * The host whose `dispatch` this drives.
   *
   * One host serves every flow it has registered, so the flow kind is **not** a
   * construction input — it arrives per call, from the seam, as the parent
   * request's own kind. A child always belongs to its parent's flow.
   */
  host: Pick<InboundTransportHost, "dispatch">;
};

/**
 * Build the start operation a host wires onto `runtimeConfig.requestHost`.
 *
 * @param inputs The host to dispatch through.
 */
export function createDetachedStartOperation(
  inputs: DetachedStartOperationInputs
): DetachedStartOperation {
  return async (spec) => {
    // A SYNCHRONOUS throw here is definitively pre-dispatch: `host.dispatch`
    // resolves the flow and claims the concurrency key before it starts
    // anything, so an unknown flow, a `reject` policy whose key is already held,
    // or exhausted stream capacity all land before a child exists. Reported as
    // "not started" rather than thrown, because the caller can settle work it
    // still owns — and a throw cannot be read that way, since one raised after
    // the attempt cannot rule out a live child (FIX-982).
    let handle: ReturnType<typeof inputs.host.dispatch>;
    try {
      handle = inputs.host.dispatch({
      source: WORKSTREAM_SOURCE,
      flowKind: spec.flowKind,
      // Provenance only. The source branch above is terminal, so this name is
      // never resolved against `flow.actions` — it exists so an operator reading
      // a request record can see which block the dispatch entered.
      action: spec.actionName,
      input: spec.input,
      sessionId: spec.sessionId,
      principal: { userId: spec.userId },
      ...(spec.orgId !== undefined ? { orgId: spec.orgId } : {}),
      ...(spec.tenantId !== undefined ? { tenantId: spec.tenantId } : {}),
      ...(spec.metadata !== undefined ? { metadata: spec.metadata } : {}),
      // Fire-and-forget: no live stream, nobody attached, nothing awaiting the
      // result inline. See the file header.
        responseEmitter: null,
      });
    } catch (error) {
      return {
        notStarted: true,
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    // Awaiting acceptance is what makes a `Started` result mean "discoverable"
    // rather than "we intended to". It is deliberately the ONLY thing awaited,
    // and deliberately not a stronger milestone.
    //
    // The row is not what this protects. A detached hand-off leaves the row
    // holding a lease nobody renews, so a child that dies — in setup, mid-run,
    // or with its process — lets that lease lapse and the next drain recovers
    // it. That is the designed path for every way a child can die, and waiting
    // for a later milestone does not improve on it; it only narrows which
    // failures cost one lease instead of none. Three rounds of this issue chased
    // that narrowing believing it was a correctness fix.
    //
    // What acceptance genuinely buys is that a dead child is VISIBLE. Nobody
    // holds the child's `finished`, so without this a registration failure is
    // swallowed and the parent reports success; with it, the parent's request
    // carries the failure at the moment it happened.
    if (handle.accepted !== undefined) await handle.accepted;

    return { requestId: handle.requestId };
  };
}
