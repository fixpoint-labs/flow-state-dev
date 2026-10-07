---
"@flow-state-dev/orchestration": patch
---

A partitioned ledger now takes the bare user id from the user scope, not the user record's storage key, when the session names no user (FIX-1790).
