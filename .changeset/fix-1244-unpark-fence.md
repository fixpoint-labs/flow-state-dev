---
"@flow-state-dev/orchestration": minor
---

`resumeFromReview` is renamed `unpark` and now refuses every status but `parked` as a `declined` value instead of writing or throwing, and the task board gains `board.unparkAndDrain`, a step that writes an answer to a parked task and drains the board in the same request only when the answer was accepted (FIX-1244).
