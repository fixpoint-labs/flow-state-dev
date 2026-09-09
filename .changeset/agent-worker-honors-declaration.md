---
"@flow-state-dev/workforce": minor
---

`materializeAgent` no longer builds an agent that is missing a capability it
declared.

A string entry in `usesCapabilities` is a key resolved against the
materialize-time `capabilityCatalog`. Declaring one when **no catalog was
supplied at all** used to skip it silently — no error, no warning — so the agent
ran without the capability and nothing anywhere said so. That case now throws
a `FlowError` (`code: "agent_capability_unresolved"`) naming the agent and
the capability, before the block is built.

Unchanged: a key that a supplied catalog doesn't carry still warns and is
skipped, matching the additive-not-restrictive policy for unknown tool keys.
Capability references need no catalog and are never refused.

**Upgrading:** if an agent's declared capability was already being dropped this
way, it now fails loudly instead. Supply the `capabilityCatalog` that resolves
the key, or put the capability reference itself in `usesCapabilities`.
