---
"@flow-state-dev/engine": minor
---

`writable: false` on a resource collection now refuses `create(..., { replace: true })` on an existing instance and `delete`, the same way instance `setState` already does. `create` and `getOrCreate` of a new key stay open (FIX-1510).
