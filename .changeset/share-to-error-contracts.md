---
"@flow-state-dev/contracts": patch
"@flow-state-dev/core": patch
---

`toError`, which coerces an unknown throw into an `Error`, is now available from `@flow-state-dev/contracts/helpers` and `@flow-state-dev/core/helpers`. Browser hosts can reach it without pulling in the core runtime. (FIX-1211)
