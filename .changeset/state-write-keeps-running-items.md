---
"@flow-state-dev/engine": patch
---

A request-state write in the middle of a run no longer removes the items persisted since the run started from the in-memory and filesystem request stores, so a read while the run continues still shows them (FIX-1735).
