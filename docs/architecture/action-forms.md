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
  if (source === "webhook")   { /* read flow.webhooks[md.webhook.provider].on[md.webhook.eventType] */ }
  if (source === "chat")      { /* read flow.chat.on[md.chat.eventKey] */ }
  if (source === "scheduled") { /* read flow.schedules.static[md.schedule.scheduleId] */ }
  return flow.actions[actionName];   // caller-addressed fallback
}
```

Each event branch reads a **namespaced** coordinate from metadata —
`metadata.webhook` / `metadata.chat.eventKey` / `metadata.schedule.scheduleId`
— and looks the binding up on the matching transport map. When no event
coordinate resolves, it falls back to the named `flow.actions` entry. This is
the one seam that lets an event handler be a first-class action without ever
appearing in `flow.actions`.

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
