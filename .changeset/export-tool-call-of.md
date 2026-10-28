---
"@flow-state-dev/orchestration": patch
---

`toolCallOf(ctx)` is exported from `@flow-state-dev/orchestration/task-board`, so another tool that waits can take the same one-wait-per-step claim as `getTask` (FIX-2239).
