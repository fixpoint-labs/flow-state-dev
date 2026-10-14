---
"@flow-state-dev/orchestration": patch
---

`addTask` and `dispatchTask` take an optional `title`, a short label for the task apart from its `goal`, and `listTasks` answers it when a task has one (FIX-1974). A task filed without a title is still labelled by its goal.
