# Architecture Quick Reference

The traps most worth knowing before you change something, one line each, with the doc that owns the detail. Locked contracts and package boundaries are in [Architecture Overview](../architecture/overview.md); everything else in `docs/architecture/` is read when relevant.

## Authority order

1. `docs/philosophy.md`
2. `docs/architecture/*`
3. `docs/contributing/best-practices.md`
4. `AGENTS.md`

The more specific reference wins (e.g. `streaming.md` over a general line in `overview.md`).

## State and resources

- **Bag state verbs don't share one guarantee.** Same-path writes split three ways: commutative (single-field `incState`, `pushState`; both land), unchecked last-write-wins that still returns `true` (`setStateRecord`, `deleteStateRecord`, single literal-field `patchState`), and version-checked. `setState` is checked yet discards the other writer's change. → [Atomicity Guarantees](../architecture/state-and-scopes.md#atomicity-guarantees)
- **Same names, different guarantees on resources.** Every resource *state* mutator is version-checked (including `incState`/`pushState`); `create(key, v, { replace: true })` on a writable collection and `writeContent` are not. → [CAS and Concurrency](../architecture/state-and-scopes.md#cas-and-concurrency)
- **Session and request ids are addresses, not ownership**: a foreign one answers exactly like an unused one. → [State and Scopes](../architecture/state-and-scopes.md#a-session-id-is-an-address-not-an-ownership)
- **Scope state is server-private**; only a scope's `client` (`expose` / `derived`) crosses. → [Resources and Client Data](../architecture/resources-and-client-data.md#client-data)
- **A key segment beginning `~` belongs to an owner-private collection** in every app. → [Owner-private collections](../architecture/resources-and-client-data.md#owner-private-collections)
- **Set `ref` on any non-session resource registered under two names**, or its storage key depends on declaration order. → [Resources](../architecture/resources-and-client-data.md#identity-and-storage-keys)

## Entry points and dispatch

- **One map per entry type, no fallback into `flow.actions`.** Event coordinates are read only for adapter-set sources. → [Action Forms](../architecture/action-forms.md)
- **Public re-entry is an allow-list** (`http`, `mcp`, `scheduled`); `webhook`, `task`, `internal` can never be added. → [Action Forms](../architecture/action-forms.md#public-re-entry-is-an-allow-list)
- **`internal` and `task` dispatchers may both address another flow** with `flowKind` (an instance id); misses are `flow-not-found` / `no-entry`, and a cross-flow child roots its own lineage. → [Dispatched Work](../architecture/dispatched-work.md#dispatching-into-another-flow)
- **Locality is the effective dispatcher, not `worker.mode`.** `worker-only` runs dispatched work in-process and **not durably**. → [Dispatched Work](../architecture/dispatched-work.md#locality-the-effective-dispatcher-decides-not-workermode)
- **`settleParentTask` takes no `claim`**; the fence ticket is re-minted from the verified row. → [The claim gate](../architecture/dispatched-work.md#the-claim-gate-and-the-fence-ticket)
- **Concurrency policy is enforced once, at `host.dispatch`**, before any record exists; external dispatch is arbitrated only with a shared lease backend. → [Inbound Transports](../architecture/inbound-transports.md#concurrency-arbitration)
- **MCP `session: { fromInput }` is caller-controlled**: single trusted principal only. → [MCP](../architecture/mcp-server.md#sessions-security)
- **Dynamic schedules don't survive a crash** (their handler isn't persisted). → [Action Forms](../architecture/action-forms.md#dynamic-schedules-carry-their-core-so-they-dont-recover)

## Execution and streaming

- **Routers on a durable path must be pure**; resume re-runs the selector. → [Execution and Errors](../architecture/execution-and-errors.md#routers-under-resume)
- **Background work is at-least-once across suspend/resume**; guard side effects with `ctx.runOnce`. → [Background work under replay](../architecture/execution-and-errors.md#background-work-under-replay-locked)
- **`livenessOf` returning `false` never means "dead"**; don't re-dispatch on it alone. → [Liveness](../architecture/dispatched-work.md#liveness)
- **Replayable events are persisted before they reach the wire**; deltas are never replayed. → [Streaming](../architecture/streaming.md#durability-ordering)
- **Session stream: dedupe by `(requestId, item.id)`**, never `item.id`. → [Session stream](../architecture/streaming.md#session-stream)
- **There is no block middleware.** → [Internal Execution Seams](../architecture/internal-execution-seams.md)

## Workforce

- **`hireWorkforce` is the only admission gate**: absent `flow:` → built-in `agent`; an unregistered name is refused by name. A replacement `agent` must declare `kind: "agent"` and `cardinality: "collection"`. → [Workforce worker kind](../architecture/workforce-default-worker-kind.md)

## Definition of Done (Phase 1)

- All package contracts compile and match the architecture docs.
- Tests pass across packages.
- Example flows run with item-first streams and explicit `userId`.
- CLI commands work end-to-end.
- DevTool runs actions, streams live, replays with both resume modes.
