---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/devtool": patch
---

A coordinator hands each message to a delegate by filing a routed task: an ordinary task on the conversation's board with `session: "ongoing"`, `resultTo: "conversation"` and one attempt, worked on the delegate flow's `work` entry (FIX-2083).

- A delegate is a worker whose flow takes tasks. Declare `work` with `workerTaskEntry({ name, turn })`; the turn is still handed `{ message }`. `routedTaskHistory` is the `work` turn's generator `history` that shows the model the conversation's recent lines.
- `defineCoordinatorFlow` takes no `delegateFlows`. `listDelegates` says a delegate `takes` `tasks` or `nothing`. A worker on a flow that takes no task can't be added as a delegate.
- A judgment coordinator hands a message on with `createTask` and the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, and `target` for a workstream's record); the server attaches the message as written. On a turn routing a message, `createTask` refuses a `session` other than `"ongoing"` (`routed_session_ongoing`) and `held`, `deps` or `followUpOf` (`routed_task_starts_now`). `createTask` takes `target`, set at filing only; `updateTask` refuses `session`, `resultTo` and `target` (`filing_setting_fixed`). `getTask` shows a task's `session`, `resultTo` and `target`.
- On a board that dispatches, `createTask` starts a task as soon as it is filed; release a held one with `updateTask({ id, status: "pending" })`, with its `assignee` in the same write if it needs one, and wait with `getTask({ id, wait: true })`. On a conversation's board, a task filed with no assignee where several delegates take tasks now waits unassigned instead of being refused `assignee_required`.
- A routed turn is a task turn, and a `taskLedgers` resolver is handed the claimed task's id as its fourth argument.
- A delegate that files work for a message answers once that work has ended, and a second message to a busy delegate waits until the first ends. A round's deadline is a wake on the coordinator's session where the host keeps wakes, so it survives a restart.
- The coordinator's line when nobody takes a message reads `Nobody took this message: …`.
