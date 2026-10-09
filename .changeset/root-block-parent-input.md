---
"@flow-state-dev/engine": patch
---

The children of a run's outermost block now read the run's input through `ctx.parent.input`, the same as children anywhere else in the tree. Before, it was `undefined` there (FIX-1570).
