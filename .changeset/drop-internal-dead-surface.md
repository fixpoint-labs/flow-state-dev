---
"@flow-state-dev/core": minor
---

`BlockContext` no longer declares the `_outputTracker` slot. It was marked `@internal` and no framework code read it, but it did reach the published type declarations — code that referenced `ctx._outputTracker` stops compiling on upgrade and can be deleted. (FIX-1216)
