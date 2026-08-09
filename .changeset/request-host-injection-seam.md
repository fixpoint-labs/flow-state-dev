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
  missing request does. A deployment using its own inbound transport names that
  transport's source in the new `publicReentrySources` option on `createFlowState`
  and `createFlowApiRouter` — `InboundTransportAdapter.source` is an open string,
  so the framework cannot enumerate out-of-tree sources and an allow-list nobody
  could extend would take recovery away from them permanently. Two sources are
  not openable and are refused when the router is built: `webhook`, whose handler
  is reachable only behind signature verification, and the detached-dispatch
  source, which has no caller-facing entry at all.
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
  arrives is still reaped — after a queued grace of 10 minutes by default.
- That queued grace is now a host option, `queuedGraceMs`, on both
  `createFlowState` and `createFlowApiRouter`. It governs every path that sweeps:
  the periodic stale-request sweeper, the detection pass on server startup, and
  the on-demand `check-interrupted` endpoint. A deployment whose legitimate
  backlog outlasts ten minutes can raise it instead of watching valid queued jobs
  get marked `interrupted` while the queue still holds them. It stays independent
  of `staleSweepThresholdMs` on purpose: that one measures how long since a
  running worker checked in, which a job no worker has claimed yet cannot answer.
- `staleSweepThresholdMs` now governs every path that sweeps, matching
  `queuedGraceMs`: the periodic sweeper, the detection pass on server startup,
  and the on-demand `check-interrupted` endpoint. The latter two each carried a
  private 30-second default, so a server whose threshold was anything else —
  including one that configured nothing, since the default is 60 seconds — reaped
  on a tighter clock at startup and on every DevTool refresh than it used for the
  rest of its life. Either could mark a healthy cross-process request
  `interrupted` and deregister it, after which liveness reported still-running
  work as dead and recovery could re-dispatch it. **`check-interrupted`'s
  documented default changes** from a fixed 30 seconds to the host's configured
  threshold; an explicit `staleThresholdMs` query parameter still wins, so a
  caller that wants a narrower window keeps it.
- Liveness-dependent behaviour is no longer enabled for a host that initializes
  only its runtime (`getRuntime()`) and never its router. The stale sweeper is
  started by the router, so a worker-only consumer — or a CLI run that resolves
  the runtime alone — has nothing sweeping, and an abandoned queued entry there
  would read as live indefinitely. Those hosts now get the same named refusal any
  other unswept deployment gets. A host that serves HTTP is unaffected.
- A **colocated worker** gets liveness back once its own process starts
  sweeping. `worker.mode: "colocated"` runs the worker and the router together,
  and the sweeper the router starts is a real sweeper for both — but the worker
  captured the runtime config before the router existed, so it kept the refusal
  above and every job it ran lost `livenessOf` even while the router beside it
  swept on schedule. `createFlowState` now records the sweeper on the config it
  shares with the worker when it builds the router. A host that never builds one
  still refuses, which is the case that refusal is for.
