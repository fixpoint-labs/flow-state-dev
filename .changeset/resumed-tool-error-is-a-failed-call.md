---
"@flow-state-dev/core": patch
---

A generator tool that throws after its `ctx.suspend()` gate is approved now reaches the model as a failed tool call, as it does in the live tool loop, instead of failing the whole request. A cancel while that tool runs still stops the request, and the step's later tools are not run (FIX-1719).
