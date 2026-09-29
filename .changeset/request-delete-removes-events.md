---
"@flow-state-dev/engine": patch
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Deleting a request, including through session retention, now also deletes its stream events and runOnce results, so a later request that reuses the id cannot replay the earlier run; retention also keeps a request until its run has finished, `onFinished` included, and for twice the live-tail liveness timeout (60s by default) after, so a session can briefly exceed its limits. Request records gain `finalizedAtMs`, which the run sets as its last write; a custom `RequestStore` must persist it. The filesystem store names per-key runOnce files `<id>@<key>.runonce`, so deleting one request can no longer remove another's results; files in the older layout are still read (FIX-1647).
