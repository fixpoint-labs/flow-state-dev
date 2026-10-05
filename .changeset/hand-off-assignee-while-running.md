---
"@flow-state-dev/orchestration": minor
---

On a board that hands tasks off, `setAssignee` now declines `immutable-assignee` only for a task that is `in_progress`. A pending, parked or blocked task can change hands, and its next claim hands it to the new assignee. A finished task declines `terminal`, as on any board (FIX-1780).
