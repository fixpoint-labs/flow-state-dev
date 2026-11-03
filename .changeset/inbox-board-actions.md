---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": patch
---

An app can change a task on a board with one call each, from the browser-safe Inbox entry (FIX-2381).

- **orchestration:** `createInboxClient(client).board({ flowId, sessionId, board })` returns the board's `cancel(id)`, `steer(id, message)`, `release(id)`, `retry(id)` and `refile(row, overrides?)`. Each resolves when the board says yes and rejects with the board's own words when it refuses. `cancel` resolves to the dependents it cancelled with the task, `refile` to the new task's id. `taskActionName(tool, board)` gives a board action's name. New types: `BoardAt`, `BoardActions`, `RefileRow`, `RefileOverrides`, `TaskActionTool`. A row answer through `answer` / `answerOne` now finds its request past the first 100 in the session, and rejects when the board's answer can't be read instead of resolving.
- **workforce:** a browser's read of a conversation board now includes each row's `context`, beside `goal`.
