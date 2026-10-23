---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A task now settles when its turn ends: a message to its session no longer holds it open and isn't part of it (while the task's turn is running, it's answered after that turn), with no claim on the task, so it can't report progress and its error doesn't fail the attempt. `TaskEndRules.workQueued` and the `"queued"` value of `waitingOn` are removed; a stored row waiting on `"queued"` reads as answered and waiting on its filed work, and `backfillBoardWakes` owes its session the check that settles it with the answer it kept. Steer open work with `updateTask({ message })` (FIX-2103).
