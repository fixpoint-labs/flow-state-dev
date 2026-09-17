---
"@flow-state-dev/core": minor
---

FIX-1393: a generator that declares `tools:` now intersects capability-contributed tools (static and dynamic `uses`) with that declaration instead of unioning them onto it, so `tools: []` reaches the model with no tools; blocks that declare no `tools:` slot are unaffected.
