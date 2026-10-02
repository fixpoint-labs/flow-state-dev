---
"@flow-state-dev/core": patch
---

A generator tool that throws after its approved `ctx.suspend()` gate now reaches the model as a failed tool call, as in the live tool loop, while a cancel during that tool still stops the request (FIX-1719).
