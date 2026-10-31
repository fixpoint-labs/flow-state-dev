---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

- `@flow-state-dev/workforce`: a coordinator's routing record and a routed task's brief name the message by `messageRequestId`. `upgradeWorkerEntryNames` and its types (`EntryNameFlow`, `EntryNameRequest`, `EntryNameUpgradeOptions`, `EntryNameUpgradeStores`) are removed.
- `@flow-state-dev/orchestration`: a task notice's waited-on flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:`. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback`.
- `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`.
- `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver.
