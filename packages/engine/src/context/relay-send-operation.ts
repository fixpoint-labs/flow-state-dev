/**
 * The host operation that dispatches a relay delivery (FIX-1230).
 *
 * `RequestHost.sendMessage` does every check — identity, the flow boundary, the
 * two-axis door, the sender's own addressability — and then hands off to *this*
 * to actually start the run, exactly as `startDetached` hands off to
 * `createDetachedStartOperation`. The split is the same one, for the same
 * reason: the checks need the running request's identity closure, which lives in
 * the context factory, while the dispatch needs the host's arbiter and its
 * enqueue-time materialization, which live in the transport host.
 *
 * ## Why the send goes through the transport host
 *
 * A relay delivery is an ordinary request in every respect that matters to the
 * runtime: it needs a request record, an `activeRequests` registration, an abort
 * registration and retention. `host.dispatch` is the one seam that does all of
 * that, and reaching past it to a dispatcher would rebuild a subset of it that
 * drifts. It is also where the recipient's concurrency policy is applied, which
 * is the point — a message obeys the recipient's declared policy rather than
 * being exempt from it.
 *
 * ## What makes this dispatch un-forgeable
 *
 * `source: RELAY_SOURCE`, stamped here from a value no caller can reach.
 * `resolveActionCore` treats that source as **terminal** — it resolves the door
 * the *send* already decided and stamped on `metadata.relay`, and never falls
 * through to `flow.actions` — so `actionName` below is provenance rather than
 * routing. Everything else on the envelope comes from the identity the verb
 * closed over, never from the sender's message.
 *
 * ## Acceptance means discoverable, and for relay that is a stronger claim
 *
 * The returned promise waits for the host to have **accepted** the dispatch, and
 * acceptance for a relay delivery is defined to include the request record
 * carrying `metadata.relay` — the record a later status lookup authorizes
 * against. Announcing a delivery id before its authorization is durable would
 * hand a caller a handle nothing could ever resolve, which is the whole reason
 * that relation is written now rather than when the status verb ships.
 *
 * ## The one refusal that arrives as a throw
 *
 * A recipient declaring `policy: "reject"` and busy under its key makes
 * `arbiter.gate` throw `ConcurrencyRejectedError` **synchronously** out of
 * `host.dispatch`. Every relay refusal is a returned value, so this is caught
 * here and reported as a distinguishable outcome for the verb to name — the same
 * boundary translation the webhook route already does at its own edge.
 */
import type { InboundTransportHost } from "../transports/types";
import type { RuntimeConfig } from "../runtime-config";
import type { RelayDispatchStamp } from "../execution/relay-metadata";
import { RELAY_SOURCE } from "../execution/transport-sources";
import { ConcurrencyRejectedError } from "../transports/errors";

/** What the verb hands the operation, all of it server-derived. */
export type RelaySendSpec = {
  /** Bare recipient session id, already checked against the sender's identity. */
  sessionId: string;
  /** The recipient's flow — equal to the sender's, which the verb enforced. */
  flowKind: string;
  /** Handler block name, carried as provenance only. See the file header. */
  actionName: string;
  /** What the resolved door's handler receives. */
  input: unknown;
  /** The sending request's principal, which the delivery runs under. */
  userId: string;
  tenantId?: string;
  orgId?: string;
  /** The relay coordinate, stamped onto the delivery's own request record. */
  relay: RelayDispatchStamp;
  /** The launching request's effective config, inherited by the delivery. */
  runtimeConfig?: RuntimeConfig;
};

/**
 * Outcome of a dispatch attempt. Three arms rather than two because the
 * recipient's `reject` policy is a *different answer to the caller* from a
 * generic setup failure, and collapsing them would hide a supported
 * configuration behind an internal error message.
 */
export type RelaySendOperationResult =
  | { requestId: string }
  | { notStarted: true; reason: string }
  | { notStarted: true; reason: string; recipientBusy: true }
  | { notStarted: true; reason: string; externalDispatcher: true };

export type RelaySendOperation = (spec: RelaySendSpec) => Promise<RelaySendOperationResult>;

export type RelaySendOperationInputs = {
  /** The host whose `dispatch` this drives. */
  host: Pick<InboundTransportHost, "dispatch" | "usesExternalDispatcher">;
};

/**
 * Build the relay send operation a host wires onto `runtimeConfig.requestHost`.
 *
 * @param inputs The host to dispatch through.
 */
export function createRelaySendOperation(
  inputs: RelaySendOperationInputs
): RelaySendOperation {
  return async (spec) => {
    // Reported from HERE rather than checked at the verb, and the reason is
    // freshness rather than layering. Which dispatcher is effective is settled
    // only once the worker adapter has been consulted, which is after the verb's
    // inputs are assembled — so a boolean copied onto the request host at
    // construction would read as in-process on exactly the deployments this
    // refusal exists for. The host is the one place that knows, so it is the one
    // place asked. The verb still decides the refusal *code*, the same way it
    // does for a recipient's `reject` policy.
    //
    // Before `dispatch`, so nothing is enqueued behind a refusal.
    if (inputs.host.usesExternalDispatcher) {
      return {
        notStarted: true,
        externalDispatcher: true,
        reason: "the effective dispatcher hands work to an external queue"
      };
    }

    let handle: ReturnType<typeof inputs.host.dispatch>;
    try {
      handle = inputs.host.dispatch({
        source: RELAY_SOURCE,
        flowKind: spec.flowKind,
        // Provenance only — the relay source branch in `resolveActionCore` is
        // terminal and routes off the stamp, so this name is never resolved
        // against `flow.actions`. It exists so an operator reading a request
        // record can see which handler the delivery entered.
        action: spec.actionName,
        input: spec.input,
        sessionId: spec.sessionId,
        principal: { userId: spec.userId },
        ...(spec.orgId !== undefined ? { orgId: spec.orgId } : {}),
        ...(spec.tenantId !== undefined ? { tenantId: spec.tenantId } : {}),
        // Server-assembled, and the ONLY thing that makes every later read of
        // this bag trustworthy is the `source` above. See `relay-metadata.ts`.
        metadata: { relay: spec.relay },
        ...(spec.runtimeConfig !== undefined ? { runtimeConfig: spec.runtimeConfig } : {}),
        // The sender is not attached to the delivery's stream. Fire-and-forget
        // is a statement about the sending request, and a waiting sender wakes
        // on its OWN stream through the reply registry rather than by tailing
        // the recipient's.
        responseEmitter: null
      });
    } catch (error) {
      // Pre-dispatch by construction: the only synchronous throw `dispatch` can
      // produce past flow resolution is the `reject`-policy key claim, and it
      // happens before any record or stream exists.
      if (error instanceof ConcurrencyRejectedError) {
        return {
          notStarted: true,
          recipientBusy: true,
          reason: error.message
        };
      }
      return {
        notStarted: true,
        reason: error instanceof Error ? error.message : String(error)
      };
    }

    // Acceptance is what makes the returned delivery id mean "discoverable and
    // authorizable" rather than "we intended to". It is deliberately the only
    // thing awaited: waiting for the run itself would reintroduce exactly the
    // block that `fireAndForget` exists to remove.
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
