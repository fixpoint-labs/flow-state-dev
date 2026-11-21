---
"@flow-state-dev/orchestration": minor
---

The Inbox client's board actions (`inbox.board(at)`) gain `get(id)`: one task as the board's `getTask` reads it, its brief (context, labels, priority) whole. Read a task with it before `refile` so a re-run keeps a long brief (FIX-2773). The read's type is exported as `BoardTaskRead` from `@flow-state-dev/orchestration/inbox`.
