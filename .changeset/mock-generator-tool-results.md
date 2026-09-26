---
"@flow-state-dev/testing": patch
---

A hand-written `MockGeneratorInstance`'s `next()` now receives `{ toolResults }` as a second argument, what the tools the current call already ran returned, so a scripted step can depend on a tool's result (FIX-1589).
