---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
---

Any block — handler, generator, router, or sequencer — can now hold its own request-scoped state by declaring `stateSchema`, read and written via a new `ctx.self`. A child block can reach its immediate parent's state via a new `ctx.parent` (declared with `parentStateSchema`) without naming it. These are two new addressing modes over the same per-block state container that already backs `ctx.sequencer` and `ctx.targets`, so an author-facing router (a router itself) stays read-only on `ctx.self` per the existing suspendable-router purity contract. A fan-out/loop-body block's own state is private per iteration; a loop-owning block's state accumulates across its own passes. Block state is in-memory only in this release — it does not yet survive a suspend/resume cycle on a non-sequencer block.
