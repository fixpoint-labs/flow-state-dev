---
"@flow-state-dev/engine": minor
---

`ctx.suspend({ reason: "human_approval" })` and `{ reason: "human_input" }` now throw `RetiredNameError`, naming `user_approval` or `user_input`, instead of suspending under a custom reason that never reaches the Inbox. A stop core 0.2.0 stored under either still resumes, as a user's stop. The retired `dispatcher` option (use `runner`) is refused with the same error, which names engine 0.7.0 as the version that removes the refusal. `createFlowState` no longer refuses `middleware`, `detachedDrainTimeoutMs` or `maxWorkstreamListLimit` by name: no published engine accepted them (FIX-2454).

Docs: apps/docs/docs/advanced/durable-execution.md (a new `human_*` reason throws, naming its `user_*` replacement)
