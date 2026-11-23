---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A steer that can't start a turn on a task with no live run says so (FIX-2859).

- **orchestration:** `TaskWriteOutcome`'s `recorded` case may carry a `note`, which a wrapping ref sets when the write held but what should follow it didn't. `updateTask` returns it beside `ok: true` when a message's steer carries one.
- **workforce:** a steer through a conversation board to a task with no run in a session answers `updateTask` with a `note` saying the message was recorded but no turn could be started, so the sender isn't told it is under way. `startOwedSteerTurn` now resolves to whether it started or owed the turn; a start the runtime refused counts as not started.

Docs: packages/workforce/README.md, if it describes steering a parked task.
