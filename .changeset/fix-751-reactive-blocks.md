---
"@flow-state-dev/core": patch
"@flow-state-dev/server": patch
---

Add `reactTo` to `defineResource` and `defineResourceCollection` so a block runs automatically when a resource is created, updated, or deleted. Each binding is a block or `{ block, when }`; the block runs blocking inside the originating turn with a `ResourceChange` payload (`key`, `ref`, `kind`, `state`, `prevState`, `evicted`) and can emit items, call models, and appear in traces. Type its input with the exported `resourceChangeSchema(stateSchema)`. For background, isolated fan-out, make the reactive block a sequencer that uses `.work()`. A `when` gate filters dispatch, and a reaction that throws fails the mutating turn.

The server dispatches these reactions in the same session and turn, ordering emitted items within the turn. A per-turn depth and fan-out budget guards against runaway cascades, emitting a `reactive_cascade_exceeded` error item instead of hanging when a reaction chain feeds back on itself.
