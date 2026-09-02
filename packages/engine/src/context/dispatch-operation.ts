/**
 * The host operation that starts the request a dispatch becomes.
 *
 * The dispatch seam (`create-request-host.ts`) resolves the entry and the
 * session — derives and adopts a child, or verifies an existing session — and
 * then hands off to *this* to start the run. It is the one place a dispatched
 * message becomes an `InboundRequestEnvelope`.
 *
 * ## Why the start goes through the transport host rather than a dispatcher
 *
 * A dispatched request is an ordinary request in every respect that matters to
 * the runtime: it needs a request record, an `activeRequests` registration, an
 * abort registration, retention, and — under an external dispatcher —
 * enqueue-time materialization so the row is discoverable before any worker
 * picks it up. `host.dispatch` is the one seam that does all of that, and
 * reaching past it to a dispatcher would rebuild a subset of it that drifts.
 *
 * ## What makes this dispatch un-forgeable
 *
 * The envelope is assembled here, from values the seam derived, and two fields
 * carry the whole security posture:
 *
 * - **`source`** is the message type — `task` or `internal` — and it is what
 *   resolution keys on. A caller cannot set a source, so a dispatched message
 *   cannot be forged from a transport, and `action` below resolves one entry
 *   map with no fallback into `flow.actions`.
 * - **The principal.** Taken from the identity the seam closed over, which is
 *   the running request's server-derived identity, never anything the calling
 *   block supplied. The dispatched request inherits its sender's principal,
 *   tenant and org because it *is* that principal's work.
 *
 * ## Fire-and-forget, deliberately
 *
 * `responseEmitter: null` — the whole point is that the dispatching request
 * returns while this keeps running, so there is no live stream to attach and
 * no caller waiting on `finished`. Consumers read the dispatched request's
 * progress the durable way: the target session's own request list.
 *
 * Fire-and-forget is exactly why the returned promise still waits for the host
 * to have **accepted** the dispatch. Nobody is holding the request's `finished`,
 * so without it a setup failure has nowhere to surface at all: the sender
 * reports success, and a task row waits out its lease with nothing anywhere
 * saying why.
 *
 * It waits for that and nothing more, deliberately. A task row is protected by
 * its lease — a child that dies at any point leaves a lease nobody renews, and
 * the next drain recovers the row. Waiting for a later milestone would only
 * change which failures cost one lease of latency, at the price of coupling the
 * dispatching request to the child's startup.
 */
import type { DispatchableMessageType } from "@flow-state-dev/core/types";
import type { InboundTransportHost } from "../transports/types";
import type { RuntimeConfig } from "../runtime-config";

/**
 * Starts a request the seam has already resolved the session for. Supplied by
 * the host, because dispatch must go through the host-level arbiter and
 * enqueue-time materialization rather than straight to a dispatcher.
 */
export type DispatchOperation = (spec: {
  /** The message type, stamped as the envelope's `source`. */
  source: DispatchableMessageType;
  /** The entry name — the envelope's `action`, resolved on the type's own map. */
  target: string;
  sessionId: string;
  input: unknown;
  /** The flow the request belongs to — always the sender's own (same-flow v1). */
  flowKind: string;
  /**
   * The request's principal, tenant and org.
   *
   * Passed rather than re-read from the session record the seam just wrote or
   * verified: these are the values the seam **derived the child key from** or
   * validated the existing session against, so passing them is what makes the
   * dispatch provably the same identity as the record. Re-reading would
   * introduce a second source that can disagree, and the disagreement would be
   * a request running under an identity the key was never derived for.
   */
  userId: string;
  tenantId?: string;
  orgId?: string;
  /**
   * Provenance stamped onto the request record — the address, the sending
   * block, and whatever server-derived facts the sender supplied (a board's
   * task id). Server-assembled; never the caller's bag.
   */
  metadata?: Record<string, unknown>;
  /**
   * The runtime config the SENDING request is running under, for the
   * dispatched request to inherit (FIX-1077).
   *
   * A host is built once, but a caller may run a given request under a derived
   * config — `fsdev run` builds `{ ...appConfig, modelResolver, logger }` so
   * `--model` takes effect. The dispatched request is that request's own work
   * continued elsewhere, so it runs under the same resolvers and logger rather
   * than the host's construction-time ones. Absent → the host's own config.
   */
  runtimeConfig?: RuntimeConfig;
}) => Promise<
  | { requestId: string }
  /**
   * The dispatch never happened, definitively. Distinguished from a thrown
   * rejection because the two need opposite handling by the caller: nothing
   * started means the caller still owns whatever it was about to hand over, so
   * it can settle it; a throw after the attempt cannot rule out a live child.
   */
  | { notStarted: true; reason: string }
