---
"@flow-state-dev/orchestration": minor
---

A task row can carry `sealed`, a payload written once by the code that files it and packed to its worker as `TaskWorkerInput.sealed`; no task tool or update can set or change it, and `TaskFilter.sealed` matches on its plain values. `dispatchTask` takes a post form (`post: true` with `assignee` and an optional `target`) on a turn that routes a post, when the board offers one (`DispatchPostForm`).
