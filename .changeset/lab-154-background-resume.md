---
"@flow-state-dev/core": minor
"@flow-state-dev/claude-code": minor
---

Background Claude Code runs can continue a previous conversation (LAB-154).

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take two new options on
the background path (`detached: true`). `resume` says which session the run
continues — return `null` or `""` to start fresh, which is what the option does
when you leave it out. `onSession` is called during the run, the moment the agent
names the session it is in, so a host can record an id that a cancelled run would
never have returned a handle to carry. Both throw at construction if set without
`detached: true`: in session, the block already resumes the last run and records
the new id itself, and a second answer to either question would be two owners of
one decision.

The SDK handle's deprecated `costUsd` is gone. It was a copy of `cost.usd`,
carried for one release while a reader caught up; read `cost` instead. Handles
persisted with the old field still load — it is dropped, not rejected.

`HarnessResolver` and `HarnessSessionHook` in `@flow-state-dev/core/types` now
hand a callback a context that is only loose where a harness's own configuration
decides the shape (its session state, and the targets and capability namespaces
its `uses` derives). Everywhere else the context keeps its types, so scope state
a host never declared reads `unknown` rather than `any` — a misspelled or
undeclared field in a resolver body is now a compile error. The context alias is
exported as `HarnessCallbackContext`.
