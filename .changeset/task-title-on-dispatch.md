---
"@flow-state-dev/orchestration": patch
---

`addTask` and `dispatchTask` take an optional `title`, a short label for the task, apart from its `goal`. `listTasks` answers it when a task has one. A task filed without a title is still labelled by its goal.
