---
"@flow-state-dev/core": patch
---

Models `createModelResolver` loads from a provider or gateway package carry `generateStep` and `streamStep` from the first resolution, so a generator runs its own tool loop on them and a tool's `ctx.suspend()` pauses the request instead of reaching the model as a failed tool call (FIX-1719).
