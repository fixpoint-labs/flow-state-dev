---
"@flow-state-dev/cursor": minor
"@flow-state-dev/core": patch
---

**`@flow-state-dev/cursor`** — two opt-in options on `cursorAgent`, both off by default:

- `recordPlan: true` records Cursor's to-do list in the run's plan record (`observed-plan`, with its `observed-plan-list` marker): the whole list Cursor last confirmed, one row per place, with Cursor's own status words, written through core's `replacePlanList`.
- `env` runs Cursor's local runtime in a separate process whose environment is exactly the variables you pass, so commands Cursor runs can't read the rest of the server's environment. With `env` set, functions in `agent` or `send` and a custom `resolveCursorClient` are refused when the block is built.

A resume Cursor refuses because it doesn't know the agent now fails with `harnessFailure: "unknown-conversation"`, which core's `harnessFailureKind` reads.

**`@flow-state-dev/core`** — `harnessRunNamespace(ctx)`, the per-invocation namespace a harness keys its plan rows and list marker under. `@flow-state-dev/claude-code`'s `runNamespace` is now this same function.
