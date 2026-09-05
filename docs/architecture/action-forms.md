# Action Forms

An action is an executable unit plus its execution policy. The framework
addresses and authenticates that unit in several ways — a caller naming it
over HTTP, a webhook delivering an event, a chat mention, a cron tick — but
runs and records every form identically. This doc is the canonical reference
for the shared model (FIX-439 introduced it for webhooks; FIX-838 extended it
to chat and scheduled).

## `ActionCore`

`ActionCore` (`packages/core/src/types/flow.ts`) is the shared shape every
form builds on:

```ts
type ActionCore<TBlock extends BlockDefinition = BlockDefinition> = {
  block: TBlock;                 // the executable unit
  inputSchema?: TBlock["inputSchema"];
  onCompleted?: BlockDefinition;
  onErrored?: BlockDefinition;
  userMessage?: (input) => string;
  tokenBudget?: { maxTotalTokens: number; warnAt?: number; onExceeded?: ... };
  durable?: boolean;
};
```

The core is independent of how the action is addressed or authenticated.
Generalizing it is what lets a webhook handler, a chat handler, or a scheduled
handler be a first-class action without living in `flow.actions`.

## Two address forms

### Caller-addressed: `ActionConfig` in `flow.actions`

A caller-addressed action is the `ActionCore` plus exposure metadata for the
client-facing HTTP and MCP surfaces (`description`, per-action `mcp`). A caller
names the action and a principal is authorized per request. These live in
`FlowDefinition.actions`.

```ts
actions: {
  reply: { block: replyBlock, description: "..." },
}
```

### Event-addressed: transport bindings carrying the core inline

A webhook, chat, or scheduled handler is an action in transport form. It
extends `ActionCore` with an event mapping and lives on the transport map, not
in `flow.actions`:

```ts
// Webhook — flow.webhooks[provider].on[event]
interface WebhookEventBinding extends ActionCore { input; sessionId?; when?; }

// Chat — flow.chat.on[eventKey]
interface ChatEventBinding extends ActionCore { input; sessionId?; when?; }

// Scheduled — flow.schedules.static[id] (or a resolver return)
type ScheduleConfig = ActionCore & { cron; input?; principal?; timezone?; ... };
```

`defineWebhookBinding`, `defineChatBinding`, and `defineScheduleBinding` are
compile-time conveniences — each is a passthrough that constructs the binding
with a typed `event`/config. A plain object literal works just as well.

Because an event-addressed handler never enters `flow.actions`, it has **no
HTTP or MCP caller surface**. There is no `internal` or hidden flag — the
structural fact that it lives off `flow.actions` is the boundary. A block
wanted on both an HTTP action and an event is declared in both places, using
the same block reference. The `action` recorded on the dispatched request is
the handler block's `name`, for provenance only — it is never used to resolve
the handler.

## The resolution seam: `resolveActionCore`

`resolveActionCore(flow, actionName, source, metadata)` (in
`@flow-state-dev/engine`, `execution/resolve-action-core.ts`) is the single
function that finds the core to run:

```ts
function resolveActionCore(flow, actionName, source, metadata): ActionCore | undefined {
  const type = dispatchTypeOf(source);                         // public | chat | webhook | schedule | task | internal
  return resolveEntry(flow, type, actionName, metadata);       // ONE map, no fallback
}
```

`resolveEntry` reads exactly one map for the dispatch's type: `flow.actions`
by name for `public`; `flow.webhooks[md.webhook.provider].on[md.webhook.eventType]`,
`flow.chat.on[md.chat.eventKey]` and `flow.schedules.static[md.schedule.scheduleId]`
by their **namespaced** metadata coordinate for the event forms;
`flow.internal.actions` and `flow.task.actions` by name for the dispatched
forms. A coordinate that does not resolve is `undefined`, and `runAction`
refuses the dispatch by name. There is no fallback from any map into
`flow.actions`: an event whose binding is missing is a missing binding, not a
caller-addressed action wearing the same name. This is the seam that lets an
event handler be a first-class action without ever appearing in
`flow.actions`.

### The source gate (security)

Each event branch is gated on its `source` (`"webhook"`, `"chat"`,
`"scheduled"`). Those sources are set **only by the adapters**, never from a
request body. The HTTP action endpoint spreads `body.metadata` onto the
dispatch, so `metadata` on a caller-addressed dispatch is attacker-controlled.
Without the gate, a caller could POST `{ metadata: { chat: { eventKey } } }` to
the public action endpoint and pivot resolution into an event handler — running
it with forged input and no transport authentication (no signature check, no
scheduler secret).

The gate closes that pivot for every caller-addressed surface at once. A forged
`metadata.chat` on an `http`-source dispatch is ignored, because the chat
branch only runs when `source === "chat"`, which only the chat adapter sets.

## Dispatched: `internal` and `task` entries

Beside the transport maps, a flow may declare two more entry maps, each nested
under `actions` so a per-type setting has a home beside them:

```ts
defineFlow({
  actions:  { ask: { block: ask } },                              // caller-addressed
  internal: { actions: { summarize: { block: summarize } } },     // reached by a dispatcher()
  task:     { actions: { implement: { block: implement } } },     // reached by a task-board seat
});
```

Every entry, of every type, shares `ActionCore` — including `concurrency`,
which moved from `ActionConfig` to the core so an `internal` or `task` entry
can carry its own policy. The flat spelling (`internal: { summarize }`) is
refused by name, and both maps are definition-only like the transport maps.

