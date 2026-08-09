---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Give capabilities a declared way to reach the runtime, instead of a cast (FIX-999).

A capability's helper functions are typed against the `BlockContext` that
`@flow-state-dev/core` declares, and `core` does not depend on `@flow-state-dev/engine`.
Facilities only the runtime can provide — starting a child request, settling a
durable row owned by another session, asking whether dispatched work is still
running — live on the engine's context type, so the only way to reach them was to
cast the context to a shape TypeScript said it did not have. Nothing warned when
the shape that cast asserted stopped being true.

`core` now declares the interface and `engine` implements it. Read it with
`requireRequestHost(ctx)`, which throws by name when a host wired none rather than
failing as `undefined is not a function`. Nothing an app author writes changes.

Two rules make it safe, both structural rather than validated: what crosses is
behaviour and never handles (no `core` type names a store, a flow, a session
record or a task row), and identity is never a parameter — a caller supplies a
routing seed and the runtime derives the child session from it together with the
tenant, the principal and the parent session.

Also in this change:

- Flows gain a `workstream` entry: the single pre-assembled core a detached
  dispatch resolves. Resolution is terminal for that source, so a flow without one
  refuses by name and never falls through to a caller-addressed action.
- `retry`, `continue` and `resume` now share one **allow-list** of re-enterable
  transport sources (`http`, `mcp`, `chat`, `scheduled`) instead of three separate
  webhook deny-lists. **This is a behaviour change:** a request whose source is not
  on the list is no longer re-enterable and returns the same not-found shape a
  missing request does. A deployment using a third-party transport source must add
  it to the allow-list.
- Every request registry now declares whether it is shared across processes, read
  fail-closed — an adapter that declares nothing is treated as per-process. The
  Postgres adapter answers from its construction shape, so a store built with an
  injected `{ executor }` (PGlite) is not shared. Out-of-tree adapters keep working
  and simply do not enable liveness-dependent behaviour.
- Liveness-dependent behaviour is enabled only when the registry is shared,
  heartbeats are on and fast enough for the stale threshold, and stale sweeping is
  running. When any of those does not hold the capability is absent and says why at
  construction, rather than answering with a value that can be wrong.
- `createFlowState` now builds the seam onto the runtime config it shares with
  both the HTTP router and the execution backend, so a request served over HTTP,
  a colocated worker job and a worker-only job all reach a block with the same
  seam. `createFlowApiRouter` supplies it too for a host built directly on the
  router. The liveness gate is fed from the same stale-sweep cadence and threshold
  the sweeper is configured with, resolved by one shared rule, so a deployment
  configures those once and the gate cannot reason about a sweeper that does not
  exist. Detached starts still refuse by name on these paths — no host start
  operation is wired to them yet.
- The seam is built from the session and org the request actually resolved to,
  not from the dispatch's raw arguments. An action that omits `sessionId` runs
  under a generated session and now gets the seam (previously it was withheld and
  `requireRequestHost` threw inside an otherwise normal request), and a dispatch
  that omits `orgId` against an org-bound session now inherits that session's org,
  so a detached child is created inside the parent's org as its contract promises.
- A liveness answer is now scoped to the asking flow. A session id is not a flow
  boundary (a reused session is validated for user, tenant and org, but not flow
  kind), so a request belonging to another flow under the same session id is no
  longer reported as live work of the current one.
- A queued request's registry heartbeat now follows the flow's configured
  `request.heartbeatIntervalMs` instead of a fixed 10s. A flow pairing a fast
  heartbeat with a tight stale threshold could previously have a valid queued
  request reaped and reported dead before its first beat.
- A request handed to an external dispatcher is now recorded as queued until a
  worker claims it, and counts as live for as long as it waits. Previously its
  age was measured as though a worker were already running it, so a queue backlog
  longer than the stale threshold made valid jobs read as dead: the sweeper marked
  them interrupted and recovery could retry work the queue was still holding.
  Registries gain a nullable `queued_at` column, added by an idempotent migration;
  existing rows read back as claimed and sweep exactly as before. A job that never
  arrives is still reaped — after a queued grace of 10 minutes by default, which
  `detectInterruptedRequests` accepts as `queuedGraceMs`.
