---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A steer sent through the board now answers a running task's open `external` wait (FIX-2578).

- **orchestration:** `updateTask`'s `message` (the Inbox's steer, an app's Steer box) and `ref.steer` answer a running task's open external wait in the same write, as a line typed in the task's session already did: the steer carries `answers`, and the same attempt is owed its turn. A task waiting on its pull request no longer sleeps with an untaken steer. The answer has its place under the steer cap kept, so a full task still takes it.
- **workforce:** a board steer that answered a task's wait starts the turn it owes, in the task's session.

Docs: packages/orchestration/README.md (the `external` hold: a board steer answers it, beside a line and a `"service"` answer).
