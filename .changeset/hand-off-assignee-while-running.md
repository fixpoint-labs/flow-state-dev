---
"@flow-state-dev/orchestration": minor
---

On a board that hands tasks off, `setAssignee` now declines `immutable-assignee` only while an attempt holds the task (`in_progress` or `parked`). A pending or blocked task can change hands, and its next claim hands it to the new assignee; `unpark` a parked task to move it. A finished task declines `terminal`, as on any board (FIX-1780).
