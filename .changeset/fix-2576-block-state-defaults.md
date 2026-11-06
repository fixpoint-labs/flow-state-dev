---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/workforce": minor
---

A session, user or org field that a block or capability declares with a default now reads as that default on a fresh or older record, with no restating on the flow (FIX-2576). Two upgrade refusals come with it. `defineFlow` throws when two declarations of one field (the flow's, a block's, a capability's) differ in type or default, naming the field and both declarers. The server refuses to start when two flows type or default a shared user or org field differently. `hireWorkforce` no longer requires a manager flow to spread the board's `sessionStateShape` into its session schema.

Docs: apps/docs/docs/fundamentals/state-and-scopes.md (Schema bubbling: block and capability declarations now fill defaults, drop the "only the flow's own stateSchema" paragraph and the restate advice, add the two refusals; Creating sessions: defaults from every declaration the flow reaches) · apps/docs/docs/fundamentals/capabilities.md (a line beside the `sessionStateSchema` row) · packages/workforce/README.md and apps/docs/docs/workforce/delegating-work.md (a manager flow no longer needs to spread `sessionStateShape`)
