---
"@flow-state-dev/testing": patch
---

`testBlock` now supplies `sequencer.state` to the enclosing sequencer, fills missing fields from the child's `sequencerStateSchema`, and returns the parent's state after the block runs (FIX-2039).
