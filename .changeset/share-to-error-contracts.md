---
"@flow-state-dev/contracts": patch
---

`toError` is exported from `@flow-state-dev/contracts/helpers` so browser hosts coerce unknown throws without pulling the core runtime (FIX-1211).
