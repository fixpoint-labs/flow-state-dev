# Action Forms

An action is an executable unit plus its execution policy. The framework addresses it several ways (a caller over HTTP/MCP, a webhook, a cron tick, a `dispatcher()`) but runs and records every form identically. Authoring is user-facing: [Actions](../../apps/docs/docs/fundamentals/actions.md), [Entries only the flow can reach](../../apps/docs/docs/fundamentals/flows.md).

## `ActionCore`

`ActionCore` (`packages/core/src/types/flow.ts`) is the shared shape: `block`, `inputSchema`, `onCompleted`, `onErrored`, `userMessage`, `tokenBudget`, `durable`, `concurrency`. Every form builds on it, which is what lets a webhook or scheduled handler be a first-class action without living in `flow.actions`.

| Form | Lives on | Addressed by |
|---|---|---|
| Caller-addressed | `flow.actions` (`ActionConfig` = core + `description`, `mcp`) | name, per-request principal |
| Webhook | `flow.webhooks[provider].on[event]` (`WebhookEventBinding extends ActionCore`) | `metadata.webhook` coordinate |
| Static schedule | `flow.schedules.static[id]` (`ScheduleConfig = ActionCore & { cron, … }`) | `metadata.schedule.scheduleId` |
| Dynamic schedule | resolver return, carried on the envelope | `resolvedActionCore` (transient) |
| Internal | `flow.internal.actions` | a `dispatcher()` block |
| Task | `flow.task.actions` | a task board's `dispatcher()` |

**Living off `flow.actions` is the boundary.** An event-addressed or dispatched handler has **no HTTP or MCP caller surface**, and there is no `internal`/hidden flag: the structural fact is the guard. A block wanted on both an HTTP action and an event is declared in both places. The `action` recorded on an event request is the handler block's `name`, for provenance only; it never resolves anything. The flat spelling `internal: { summarize }` is refused; entries nest under `actions`.

## Resolution: one map, no fallback

`resolveActionCore(flow, actionName, source, metadata)` (`engine/execution/resolve-action-core.ts`) maps the source to a dispatch type with `dispatchTypeOf` (`engine/transport-sources.ts`; the framework-stamped sources each map to their own type, every caller-facing source to `public`), then calls `resolveEntry(flow, type, name, coordinate?)` (`core/flow/resolve-entry.ts`), which reads **exactly one map**. An unresolved coordinate returns `undefined` and `runAction` refuses by name.

**There is no fallback into `flow.actions` from any type.** A missing binding is a missing binding, not a caller-addressed action wearing the same name. This also makes name collisions harmless: a `task` entry named like a public action never inherits that action's handler *or its concurrency policy*, because the arbiter resolves policy through the same `(type, name)` lookup.

### The source gate (security)

Event coordinates are read only when `source` is `"webhook"` / `"scheduled"`, and those sources are **set only by adapters**. The HTTP action endpoint spreads `body.metadata` onto the dispatch, so metadata on a caller-addressed request is attacker-controlled. Without the gate, a caller could POST `{ metadata: { webhook: { provider, eventType } } }` and pivot into an event handler with forged input and no signature or scheduler-secret check. The gate closes that for every caller-facing surface at once. `readDispatchStamp` is gated on `internal` / `task` the same way.

## Dispatched: `internal` and `task` entries

**The sender is a `dispatcher()` handler.** It builds a typed envelope and sends it through `DISPATCH_SEAM`, a factory-only seam attached by `createExecutionContext` and never a named member of `BlockContext`. Its address is fixed on the block, so `defineFlow` walks the graph (`walkBlockGraph`, including a `forEach` factory's declared `blocks`) and refuses a dispatcher whose entry the flow doesn't declare. A `task` dispatcher sits in a task board's `workers` under an assignee; the board binds its id and claim gate onto it, and `defineFlow` puts the entry behind that gate.

**Cross-flow.** An address may carry `flowKind` (the target's **instance id**). `defineFlow` can't resolve another flow's maps, so the walk skips it and the seam resolves it at run time against the host registry: `flow-not-found` for an unregistered flow, `no-entry` for a registered one without the entry, never a fallback to the sender's map. A `{ key }` child is derived under the target instance; an `{ id }` / `{ from: true }` delivery must name a session that instance owns (`session-not-addressable` otherwise). Lineage and state rules for cross-flow children: [Dispatched Work](./dispatched-work.md).

**Three session targets.**

| Target | Meaning | Refusals |
|---|---|---|
| `{ key }` | Derive a child of the running session (`deriveDispatchRunSessionId`, key framed in its own `dispatch` namespace) and adopt it on the same key; adoption checks the parent's lineage | |
| `{ id }` | Deliver into an existing session of the same flow and principal | unknown / other principal / other tenant → `session-not-found`; other flow or mismatched org → `session-not-addressable`; under an external dispatcher whose adapter supplies no shared lease backend → `external-dispatcher`, since the run would start on a process that can't fence the session. With a lease backend the delivery takes its place on the session's key before enqueue |
| `{ from: true }` | The same existing-session delivery, addressed at the seam-stamped sender (`readDispatchStamp` → `from.sessionId`) | a request the runtime didn't dispatch → `no-sender`, even if its HTTP body carries a perfectly shaped `metadata.dispatch.from`. Nested replies go to the immediate sender, not the oldest ancestor |

`settleParentTask` closes a board row and is a different path.

**Incarnation guard.** Acceptance is at enqueue. When the run starts, `runAction` re-reads the session and **drops** the delivery (deleting the request row) if the session was deleted and recreated in between.

**The stamp.** The dispatched request carries `source: "internal" | "task"` and a server-assembled `metadata.dispatch = { type, target, from: { block, sessionId }, key?, recipientLineageId?, … }`.

### Public re-entry is an allow-list

`isPublicReentryAllowed` (`engine/routes/public-reentry.ts`) admits `http` / `mcp` / `scheduled`, and retry, continue and resume all route through it; anything else gets the not-found shape. Retry accepts a caller-supplied `inputOverride`, so re-entering a dispatched or webhook request would feed caller-chosen input to a handler that was never caller-addressed. A host adds its own out-of-tree transport sources with `publicReentrySources` (`InboundTransportAdapter.source` is an open string). It can **never** add `webhook`, `task` or `internal`: `assertPublicReentrySources` throws at router construction, because each exclusion is a property of the framework, not the deployment.

Where a dispatched child runs, what `dispose()` waits for, and recovery: [Dispatched Work](./dispatched-work.md).

## Dynamic schedules carry their core, so they don't recover

A dynamic schedule's `ScheduleConfig` comes from a resolver at dispatch time and has no static coordinate. The adapter sets `resolvedActionCore` on the `InboundRequestEnvelope`, and `runAction` prefers it over the lookup. It is set only by adapters, only for this path, and is **not persisted** (a block can't be serialised).

| Form | Recovered via | Crash-recoverable when durable |
|---|---|---|
| Caller-addressed | `flow.actions[name]` | Yes |
| Webhook | `flow.webhooks[provider].on[event]` | Yes |
| Static schedule | `flow.schedules.static[id]` | Yes |
| Dynamic schedule | transient `resolvedActionCore` | **No**: an in-flight durable run is dropped |

Persisted dynamic-schedule rows store a `kind` discriminator that the resolver's `blocks` map turns back into a block. That's enough to dispatch the next tick, not to resume an in-flight run. A scheduled action that must survive a crash should be static.

Related: [Inbound Transports](./inbound-transports.md), [Webhook Transport](./webhook-transport.md), [Scheduled Actions](./scheduled-actions.md).
