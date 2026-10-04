---
"@flow-state-dev/core": patch
---

A sequencer's `uses` capabilities now stay reachable at `ctx.cap` after `.connectInput()`; previously calling it dropped them for the whole chain (FIX-1714).
