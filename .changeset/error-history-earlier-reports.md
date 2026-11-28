---
"@flow-state-dev/workforce": patch
---

The error history shows a reopened report's earlier days as that earlier report (FIX-2838). When a failure comes back after its issue closed, the Error Reporter starts a new report under the same id. A day of the earlier report now reads as its own record, under its own path, with its own title, status, count and issue, instead of the new report's. History written before this release is told apart by its status entries.
