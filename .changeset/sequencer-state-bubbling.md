---
"@flow-state-dev/core": patch
---

A block's `sequencerStateSchema` now joins the state of the sequencer `ctx.sequencer` resolves to (the nearest enclosing sequencer with a `stateSchema`), with its defaults in the initial state, and a capability's `sequencerStateSchema` joins the state of the sequencer that uses it. A sequencer `stateSchema` field that disagrees in kind with a block's or capability's requirement now throws `SequencerSchemaMismatchError` when the chain is composed, so a flow that composed such a pair before no longer builds. A durable sequencer resumed from a checkpoint gets schema defaults for the fields the checkpoint lacks (FIX-2039).
