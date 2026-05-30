---
---

Internal refactor of the sequencer DSL kernel (FIX-508): argument-shape resolution, single-child dispatch, and background dispatch are consolidated into shared internal primitives. No user-facing change — every public sequencer method keeps identical signatures, runtime behavior, and item-emission semantics.
