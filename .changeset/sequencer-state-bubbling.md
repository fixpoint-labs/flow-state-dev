---
"@flow-state-dev/core": minor
---

A block's `sequencerStateSchema` now joins the state of the sequencer `ctx.sequencer` resolves to (the nearest enclosing sequencer with a `stateSchema`), with its defaults in the initial state, and a capability's `sequencerStateSchema` joins the state of the sequencer that uses it. Composing a chain now throws `SequencerSchemaMismatchError` when a sequencer `stateSchema` field disagrees in kind with a block's or capability's requirement, when two blocks or two capabilities require different kinds of one field, or when such a shared field carries a `.transform()` on one side (share one schema between both sides instead), so a flow that composed such a pair before no longer builds. A durable sequencer resumed from a checkpoint gets schema defaults for the fields the checkpoint lacks (FIX-2039).
