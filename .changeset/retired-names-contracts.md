---
"@flow-state-dev/contracts": minor
---

`isUserSuspension` and `suspendForUserKindOf` read a stop core 0.2.0 stored under `human_approval` or `human_input` as a user's approval or input, so a stop waiting in your store when you upgrade is answered as a user's stop again. A new use of either reason is refused where it is written, naming `user_approval` or `user_input` (FIX-2454).

Docs: apps/docs/docs/advanced/durable-execution.md (one line beside the reasons: a stored `human_*` stop reads as a user's; a new one throws)
