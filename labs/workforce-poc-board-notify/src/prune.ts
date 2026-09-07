/**
 * Subscription prune policy — FIX-1311 design note, lab-local.
 *
 * Prune a dead subscriber. Never prune a live one that was merely busy.
 */
import type { DispatchRefusal } from "@flow-state-dev/core";

const PRUNE_ON: ReadonlySet<DispatchRefusal> = new Set(["no-entry", "session-not-found"]);

/**
 * Whether a notify refusal means the subscriber is gone for good.
 *
 * `no-entry` — the handler is gone. `session-not-found` — the session is gone.
 * Everything else is transient or a deployment/boundary shape, including
 * `dispatch-rejected` (recipient busy) and `session-not-addressable`
 * (still overloaded as "not this principal **or** not this flow").
 */
export function shouldPruneSubscription(refused: DispatchRefusal): boolean {
  return PRUNE_ON.has(refused);
}
