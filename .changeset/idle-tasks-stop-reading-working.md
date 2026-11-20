---
"@flow-state-dev/ui": patch
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A task with no live run no longer reads as working, and a steer that can't start a turn says so (FIX-2859).

- **ui:** the `task-signals` registry item reads a running task that holds no lease (kept open, owing a turn, or waiting on its pull request) as `idle · 3d`, timed from its last write, instead of `working · 72h`. The signal type gains an `"idle"` value (not `"waiting"`, which the counts keep for a task held for a user): an app that maps each value to a tone adds one. A running task given no run reads nothing, as before. `quiet for` now reads on the same minutes / hours / days scale as an ended task's age (`quiet for 2d`, not `quiet for 48h 0m`). Re-copy the item into apps that install it.
- **orchestration:** `TaskWriteOutcome`'s `recorded` case may carry a `note`, which a wrapping ref sets when the write held but what should follow it didn't. `updateTask` returns it beside `ok: true` when a message's steer carries one.
- **workforce:** a steer through a conversation board to a task with no run in a session answers `updateTask` with a `note` saying the message was recorded but no turn could be started, so the sender isn't told it is under way. `startOwedSteerTurn` now resolves to whether it started or owed the turn; a start the runtime refused counts as not started.

Docs: apps/docs registry page for `task-signals` (the new idle signal); packages/workforce/README.md, if it describes steering a parked task.
