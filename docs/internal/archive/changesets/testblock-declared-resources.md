---
"@flow-state-dev/testing": patch
---

Fix `testBlock`/`testSequencer` not registering a block's declared resources. A block that declares a resource on its `resources:` slot (and writes to it via `ctx.resources.X`) threw `Cannot read properties of undefined (reading 'setState')` under the test harness, because the synthetic flow only wired explicitly-seeded scope resources and never the block's own declarations. Production registers them via `flow.resources` collected from the block's `declaredResources`; the harness now mirrors that, merging the block-under-test's `declaredResources` into the synthetic flow. Explicitly-seeded scope resources still take precedence on accessor-key conflict, so existing tests are unaffected.

This is what made the `round-robin`, `debate`, and `routed-specialists` patterns fail every cell in the cross-pattern benchmark (they each seed an internal scoped resource on an init step); they now run.
