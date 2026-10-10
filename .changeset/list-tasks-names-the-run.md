---
"@flow-state-dev/orchestration": patch
---

`listTasks` (the task tool and its `listTasks_<board>` action) now answers each task's `run` link, the run working it or the one that last did, so a task list can open it (FIX-1792).
