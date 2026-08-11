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
 * Fire-and-forget is exactly why the returned promise still waits for the child
 * to have **started executing**. Nobody is holding the child's `finished`, so a
 * setup failure has nowhere to surface — the parent has already released the
 * task and returned, and the row sits `in_progress` until lease recovery picks
 * it up minutes later. Execution is the first point past which that cannot
 * happen quietly: from there the run records its own terminal failure, and a
 * detached run's failure additionally reaches the board's recorder, which
 * settles the row.
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
    const handle = inputs.host.dispatch({
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

    // `started` FIRST, and `accepted` only as the fallback. The caller of this
    // operation releases a claimed task on the strength of the result, so the
    // milestone it needs is the one past which a failure cannot be silent —
    // which is execution, not registration. Between the two the child still
    // writes the session's `latestRequestId`, emits its opening events and
    // builds a context that loads eager resources; a failure there records
    // nothing, deregisters the entry, and rejects into a `finished` nobody is
    // holding, leaving the row `in_progress` for lease recovery to find minutes
    // later. See `DispatchHandle.started`.
    //
    // The fallback is not a weaker version of the same thing, it is the only
    // thing a deferred start can offer: a queued or externally dispatched child
    // starts after this call returns, so waiting for its execution would mean
    // waiting out the queue — which is the launching request blocking on
    // detached work. Those paths keep FIX-1070's hand-off gap, unchanged.
    //
    // `finished` is deliberately NOT awaited on any path — awaiting it would
    // make the launching request block on the detached work itself, which is the
    // exact property detachment exists to remove.
    const materialized = handle.started ?? handle.accepted;
    if (materialized !== undefined) await materialized;

    return { requestId: handle.requestId };
  };
}
