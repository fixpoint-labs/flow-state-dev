---
"@flow-state-dev/core": minor
"@thought-fabric/core": patch
---

Generator output schemas are now validated for OpenAI strict-mode compatibility at definition. `generator()` throws a `StrictSchemaError` when an `outputSchema` contains a reachable `z.record()` or a `z.union()` of differently-shaped variants, naming the offending path — so a bad schema fails at import instead of opaquely on the first model call.

`@flow-state-dev/core` exports `assertStrictCompatible(schema, label?)` (and a `StrictSchemaError` carrying located `violations`) for asserting a schema constant directly in a test; `makeSchemaStrict` gains a `{ validate: true }` option. This replaces the per-package strict-mode walker that BP-016 previously asked authors to copy.

`@thought-fabric/core`'s salience scorer (`scoreSalience`) now returns per-dimension scores as an array of `{ dimension, score }` pairs instead of an open-keyed map, fixing an output schema that OpenAI strict mode would have rejected at runtime.
