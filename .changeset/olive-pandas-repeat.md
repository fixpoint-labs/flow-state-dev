---
"@flow-state-dev/orchestration": patch
---

`unblock()` now runs only on a task that is actually `blocked`, and refuses
anything else with an illegal-transition error (an advisory write reports
`disallowed` instead of throwing).

It previously accepted an `in_progress` or `awaiting_review` task, because the
status table permits those moves to `pending` — but they are `reclaim`'s and
`resumeFromReview`'s edges, and those verbs release the claim on the way
through. `unblock` does not, so it re-queued the task while leaving the
previous attempt's lease and execution coordinate attached, and a later reader
took them for the current attempt. A genuinely blocked task carries neither
field, so nothing changes for the intended call (FIX-1005).
