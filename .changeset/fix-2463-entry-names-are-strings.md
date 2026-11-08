---
"@flow-state-dev/workforce": minor
---

**Breaking:** a worker flow names each entry the framework calls by its documented string, the way it names its `respond` action, and the `*_ENTRY` constants for them leave the `@flow-state-dev/workforce` root with no alias (FIX-2463). An old import fails to compile with "has no exported member".

- **The names:** `work` (a task entry, built by `workerTaskEntry`), `onTaskSteered` (`steerTurnEntry`), `onMessageReceived` (`messageReceivedEntry`), `onWorkstreamOpened` (`workstreamOpenedEntry`), and `onTaskSettled` (orchestration's `taskSettledEntry`, spread by `board.entries(turn)`). Write `task: { actions: { work: workerTaskEntry({ name, turn }) } }` and `internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind }) } }`. The strings themselves are unchanged.
- **Removed from the root:** `WORKER_TASK_ENTRY`, `STEER_TURN_ENTRY`, `MESSAGE_RECEIVED_ENTRY`, `WORKSTREAM_OPENED_ENTRY` and `FILE_SCHEDULED_TASK_ENTRY`. `MESSAGE_RECEIVED_ENTRY` also leaves `@flow-state-dev/workforce/browser`.
- **New refusal at hire:** a piece one of those factories built, under any other name or in another section (`onTaskSteerd: steerTurnEntry(...)`, say), is refused by `hireWorkforce` and `workerFlowProblems`, naming the entry it belongs under. Before, a misspelled steer or workstream entry was hired and its turn never ran.

Docs: packages/workforce/README.md (every `MESSAGE_RECEIVED_ENTRY`, `STEER_TURN_ENTRY`, `WORKER_TASK_ENTRY` and `WORKSTREAM_OPENED_ENTRY` example and table row becomes the string; the entry names are documented strings, and a misnamed factory piece is refused at hire), apps/docs/docs/workforce/messaging-workers.md and apps/docs/docs/workforce/projects.md (the entries as strings: `onMessageReceived`, `onWorkstreamOpened`), packages/harness-manager/README.md and apps/docs/docs/orchestration/harness-manager.md (`onTaskSteered` and `onMessageReceived` as strings in the coder flow example)
