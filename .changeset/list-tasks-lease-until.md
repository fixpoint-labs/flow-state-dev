---
"@flow-state-dev/orchestration": patch
---

The board's `listTasks` action (a client's read, not the model's tool) answers a running row's `leaseUntil`. Pass the row to `leaseLapsed(row, now)` to tell a task whose run stopped answering, by the same rule the board uses to take such a row back (FIX-2394).
