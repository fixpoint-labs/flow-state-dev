---
"@flow-state-dev/orchestration": minor
---

Delegation now has an on-demand default worker: a task whose `assignee` is unset or names no declared worker runs on a capable generic worker and records its result instead of erroring out of the board.
