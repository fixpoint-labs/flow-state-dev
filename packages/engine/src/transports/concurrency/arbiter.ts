/**
 * The concurrency arbiter (FIX-837) — policy logic layered over the keyed
 * async gate. One instance is owned by the inbound transport host and governs
 * every dispatch, so a session-scoped concurrency policy is enforced once at
 * the shared seam rather than re-implemented per transport adapter.
 *
 * Two pieces wire into the host, both at the shared `dispatch` seam so every
 * transport inherits the policy uniformly (the issue's stated goal):
 *   - `resolve` derives the effective policy + key for a dispatch (pure).
 *   - `gate` runs at the top of `dispatch`, before any request record or live
 *     stream is created: for `reject` it atomically claims the key and throws
 *     `ConcurrencyRejectedError` synchronously when another request holds it
 *     (so the dropped caller never materializes a run); for `queue` it defers
 *     the run start behind the key (FIFO); for `allow` it is a passthrough. The
 *     key is released when the run settles.
 *
 * Acquiring and releasing the key entirely within a single `dispatch` lifecycle
 * (release in the run's terminal `finally`) means there is no cross-call handoff
 * and no leak window — unlike claiming the key at an earlier seam and releasing
 * it later, where an adapter that bails in between would strand the key.
 *
 * v1 enforces the policy for the in-process dispatcher only. With an external
 * dispatcher the run completes in another worker, so the host skips arbitration
 * (passing no key) and enforcement is deferred to the durable substrate
 * (FIX-830) rather than gating the enqueue, which would free a `reject` key at
 * enqueue time instead of run-completion.
 */

import type {
  ConcurrencyConfig,
  ConcurrencyKey,
  ConcurrencyKeyContext,
  ConcurrencyPolicyName
} from "@flow-state-dev/core";
import { createKeyedAsyncGate } from "../../utils/keyed-async-gate";
import { ConcurrencyRejectedError } from "../errors";
import type { DispatchEnvelope } from "../dispatcher";

/** Default budget a `queue` request waits for the key before timing out. */
const QUEUE_WAIT_TIMEOUT_MS = 30_000;

/** Minimal view of a flow the arbiter reads to resolve a policy. */
export interface ConcurrencyFlowView {
  actions: Record<string, { concurrency?: ConcurrencyConfig } | undefined>;
  request?: { concurrency?: ConcurrencyConfig };
}

/** The effective policy + resolved key for a single dispatch. A `key` of
 *  `undefined` means no arbitration applies (the dispatch runs as `allow`). */
export interface ResolvedDecision {
  policy: ConcurrencyPolicyName;
  key: string | undefined;
}

export interface ConcurrencyArbiter {
  /** Resolve the effective policy + key for a dispatch. Pure. */
  resolve(
    flow: ConcurrencyFlowView,
    actionName: string,
    envelope: DispatchEnvelope
  ): ResolvedDecision;
  /**
   * Build the run-start wrapper for a dispatch. Call synchronously at the top of
   * `dispatch`, before any record/stream is created:
   *   - `reject` → atomically claim the key; if another request holds it, THROW
   *     `ConcurrencyRejectedError(key, inFlightRequestId)` synchronously (so no
   *     record is created for the dropped caller). Otherwise return a wrapper
   *     that runs the kickoff and releases the key when it settles.
   *   - `queue` → return a wrapper that runs the kickoff behind the key (FIFO),
   *     bounded by the wait budget.
   *   - `allow` / no key → return a passthrough wrapper (today's timing).
   * `requestId` is recorded as the in-flight holder so a competing `reject` can
   * name the request a caller may tail.
   */
  gate(
    decision: ResolvedDecision,
    requestId: string
  ): <T>(start: () => Promise<T>) => Promise<T>;
}

/** Tenant-namespace a raw id so identical ids in different tenants never
 *  collide on the same key (mirrors FIX-682 store-key isolation). */
function namespaced(tenantId: string | undefined, id: string): string {
  return tenantId == null ? id : `${tenantId}:${id}`;
}

