---
"@flow-state-dev/store-sqlite": patch
"@flow-state-dev/store-postgres": patch
---

Completed block traces now persist correctly on a suspended request, so resuming a durable flow replays already-finished blocks from the log instead of re-running them.
