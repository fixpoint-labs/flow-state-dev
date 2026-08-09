---
"@flow-state-dev/core": minor
"@flow-state-dev/engine": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/store-postgres": minor
---

Capabilities can now reach runtime facilities — starting a child request, settling a durable row owned by another session, asking whether dispatched work is still running — through an interface `@flow-state-dev/core` declares and `@flow-state-dev/engine` implements (FIX-999). Read it with `requireRequestHost(ctx)`, which throws by name when a host wired none rather than failing as `undefined is not a function`. Nothing an app author writes changes.

Flows gain a `workstream` entry: the single pre-assembled action core a detached dispatch resolves. A flow without one refuses that dispatch by name and never falls through to a caller-addressed action.

**Breaking: `retry`, `continue` and `resume` now work from an allow-list of transport sources.** They admit `http`, `mcp`, `chat` and `scheduled`; a request that arrived on any other source is no longer re-enterable and gets the same not-found response a missing request does. If you run your own inbound transport, name its source in the new `publicReentrySources` option on `createFlowState` and `createFlowApiRouter` to restore re-entry for it. `webhook` and the detached-dispatch source cannot be named — the router throws at construction if you try, because neither is caller-addressed and re-entering one would run it with caller-supplied input.

**Breaking: `check-interrupted`'s stale threshold now defaults to the host's `staleSweepThresholdMs`** (60 seconds) instead of a fixed 30 seconds. An explicit `staleThresholdMs` query parameter still wins. Both sweep bounds — `staleSweepThresholdMs` and the new `queuedGraceMs` — now govern every path that sweeps: the periodic sweeper, the detection pass on server startup, and `check-interrupted`.

**Migration:** request registries gain a nullable `queued_at` column, added by an idempotent migration. Existing rows read back as claimed and sweep exactly as before, so there is no step to run.

Also in this release:

- **`queuedGraceMs`** is a new host option on `createFlowState` and `createFlowApiRouter`: how long a request handed to an external dispatcher may sit unclaimed before a sweep treats it as lost. Default 10 minutes. A queued request now counts as live for as long as it waits, instead of being aged as though a worker were already running it. Raise this if your legitimate backlog can outlast the default. It must be finite and non-negative — the host throws at construction otherwise, because this grace is the only bound on a queued request and a value nothing can exceed would leave a lost job reported live indefinitely. Use `0` to reap queued requests as soon as they go stale.
- A queued request's registry heartbeat now follows the flow's `request.heartbeatIntervalMs` instead of a fixed 10 seconds.
- `ActiveRequestRegistry` now declares `sharedAcrossProcesses`, read fail-closed: an adapter that declares nothing is treated as per-process. Out-of-tree adapters keep working and simply do not enable liveness. The Postgres adapter answers from its construction shape, so a store built with an injected `{ executor }` (PGlite) reports not shared.
- Liveness is available only when the registry is shared across processes, heartbeats are on and fast enough for the stale threshold, and a stale sweeper is running. When any of those does not hold, `livenessOf` is absent from the host and the refusal names which condition failed. A host that initializes only `getRuntime()` and never a router has nothing sweeping and does not get it; a colocated worker does, once `ready()` has started the router's sweeper.
- A liveness answer is scoped to the asking flow, so a request belonging to another flow under the same session id is no longer reported as live work of the current one.
- A request that omits `sessionId` runs under a generated session and now gets the host (it was previously withheld, and `requireRequestHost` threw inside an otherwise normal request). A dispatch that omits `orgId` against an org-bound session now inherits that session's org, so a detached child is created inside the parent's org.