/** Normalize the string-or-object config into a `(policy, key)` pair. */
function normalizeConfig(
  config: ConcurrencyConfig | undefined
): { policy: ConcurrencyPolicyName; key: ConcurrencyKey } {
  if (config === undefined) return { policy: "allow", key: "session" };
  if (typeof config === "string") return { policy: config, key: "session" };
  return { policy: config.policy, key: config.key ?? "session" };
}

/** Resolve a key spec against a dispatch envelope. Returns `undefined` to mean
 *  "no arbitration" (the action runs as `allow`). */
function resolveKey(key: ConcurrencyKey, envelope: DispatchEnvelope): string | undefined {
  if (key === "none") return undefined;
  if (key === "session") {
    return envelope.sessionId === undefined
      ? undefined
      : namespaced(envelope.tenantId, envelope.sessionId);
  }
  if (key === "user") {
    return namespaced(envelope.tenantId, envelope.userId);
  }
  // Custom function: build the minimal serializable context.
  const ctx: ConcurrencyKeyContext = {
    flowKind: envelope.flowKind,
    actionName: envelope.actionName,
    sessionId: envelope.sessionId,
    userId: envelope.userId,
    tenantId: envelope.tenantId,
    orgId: envelope.orgId,
    source: envelope.source,
    metadata: envelope.metadata
  };
  return key(ctx);
}

export function createConcurrencyArbiter(): ConcurrencyArbiter {
  const keyedGate = createKeyedAsyncGate();

  // The currently-admitted holder per key, so a `reject` can name the in-flight
  // request the caller may tail. Set on admission, cleared on release.
  const holders = new Map<string, string>();

  return {
    resolve(flow, actionName, view): ResolvedDecision {
      // Event dispatches (webhook/chat/scheduled) carry their handler inline and
      // pass the handler *block name* as `actionName` — provenance only. That
      // name can coincide with a public `flow.actions` key, so consulting
      // `flow.actions` here would let an event silently inherit an unrelated
      // caller action's policy. Only caller-addressed dispatches resolve a
      // per-action override; events take the flow default.
      //
      // The event check must gate on the trusted transport `source` (set by the
      // adapter, never the caller) AND the metadata coordinate, exactly as
      // `resolveActionCore` does — `metadata` alone is caller-controllable over
      // HTTP, so trusting it would let a caller spoof `metadata.webhook` to skip
      // a public action's reject/queue policy.
      const isEvent =
        (view.source === "webhook" && view.metadata?.webhook !== undefined) ||
        (view.source === "chat" && view.metadata?.chat !== undefined) ||
        (view.source === "scheduled" && view.metadata?.schedule !== undefined);
      const actionConfig = isEvent ? undefined : flow.actions[actionName]?.concurrency;
      const effective = actionConfig ?? flow.request?.concurrency;
      const { policy, key } = normalizeConfig(effective);
      return { policy, key: resolveKey(key, view) };
    },

    gate(decision, requestId) {
      const { policy, key } = decision;

      if (key === undefined || policy === "allow") {
        return (start) => start();
      }

      if (policy === "reject") {
        // Atomic admission, synchronous so two racing callers can't both win.
        const lease = keyedGate.tryAcquire(key);
        if (lease === null) {
          throw new ConcurrencyRejectedError(key, holders.get(key));
        }
        holders.set(key, requestId);
        let released = false;
        const release = (): void => {
          if (released) return;
          released = true;
          holders.delete(key);
          lease();
        };
        return (start) => {
          // Release on a synchronous throw from `start()` too, so a failed
          // kickoff never strands the key.
          let p: ReturnType<typeof start>;
          try {
            p = start();
          } catch (e) {
            release();
            throw e;
          }
          return p.then(
            (v) => {
              release();
              return v;
            },
            (e) => {
              release();
              throw e;
            }
          );
        };
      }

      // queue: serialize behind the key, FIFO, bounded by the wait budget.
      // Use try/finally (not `.finally`) so a synchronous throw from `start()`
      // still clears the holder entry — otherwise a concurrent `reject` could
      // read a stale in-flight requestId for an already-dead request.
      return (start) =>
        keyedGate.runExclusive(
          key,
          async () => {
            holders.set(key, requestId);
            try {
              return await start();
            } finally {
              holders.delete(key);
            }
          },
          { waitTimeoutMs: QUEUE_WAIT_TIMEOUT_MS }
        );
    }
  };
}
