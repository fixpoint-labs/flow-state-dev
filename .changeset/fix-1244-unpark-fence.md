---
"@flow-state-dev/orchestration": minor
---

`resumeFromReview` is renamed `unpark` and fenced to the one edge it owns (FIX-1244): it runs only on a `parked` task and refuses every other status as a value — `{ outcome: "declined", reason: "disallowed", status }` for a live task, `reason: "terminal"` for a settled one — writing nothing. One park takes one answer: a second delivery to an already-queued task declines with `status: "pending"` and the first answer stands. The task board gains `board.unparkAndDrain`, a step that takes `{ taskId, feedback }`, runs the fenced write, and drains the board in the same request only when the answer was accepted, returning the write outcome unwrapped. It throws when the step runs (not when the board is built) on a board that is not resource-backed, or whose `initialTasks` carry no stable id.

Migration: rename `resumeFromReview` calls — and the method on any hand-written `TaskCollectionRef` implementation — to `unpark`. A caller that omitted `{ ifAllowed: true }` and caught the throw on a settled task now receives a `declined` value instead, so check the outcome rather than catching. The `task-change` kind `"resumed"` is unchanged.
