---
"@flow-state-dev/orchestration": minor
---

Task boards now bound how much work can be created: `maxEnqueuedTasks` (default 100, refreshes as the board drains) and `maxTotalTasks` (default 500, counting every task the board ever held) are enforced atomically on every insertion path, apply to boards that build their own collection, and can be raised or turned off with `null`.
