---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A task now settles when its turn ends: a message sent to its busy session no longer holds it open, and runs afterwards as conversation, with no claim on the task, so it can't report progress and its error doesn't fail the attempt. `TaskEndRules.workQueued` and the `"queued"` value of `waitingOn` are removed; a stored row waiting on `"queued"` reads as waiting on nothing, and its lease takes it back. Steer open work with `updateTask({ message })` (FIX-2103).
