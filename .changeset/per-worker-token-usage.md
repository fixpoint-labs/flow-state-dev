---
"@flow-state-dev/core": patch
"@flow-state-dev/claude-code": patch
"@flow-state-dev/codex": patch
"@flow-state-dev/cursor": patch
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

Each worker's token usage is recorded per person and day, with harness runs reporting their spend through `reportHarnessSpend`, read through the `workerUsage` query, and shown on Shift Manager's Usage view (FIX-2145).
