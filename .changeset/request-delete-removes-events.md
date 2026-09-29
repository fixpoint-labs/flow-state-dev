---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Deleting a request, including through session retention, now also deletes its stream events and runOnce results, so a later request that reuses the id cannot replay the earlier run; retention also keeps a request for twice the live-tail liveness timeout (60s by default) after it finishes, so a session can briefly exceed its limits (FIX-1647).
