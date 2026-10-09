---
"@flow-state-dev/orchestration": minor
---

The task tools' roster type is renamed `WorkerRoster` → `AssigneeRoster`, the name for who a board's tasks can be assigned to. Its shape is unchanged (`has(assignee)`, `describe()`), so updating the import is the whole migration. The new `AssigneeRosterSource` is either a fixed `AssigneeRoster` or a function of the running block's context that is read on each call that checks an assignee, for a board whose team changes while it is in use. `createTaskToolsCapability(resolver, roster?)` and both `taskToolActions` overloads accept it (FIX-1794).

A durable task ledger can take `defineTaskCollection({ recordEnding })`, a pure function that is handed every write recording how a task ended (completed, errored, retried, parked, cancelled) inside that same write, and whose `metadata` the row keeps. There is one ending signal on both backings. The ending is detected once, where every write passes, and each recorder runs there in the ending's own write: orchestration's resume recorder first (`Task.resumeOwed` on an asked row's ending, unchanged), then the declared `recordEnding`. `awaitReview(..., { quiet: true })` tells the recorders a park asks nobody anything (FIX-1794).
