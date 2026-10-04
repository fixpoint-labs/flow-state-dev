---
"@flow-state-dev/engine": minor
---

Version-checked scope-state writes such as `atomicState` and `setState` skip a no-op only after the store confirms it, so restoring a value another writer replaced in the meantime is stored, and direct `runWithCAS` callers, or `createScopeStateOps` callers that pass `persist`, must also pass the new `reread` option to keep skipping writes that equal the cached state (FIX-1275).
