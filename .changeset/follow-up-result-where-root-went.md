---
"@flow-state-dev/orchestration": patch
"@flow-state-dev/workforce": patch
---

A follow-up task's result now goes where its root task's went: a follow-up of a task filed `resultTo: "conversation"` lands as the delegate's reply, with one attempt, and a follow-up that names `resultTo` is refused `follow_up_takes_no_result_to` (FIX-2122).
