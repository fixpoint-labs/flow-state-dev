---
"@flow-state-dev/core": patch
"@flow-state-dev/testing": patch
"@flow-state-dev/memory": patch
"@flow-state-dev/orchestration": patch
"@thought-fabric/core": patch
---

Give a state-update callback a way to return its outcome, so a retried write
reports only what it committed.

`updateState`'s callback is not guaranteed to run once: on the CAS path, a
persist that loses its version check refreshes from the store and calls the
callback again, keeping only the last attempt's output. A callback that reports
its result by assigning to a variable declared outside itself therefore reports
whichever attempt assigned last — including an attempt whose write was thrown
away. Today that is latent, because nothing retries yet.

`updateStateWith(ref, updater)` and `withOutcome(run, updater)` (new, from
`@flow-state-dev/core/helpers`) take an updater that returns `{ state, result }`
and hand back the `result` belonging to the invocation that committed, or
`undefined` if none did. `withOutcome` is parameterised by the mutation runner
rather than by a resource, so it covers `ref.updateState`, a scope's
`atomicState`, and wrappers built over either.

Twenty-four first-party callbacks across memory, identity/perspective, the
graph edge store, and both task-collection backings now use it. Behaviour on a
single invocation is unchanged everywhere; what changes is what these helpers
report when a write is replayed — `evict`/`pin`/`unpin`/`refresh` and the
perspective helpers no longer return `true` for an entry they did not touch,
the memory janitor's culled/marked ID lists no longer accumulate and duplicate
across attempts, and a task write no longer reports `recorded` (or emits a
`task-change`) for an attempt that lost, including the claim path that could
hand one lease to a second worker.

`@flow-state-dev/testing` gains `createReplayingRef`, a CAS-shaped double that
invokes an updater twice so this class of defect is testable.

A new repo-wide check, `scripts/validate-updater-purity.mjs`, runs in
`pnpm typecheck` and fails the build if a mutation callback assigns to an outer
binding, mutates through one, or assigns one of its properties.
