---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
---

A coordinator now hands each message to a delegate by filing a routed task: an ordinary task on the conversation's board with `session: "ongoing"`, `resultTo: "conversation"` and one attempt, worked on the delegate flow's `work` entry. Posts are gone. (FIX-2083) What to change or expect:

- A delegate is a worker whose flow takes tasks. Declare `work` with `workerTaskEntry({ name, turn })`; the turn is still handed `{ message }`. Removed: `DELEGATED_POST_ENTRY`, `delegatedPostEntry`, `delegatedPostHistory`, `delegatedPostOnFinished`, `delegatedPostSchema` and `DelegatedPost`.
- Removed: `defineCoordinatorFlow`'s `delegateFlows`, `defineSessionBoard`'s `postFlows` and `posts`, and `posts`/`both` in what `listDelegates` says a delegate `takes` (now `tasks` or `nothing`). A worker on a flow that takes no task can't be added as a delegate.
- A judgment coordinator hands a message on with `createTask` and the routing settings (`session: "ongoing"`, `resultTo: "conversation"`, and `target` for a workstream's record); the server attaches the message as written. `dispatchTask` has no post form: `post` is refused by name (`dispatch_takes_no_post`). `createTask` takes `target`, set at filing only; `updateTask` refuses `session`, `resultTo` and `target` (`filing_setting_fixed`). `getTask` shows a task's `session`, `resultTo` and `target`.
- Removed: `taskLedgers({ taskTurn })`. A routed turn is a task turn, and a `taskLedgers` resolver is handed the claimed task's id as its fourth argument.
- A delegate that files work for a message answers once that work has ended, and a second message to a busy delegate waits until the first ends. A round's deadline is a wake on the coordinator's session where the host keeps wakes, so it survives a restart.
- A post row stored before this release reads as a routed task, through the retired-shape map's `post` entry, which is now on.
- The coordinator's line when nobody takes a message reads `Nobody took this message: …`.
