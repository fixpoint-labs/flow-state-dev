---
"@flow-state-dev/core": minor
---

A sequencer's declared `outputSchema` is now a real contract. When set, the framework validates the sequencer's actual returned value at runtime — covering the natural tail, an `exitIf` early return, and a `rescue` recovery — and throws a rescue-catchable `SequencerOutputSchemaError` on mismatch. Sequencers that omit `outputSchema` are unaffected and incur zero validation cost. A new `.validate()` method on the sequencer DSL catches structural drift between the declared schema and the chain's inferred output shape at build time, throwing `SequencerSchemaMismatchError`.
