---
"@flow-state-dev/core": minor
"@flow-state-dev/patterns": patch
---

Add `utility.keyedRouter({ blocks, select, fallback? })` to `@flow-state-dev/core` for the "pick a block from a `Record<string, Block>` by string key" case. Promotes the same hand-rolled router that previously lived inside `routedSpecialists`' dispatch, `taskBoard`'s registry-mode worker dispatch, and `debate`'s speaker dispatch. Unknown keys throw with the registered key list; pass `fallback` to route to a default block instead. Input adaptation is intentionally left out — pre-connect adapters on the routed blocks per BP-013.
