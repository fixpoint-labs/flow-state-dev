---
"@flow-state-dev/workforce": minor
---

`defineAgentWorkerFlow` takes three new app-level options, so an app can compose capabilities into its own copy of the built-in worker kind instead of forking the factory: `uses` (capabilities attached to every worker, beside the skills binding), `afterAnswer` (a block run after the answer as a side-chain), and `isolateUserState` (each worker gets its own user-scoped storage). All three default to the empty case, so a no-argument call builds what it always built. The README carries the recipe for attaching memory through them (FIX-1364).
