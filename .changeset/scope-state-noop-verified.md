---
"@flow-state-dev/engine": patch
---

A version-checked scope-state write (`atomicState`, `setState`, the updater form of `patchState`, a multi-field `patchState` or `incState`) is now skipped as a no-op only after the runtime re-reads the stored record and confirms its version hasn't moved. Previously the check ran against the execution context's cached read, so a write that deliberately restored a value another writer had since replaced was skipped and returned `false`, leaving the other value stored. Now the mutator re-runs against the stored value and the write lands (FIX-1275).
