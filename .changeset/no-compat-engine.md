---
"@flow-state-dev/engine": minor
---

`createFlowState` no longer refuses `middleware`, `detachedDrainTimeoutMs` or `maxWorkstreamListLimit` by name; no published engine accepted them, and each is now an unknown option. `ctx.suspend({ reason: "human_approval" })` and `{ reason: "human_input" }` throw, naming `user_approval` or `user_input`, instead of suspending under a custom reason that never reaches the Inbox; a stop core 0.2.0 stored under either still resumes, as a user's stop (FIX-2454).

Docs: apps/docs/docs/advanced/durable-execution.md (a new `human_*` reason throws, naming its `user_*` replacement). The removed options go outright, with no refusal message.
