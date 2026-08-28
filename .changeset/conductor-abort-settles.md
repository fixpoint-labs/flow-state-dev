---
"@flow-state-dev/core": patch
---

Rescue handlers can still write after a request abort, so a cancelled worker can settle its row instead of leaving it in progress.
