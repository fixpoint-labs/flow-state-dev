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

## Three address forms

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
  if (source === "workstream") { return flow.workstream; }   // TERMINAL — no fallback
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

## Detached: the workstream core

A running request can start another request from inside a block, through the
runtime seam on `BlockContext`. That dispatch is stamped `source: "workstream"`
by the seam — not by any caller — and resolves one pre-assembled entry,
`flow.workstream`.

It is `undefined` until something populates it, and that *off* state is a normal
state rather than a gap: a flow with no workstream core refuses detached dispatch
by name.

**The branch is terminal, and that is the security property.** Note the shape
difference above: an event branch falls through when its coordinate does not
match, because an event whose binding is missing should still be able to resolve
a named action. The detached branch returns unconditionally. A detached dispatch
carries `actionName` as provenance only, and that name can collide with a public
`flow.actions` key — so falling through would hand a framework-stamped dispatch a
caller-addressed handler. Because the seam stamps its own source, that is not a
caller forging anything; it is the runtime admitting everything through its own
trusted source. There is no route from the seam to a caller-addressed action.

Two neighbouring paths classify the source with the event forms for the same
reason:

- **Concurrency.** The arbiter takes the flow default rather than reading
  `flow.actions[actionName]?.concurrency`, so detached work does not inherit an
  unrelated action's `queue`/`reject` policy by name collision.
- **Public re-entry.** `isPublicReentryAllowed(source)` is an allow-list
  (`http` / `mcp` / `chat` / `scheduled`); retry, continue and resume all route
  through it. A detached request is not re-enterable from a public surface —
  retry accepts a caller-supplied `inputOverride`, so re-entry would feed a
  detached handler caller-chosen input. The allow-list replaced three per-route
  webhook deny-lists, which admitted every source nobody thought to name.

  A deployment adds its **own** transports' sources with the
  `publicReentrySources` host option, since `InboundTransportAdapter.source` is
  an open string and the framework cannot enumerate them. It cannot add these
  three: `webhook`, the detached source and the relay source are stamped by the
  framework and are refused at router construction, because the reason each is
  excluded is a property of the framework rather than of the deployment.

## Message-addressed: the relay door

A running request can also address a session that already exists — a peer, not a
descendant — through `ctx.requestHost.sendMessage`. That dispatch is stamped
`source: "relay"` by the seam, and it is the fourth thing `resolveActionCore`
knows about.

**Relay is the one form with two doors**, and which one a message enters is
decided at the *send*, never here:

- a **declared** binding, `flow.relay.on[kind]`, which is an action in message
  form exactly as a webhook binding is an action in transport form — it carries
  its `ActionCore` inline plus an `input` mapper, and never appears in
  `flow.actions`;
- a **fallthrough** to `flow.actions[kind]`, which is gated.

The gate reads a persisted discriminator, `SessionRecord.sessionKind`, at **both
ends** of the send. A declared binding is reachable whatever those are. The
fallthrough requires both the recipient *and the sender* to be
`"top-level"`/`"sibling"`, so a detached background session neither exposes its
public actions to a message nor reaches a peer's — two properties that read alike
and are not the same, since closing only the first still lets a confined agent
reach outward. An **absent** kind at either end refuses before any door is
resolved: a record written before the field existed is a record the framework
cannot classify, and the tolerant reading is the exploitable one.

**The branch here is terminal, like the detached one, but for a slightly
different reason: the door's answer is a stamp rather than a computation.**
Resolution runs before the recipient's session record is loaded, and the sender's
session kind never crosses the dispatch boundary at all — so the send writes its
answer onto `metadata.relay.door` and the worker routes on that. `metadata` is
the caller's own bag, so the stamp is authority **only** behind the same source
gate every event coordinate sits behind.

The same three neighbouring paths classify relay:

- **Concurrency.** Policy follows the *door form*: a declared binding takes the
  flow default, exactly as an event or a detached dispatch does, because its
  `actionName` is provenance and could collide with an unrelated public action; a
  fallthrough is that action addressed as itself, so its own override applies.
  Admission is unbounded — a queued delivery waits rather than being dropped,
  since nobody is holding a connection at the other end.
- **Public re-entry.** Not re-enterable, on the never-list rather than merely
  absent from the allow-list, for the criterion already written for the detached
  source: no caller-facing entry, therefore no caller-facing re-entry.
- **Suspension.** A `RELAY_SOURCE` request is refused at `ctx.suspend()`. The
  door additionally refuses a `durable` fallthrough target and `defineFlow`
  refuses a binding declaring `durable: true`, but those are the early, nameable
  cases: `ctx.suspend()` is gated on the host's `DurabilityProvider` and never
  reads the action's flag, so an undeclared suspension is invisible to both.

### Where the workstream core comes from: the binding registry

`flow.workstream` is one entry, but the work behind it is heterogeneous — a flow
may host several task boards, each with several detached workers. The map that
holds them is `flow.workstreamBindings`, keyed by `(boardId, coordinateKey)`.

It is produced **by construction, not by declaration**. A board stamps its
bindings on its drain sequencer; every block retains the blocks it composes
(`BlockDefinition.childBlocks`), and derives its own binding set from its stamp
plus its children's. Each child already carries the union of its subtree, so one
merge per block carries the whole tree up to the action root, where `defineFlow`
reads it off. There is no author-facing surface — an app declares a board, and
the registry follows.

`defineFlow` then walks that same retained graph and **refuses a flow that can
reach a board it cannot route to**, naming the board, coordinate and worker. The
walk exists because the two halves can disagree only one way: some composition
step dropped a child on the way up. Without it that failure is invisible until a
detached task has been admitted, claimed, dispatched, and then never runs. The
walk is possible at all only because children are retained — a sequencer step is
a closure, so before retention the sequencer edge was opaque, and a board's drain
*is* a sequencer.

Two properties are load-bearing:

- **Addressing is strings only.** A binding is `(boardId, coordinateKey) →
  block`, so a wake that arrives carrying nothing but a durable task row can
  still find the block that runs it. This is what makes detached routing survive
  a restart, and why the coordinate is a tagged `assignee`/`uniform`/`floor`
  value rather than a bare name — a board may legally name an assignee `uniform`.
- **The registry is not a dispatch-time lookup table.** Resolution for the
  detached source is terminal on `flow.workstream` alone; nothing indexes this
  map by a coordinate carried on an envelope. The coordinate on a dispatch
  matters only *upstream*, where it feeds the child-session derivation, and the
  worker a request actually runs is selected from the durable task row instead
  (BP-031). Routing over the bindings therefore happens at one convergence point
  inside the assembled core, not once per binding.

One coordinate carrying two separate board declarations is refused when the flow
is defined, whether or not the two name the same worker block. It cannot be
resolved by picking one: a dispatch names only the coordinate, so the loser's
tasks would run against the wrong board with no error anywhere, and flow
definition is the last point where both declarations are visible.

Sharing a worker block between boards is fine — that is ordinary composition, and
what is refused is the shared coordinate, not the shared block. One board reached
from several places is a duplicate rather than a conflict, and deduplicates
silently.

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
