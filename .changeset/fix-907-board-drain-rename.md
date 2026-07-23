---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/patterns": minor
---

Rename the task-board handle's `block` field to `drain`. `taskBoard({...})` now returns `{ drain, collectionId, capability }`; mount the runner with `.step(board.drain)` instead of `.step(board.block)`. The old name was opaque — every mountable thing is a "block" — while `drain` names what the field actually is: the runner that claims pending tasks, runs workers, and loops until the board is idle. Runtime behavior is unchanged.

Migration: replace `board.block` with `board.drain` everywhere you mount a task board. There is no alias — the old field is gone.
