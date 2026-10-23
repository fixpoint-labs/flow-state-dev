---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A follow-up task now runs in the session its root task ran in when that task was filed `session: "ongoing"` or for a workstream: its row carries the root's `session`, `target` and `targetSessionId` (FIX-2111).
