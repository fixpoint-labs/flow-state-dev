---
"@flow-state-dev/workforce": minor
---

The worker inventory collection (`defineWorkerInventoryCollection`) declares a browser read (FIX-1502). A session on any flow that installs it can list its rows through the collection-state route, for that session's own organization only, with the row's named fields and nothing else. Every member of an organization can list its registered workers from the browser.
