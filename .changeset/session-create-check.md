---
"@flow-state-dev/engine": minor
"@flow-state-dev/core": patch
"@flow-state-dev/client": patch
"@flow-state-dev/react": patch
"@flow-state-dev/fsdev": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

A flow can check every session at create with `session.createCheck`, which stores a `link` nothing changes afterwards, and refuse seeded state with `session.serverOwned`; `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
