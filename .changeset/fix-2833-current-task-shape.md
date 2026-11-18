---
"@flow-state-dev/orchestration": minor
---

`withRetiredShapes` is removed from `@flow-state-dev/orchestration/tasks`. A stored task is read only in the current shape: status `blocked` is not read as `held`, and a hold whose marker is `"row"` is not read as `"task"`. `heldFromBlocked` is removed. A write against a row whose status is not a current status is declined `unknown-status`, and the row is left as stored. There is no alias and no migration (FIX-2833).

Docs: apps/docs/docs/orchestration/task-substrate.md
