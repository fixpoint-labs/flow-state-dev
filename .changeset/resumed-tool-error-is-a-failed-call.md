---
"@flow-state-dev/core": patch
---

A generator tool that throws an ordinary error after its `ctx.suspend()` gate is approved now reaches the model as a failed tool call, as it does in the live tool loop, instead of failing the whole request. A rejection still reaches the model as `{ denied: true }`, and a gate still pending suspends again (FIX-1719).
