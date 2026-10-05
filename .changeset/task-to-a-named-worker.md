---
"@flow-state-dev/core": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

- core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger.
- orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee.
- workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback and `filingCheck` into a mailbox's new `checkAssignee` option, which refuses `fileTask` for a name no worker holds. `mailboxTaskLists(ids)` lets a worker take tasks from mailbox lists, and the `agent` kind's new `taskLists` option gives it a `work` task entry over them.