>;

/**
 * A dispatched request handed to `onDispatched`, with enough identity to name it.
 *
 * The ids are not decoration: a host that gives up waiting on this child has to
 * say *which* work it abandoned, or the notice is barely better than the silence
 * it replaced. These are what someone types into a log search or a store read to
 * find the row afterwards.
 */
export type DispatchedChild = {
  /** Settles when the dispatched run finishes. Never awaited by the operation. */
  finished: Promise<unknown>;
  requestId: string;
  /** The session the run belongs to — a derived child or the named existing one. */
  sessionId: string;
};

export type DispatchOperationInputs = {
  /**
   * The host whose `dispatch` this drives.
   *
   * One host serves every flow it has registered, so the flow kind is **not** a
   * construction input — it arrives per call, from the seam, as the sending
   * request's own kind.
   */
  host: Pick<InboundTransportHost, "dispatch">;
  /**
   * Called with the dispatched request's `finished` promise the moment the
   * dispatch is made.
   *
   * Fire-and-forget is a statement about the *sending request*, not about the
   * process: the request must not wait, but something has to know the work
   * exists, or a host that can be torn down will tear it down mid-flight. That is
   * exactly what happened under `fsdev run` — the CLI disposes the runtime the
   * moment the parent returns, closing pooled stores while an in-process child
   * was still writing, and the child's task row was stranded `in_progress`
   * forever (FIX-1077).
   *
   * A host that owns a process lifetime (`FlowState.dispose`) uses this to drain
   * before shutting down. A long-lived server has nothing to do here and leaves
   * it unset.
   *
   * Never awaited by this operation — that would reintroduce the wait the whole
   * feature exists to remove.
   */
  onDispatched?: (child: DispatchedChild) => void;
};

/**
 * Build the dispatch operation a host wires onto `runtimeConfig.requestHost`.
 *
 * @param inputs The host to dispatch through.
 */
export function createDispatchOperation(inputs: DispatchOperationInputs): DispatchOperation {
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
        source: spec.source,
        flowKind: spec.flowKind,
        action: spec.target,
        input: spec.input,
        sessionId: spec.sessionId,
        principal: { userId: spec.userId },
        ...(spec.orgId !== undefined ? { orgId: spec.orgId } : {}),
        ...(spec.tenantId !== undefined ? { tenantId: spec.tenantId } : {}),
        ...(spec.metadata !== undefined ? { metadata: spec.metadata } : {}),
        // The sending request's effective config, so the dispatched request
        // inherits the resolvers and logger that request is actually running
        // under rather than the host's construction-time ones (FIX-1077).
        ...(spec.runtimeConfig !== undefined ? { runtimeConfig: spec.runtimeConfig } : {}),
        // Fire-and-forget: no live stream, nobody attached, nothing awaiting the
        // result inline. See the file header.
        responseEmitter: null
      });
    } catch (error) {
      return {
        notStarted: true,
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    // Handed over BEFORE the await below, so the child is known to its host from
    // the instant it exists rather than from the instant it is confirmed —
    // including on the paths that await nothing at all.
    inputs.onDispatched?.({
      finished: handle.finished,
      requestId: handle.requestId,
      sessionId: spec.sessionId
    });

    // Awaiting acceptance is what makes an accepted result mean "discoverable"
    // rather than "we intended to". It is deliberately the ONLY thing awaited,
    // and deliberately not a stronger milestone.
    //
    // A task row is not what this protects. A hand-off leaves the row holding a
    // lease nobody renews, so a child that dies — in setup, mid-run, or with its
    // process — lets that lease lapse and the next drain recovers it. That is
    // the designed path for every way a child can die, and waiting for a later
    // milestone does not improve on it; it only narrows which failures cost one
    // lease instead of none.
    //
    // What acceptance genuinely buys is that a dead child is VISIBLE. Nobody
    // holds the child's `finished`, so without this a registration failure is
    // swallowed and the sender reports success; with it, the sender's request
    // carries the failure at the moment it happened.
    //
    // A REJECTED acceptance is reported as not-started, for the same reason a
    // synchronous refusal is: the caller still owns the work and can settle it,
    // where a throw leaves it holding nothing it can act on. Under an external
    // dispatcher `accepted` rejects from exactly one place: the enqueue-time
    // chain in `dispatch`, whose `catch` awaits `terminateUnenqueuedRequest`
    // BEFORE rethrowing — so by the time this rejection is observable the
    // request record is already terminal. The residue (a queue write that
    // commits and loses its ack) is fenced by the row's claim gate: a late child
    // re-reads the row and refuses once the sender has settled it.
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
