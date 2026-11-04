---
"@flow-state-dev/orchestration": patch
---

The board's `listTasks` action (a client's read, not the model's tool) answers each row's `createdAt`, and its `startedAt` and `completedAt` once they happen, beside `updatedAt`. `taskRowView(row).times` now fills from a board read, so a screen can show how long a task has run and order ended tasks by when they ended (FIX-2395).
