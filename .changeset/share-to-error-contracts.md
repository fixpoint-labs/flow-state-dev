---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
---

`toError` is exported from `@flow-state-dev/contracts/helpers`, and `@flow-state-dev/core/helpers` re-exports it. Browser hosts can now coerce unknown throws without pulling in the core runtime, and every host coerces through one helper (FIX-1211).
