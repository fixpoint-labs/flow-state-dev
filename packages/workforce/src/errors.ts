/**
 * Typed errors thrown while materializing an Agent.
 *
 * Materialization is the last point where an Agent's declaration and the
 * environment it will run in are both in hand. A declaration this step cannot
 * honor is refused here — loudly, before any block is built — rather than
 * dropped, because a dropped declaration produces an Agent that looks complete
 * at define-time and runs degraded (FIX-1327).
 */

import { FlowError } from "@flow-state-dev/core";

/** Machine-readable `code` on every {@link AgentCapabilityError}. */
export const AGENT_CAPABILITY_UNRESOLVED = "agent_capability_unresolved";

/**
 * A capability the Agent declared could not be resolved at materialization.
 *
 * Raised for a string `usesCapabilities` entry when there is no
 * `capabilityCatalog` to resolve it against — the one miss with nowhere for the
 * author to notice it. An entry the catalog simply doesn't carry stays on the
 * additive-not-restrictive path this package's tool resolution already
 * documents: it warns and drops, and this error does not cover it.
 *
 * A capability *reference* (`someCapability`, or `someCapability.presets({…})`)
 * never reaches this error — it needs no catalog and is used as-is.
 */
export class AgentCapabilityError extends FlowError {
  constructor(message: string, details: { agentName: string; capability: string }) {
    super(message, { code: AGENT_CAPABILITY_UNRESOLVED, details });
    this.name = "AgentCapabilityError";
  }
}
