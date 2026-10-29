---
"@flow-state-dev/workforce": minor
"@flow-state-dev/orchestration": minor
"@flow-state-dev/core": minor
"@flow-state-dev/engine": patch
---

The task board's last old words are gone (FIX-2246), with no alias and no old spelling read. Stores written by an earlier version are not upgraded: a request left in flight across the upgrade may not resume.

- `@flow-state-dev/workforce`: `hireWorkforce`'s `messages.hopLimit` is `messages.budget`, and `DEFAULT_MESSAGE_HOP_LIMIT` is `DEFAULT_MESSAGE_BUDGET`. A coordinator's routing record and a routed task's brief name the message by `messageRequestId` (it was `postId`). `upgradeWorkerEntryNames` and its types (`EntryNameFlow`, `EntryNameRequest`, `EntryNameUpgradeOptions`, `EntryNameUpgradeStores`) are removed: no stored `run`, `message` or `runTaskBoard` entry is left to rewrite. A coordinator no longer looks for a post row filed before routed tasks.
- `@flow-state-dev/orchestration`: a task notice's `asked` flag is `waitedOn`, the word `listTasks` uses. A wait gate's id starts `wait:` (it was `ask:`). A row stored with its wait mark under `ask` no longer reads as waited on. The board's dispatch blocks are named `<board>-dispatch-<assignee>` and `<board>-dispatch-fallback` (they were `-hand-off-`).
- `@flow-state-dev/core`: `isWaitGate` is true only for a gate with the reason `"wait"`; a gate stored with the reason `"ask"` is no longer a wait gate.
- `@flow-state-dev/engine`: a wait gate the waiting turn's own conversation resolves records `wait:<session>` as its resolver (it was `ask:<session>`).
