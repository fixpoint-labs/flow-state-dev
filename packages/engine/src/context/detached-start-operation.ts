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
    // A SYNCHRONOUS throw here is pre-dispatch, and that is a property
    // `host.dispatch` is BUILT to hold rather than one this seam infers.
    // Everything that can throw synchronously — resolving the flow, claiming the
    // concurrency key, the kickoff itself — runs before a child exists; the one
    // step that runs after the child has started, the `onBackgroundWork`
    // keep-alive hook, is contained there precisely so it cannot escape as a
    // throw. Read `createInboundTransportHost`'s note on that hook before
    // relying on this: an uncontained post-start throw would arrive here
    // indistinguishable from a refusal, and the caller would settle a row whose
    // child is still running (FIX-982).
    //
    // Reported as "not started" rather than thrown, because the caller can
    // settle work it still owns — and a throw cannot be read that way, since one
    // raised after the attempt cannot rule out a live child.
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
    //
    // A REJECTED acceptance is reported as not-started, for the same reason a
    // synchronous refusal is: the caller still owns the work and can settle it,
    // where a throw leaves it holding nothing it can act on. Note this is the
    // OPPOSITE correction to the one above and on the same axis — there a
    // synchronous throw turned out to reach here from after the start and had to
    // stop being read as a refusal; here a rejection that always comes from
    // before it should start being read as one (FIX-982, FIX-1095).
    //
    // What makes that safe is narrower than "no child can be running", so it is
    // written out rather than asserted. Under an external dispatcher `accepted`
    // rejects from exactly one place: the enqueue-time chain in `dispatch`, whose
    // `catch` awaits `terminateUnenqueuedRequest` BEFORE rethrowing. So by the
    // time this rejection is observable the request record is already terminal.
    // Two of that chain's three failure sources — the `activeRequests` register
    // and the request-record write — reject before the dispatcher is called at
    // all, so no job exists. The third is the enqueue itself, and there the host
    // cannot know whether a job landed: a queue write that commits and loses its
    // ack rejects with the job live.
    //
    // The row survives that residue anyway, because settling it is fenced
    // elsewhere. A child that did land re-reads the row at the Workstream start
    // gate, which refuses unless `attempts`, `createdAt`, `incarnationId`, the
    // lease AND `status === "in_progress"` all still hold — so once the caller
    // fails the row, a late child is refused rather than allowed to settle it.
    // What is NOT closed is the window before that settle commits, where a child
    // could pass the gate first; that is the same "claimed but not yet started"
    // modelling FIX-1070 left open, and it is the lease's shape to change.
    if (handle.accepted !== undefined) {
      try {
        await handle.accepted;
      } catch (error) {
        return {
          notStarted: true,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return { requestId: handle.requestId };
  };
}
