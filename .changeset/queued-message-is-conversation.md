---
"@flow-state-dev/orchestration": minor
"@flow-state-dev/workforce": minor
---

A task now settles when its turn ends: a message to its session no longer holds it open and isn't part of it (FIX-2103). While the task's turn is running, the message is answered after that turn, with no claim on the task, so it can't report progress and its error doesn't fail the attempt. Steer open work with `updateTask({ message })`.
