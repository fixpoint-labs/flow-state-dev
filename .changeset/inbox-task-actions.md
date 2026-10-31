---
"@flow-state-dev/orchestration": minor
---

`@flow-state-dev/orchestration/inbox`'s client now works a board's tasks: `createInboxClient(client).board({ flowId, sessionId, board })` returns `cancel(id)`, `steer(id, message)`, `release(id)`, `retry(id)` and `refile(row, overrides?)`. Each runs the board's own task action as the signed-in user and rejects with the board's words when it refuses. `taskActionName(tool, board)` names a board's action, such as `"updateTask_tasks"`.