**Resolution is one `(type, name)` lookup, with no fallback for any type.**
`resolveEntry(flow, type, name, coordinate?)` (`core/flow/resolve-entry.ts`)
reads exactly one map — `flow.actions` for `public`, `flow.internal.actions`
for `internal`, `flow.task.actions` for `task`, and the transport maps by their
coordinate for `webhook` / `chat` / `schedule` — and returns `undefined` when
the name is not there. `resolveActionCore` delegates to `resolveEntry` for
every source, so the event branches no longer fall through to `flow.actions`
when their coordinate misses: an absent binding is a refusal, not a pivot into
a caller-addressed handler. `dispatchTypeOf(source)`
(`engine/transport-sources.ts`) maps a request source onto the type it
resolves as; the four framework-stamped sources each map to their own type,
and every caller-facing source maps to `public`.

A `task` dispatch carries the entry name as provenance only, and that name can
collide with a public `flow.actions` key. The one-map rule is what keeps the
collision harmless: nothing indexes a framework-stamped dispatch into
`flow.actions`, for resolution or for concurrency — the arbiter resolves the
entry's own policy through the same `(type, name)` lookup, so a hand-off never
inherits an unrelated action's `queue` / `reject` by name.

**The sender is a `dispatcher()` handler.** It builds the typed envelope from
its input, puts it through a factory-only seam (`DISPATCH_SEAM`, attached to
the block context by `createExecutionContext`, never a named member of
`BlockContext`), and returns `{ sessionId, requestId, adopted }`. Its address
(`type`, `target`) is fixed on the block, so `defineFlow` walks the flow graph
(`walkFlowGraph`, including a `forEach` factory's declared `blocks`) and
refuses a dispatcher whose target the flow does not declare. A `task`
dispatcher is a seat on a task board; the board binds its id and claim gate
onto it, and `defineFlow` puts the addressed entry behind that gate.

**Two session targets, two guards.** `{ key }` derives a child of the running
session (`deriveDispatchChildSessionId`, with the key framed under its own
`dispatch` namespace) and adopts it on the same key; the adoption check includes
the parent's lineage. `{ id }` delivers into an existing session of the same
flow kind and principal — an unknown id, another principal's, or another
tenant's is `session-not-found`; another flow's or a mismatched org is
`session-not-addressable` — and is refused under an external dispatcher
(`usesExternalDispatcher`, refusal `external-dispatcher`) because the run
would start on another process against a session this one cannot fence.
Acceptance happens at enqueue time; when the run starts, `runAction` re-reads
the session and **drops** the delivery if the session was deleted and
recreated in between (the incarnation guard), deleting the request row rather
than running a stale envelope against a new incarnation.

The dispatched request carries `source: "internal"` or `"task"` and a
server-assembled stamp, `metadata.dispatch = { type, target, from: { block,
sessionId }, key?, recipientLineageId?, ...provenance }`, read back through
`readDispatchStamp`, which is gated on those two sources exactly as the event
coordinates are gated on theirs. Neither source is re-enterable from a public
route: `isPublicReentryAllowed` is an allow-list (`http` / `mcp` / `chat` /
`scheduled`) that retry, continue and resume all route through; it never
admits `task` or `internal`, and `assertPublicReentrySources` refuses a host
that names them. Retry accepts a caller-supplied `inputOverride`, so
re-entering a dispatched request would feed a handler that was never
caller-addressed caller-chosen input. A deployment adds its **own**
transports' sources with the `publicReentrySources` host option, since
`InboundTransportAdapter.source` is an open string; it cannot add `webhook`,
`task` or `internal`, because the reason each is excluded is a property of the
framework rather than of the deployment.

Where the child runs, what `dispose()` waits for, and what recovers a child
its process abandoned is [Dispatched Work](./dispatched-work.md).

## The carried core: dynamic schedules

Three of the four event coordinates point at something declared statically on
the flow (`flow.webhooks`, `flow.chat.on`, `flow.schedules.static`). One does
not: a **dynamic** schedule's `ScheduleConfig` is produced by the resolver at
dispatch time and has no static coordinate.

For that one path, the adapter sets `resolvedActionCore?: ActionCore` on the
dispatch envelope (`InboundRequestEnvelope`). `runAction` prefers it over the
coordinate lookup. The field is set only by adapters, only for the dynamic
schedule.

## Recovery semantics per form

The carried core has a deliberate consequence. `resolvedActionCore` is **not
serialized and not persisted** on the `RequestRecord` — and a block can't be
serialized anyway. So:

| Form | Reachable on recovery via | Crash-recoverable when durable |
| --- | --- | --- |
| Caller-addressed action | `flow.actions[name]` | Yes |
| Webhook binding | `flow.webhooks[provider].on[event]` | Yes |
| Chat binding | `flow.chat.on[eventKey]` | Yes |
| Static schedule | `flow.schedules.static[id]` | Yes |
| Dynamic schedule | carried `resolvedActionCore` (transient) | **No** |

A durable dynamic schedule mid-run when the process crashes has no persisted
coordinate to re-resolve its handler from, so the run is dropped. This is the
honest tradeoff: a dynamic schedule's handler is chosen at dispatch time from
host-owned data, and the framework can't persist a block. If you need a durable
scheduled action to survive a crash, make it static — its handler is reachable
from a stable coordinate.

Persisted dynamic-schedule rows store a `kind` discriminator string (not a
block, which isn't serializable). The resolver maps `kind → block` through its
`blocks` map. The discriminator is enough to re-dispatch a fresh run on the
next tick; it is not enough to resume an in-flight durable run, which needs the
live core.

## Related

- [Inbound Transports](./inbound-transports.md) — the `InboundTransportAdapter`
  contract and the `InboundRequestEnvelope` these forms travel on.
- [Webhook Transport](./webhook-transport.md) — the first inline-core binding.
- [Chat Transport](./chat-transport.md) — chat binding form and mount-time
  index.
- [Scheduled Actions](./scheduled-actions.md) — static vs dynamic schedules and
  the carried-core path in full.
