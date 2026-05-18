# @flow-state-dev/utilities-task-flow

Substrate utilities for shaping how information flows through plan-shaped
Task Board patterns (Plan & Execute, Supervisor, Coordinator). Two
independent layers:

- **Tool-result memoization** — `createToolCacheCapability` + per-tool
  opt-in via `BlockConfig.cacheable`. Identical tool calls within a
  scope (run / request / session) are served from cache; identical
  in-flight calls in one request coalesce.
- **Task flow policy** — `createObservationLedgerCapability` plus a
  `TaskFlowPolicy` interface and built-in policies (`declaredDepsOnly`,
  `recentTrajectory`, `ancestors`, `allCompleted`, `compact`, `custom`)
  that select which prior-task observations a worker sees on its
  `TaskWorkerInput.priorWork` slot.

Both are wired automatically by `taskBoard` when the corresponding
config is set. They can also be installed on a standalone generator
via `uses: [...]` for non-board use cases.

See `docs/patterns/flow-policy.md` for the user-facing guide.
