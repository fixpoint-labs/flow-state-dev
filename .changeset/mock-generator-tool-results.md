---
"@flow-state-dev/testing": patch
---

A hand-written `MockGeneratorInstance`'s `next()` now receives a second argument, `{ toolResults }`: what the tools the current call already ran returned, oldest first. A scripted step can depend on a tool's result, for example replying that nothing was filed when the tool said so (FIX-1589). `mockGenerator`'s own instance ignores it.
