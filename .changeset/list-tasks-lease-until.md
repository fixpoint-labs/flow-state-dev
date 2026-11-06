---
"@flow-state-dev/orchestration": patch
---

The board's `listTasks` action (a client's read, not the model's tool) answers a running row's `leaseUntil`, the deadline a live run keeps pushing forward while it works. Pass the row to `leaseLapsed(row, now)` from `@flow-state-dev/orchestration/tasks` to tell a task whose run stopped answering, by the same rule the board uses to take such a row back. A row nobody holds has no `leaseUntil` and never reads lapsed. A row's `run.startedAt` is when this attempt's first run started, so a screen can time the attempt rather than the task (FIX-2394).

Docs: packages/orchestration/README.md (the `listTasks` rows section: `run.startedAt` and `leaseUntil`, with `leaseLapsed`)
