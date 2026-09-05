---
"@flow-state-dev/core": minor
"@flow-state-dev/claude-code": minor
---

Background Claude Code runs can continue a previous conversation (LAB-154).

`claudeCodeAgent` and `createClaudeCodeAgentCapability` take `resume` (which
session this run continues — return `null` to start fresh) and `onSession`
(called during the run when the agent names its session, so a cancelled run's id
is not lost). Both are background-path only and throw at construction without
`detached: true`.

Three things existing code can trip over:

- **`cwd`, `sandbox` and `resume` resolvers are now handed the block context
  alone.** They used to receive the run's input as a first argument. Drop it:
  `cwd: (_input, ctx) => …` becomes `cwd: (ctx) => …`.
- **`costUsd` is gone from the SDK handle.** Read `cost.usd`. Handles already
  persisted with the old field still load.
- **`HarnessResolver` in `@flow-state-dev/core/types` matches**, and its context
  keeps its types where it previously widened them to `any` — a resolver body
  reading an undeclared scope-state field no longer compiles.
