# Chat Transport Adapter

`@flow-state-dev/chat-sdk` wraps a Vercel Chat SDK bot into an
`InboundTransportAdapter` — the fourth concrete adapter after the built-in
HTTP adapter, `@flow-state-dev/mcp`, and `@flow-state-dev/scheduled`. See
[Inbound Transports](./inbound-transports.md) for the contract it conforms
to. The runtime below the adapter is identical to HTTP: `host.dispatch`
runs the action, and `RequestRecord.source = "chat"` carries provenance
through to DevTool.

The original adapter (FIX-638) wired routing at the adapter mount — the
host passed a single `route(event)` callback. FIX-667 moved the routing
surface onto the flow definition. FIX-838 finished the job: a chat binding
now carries the handler inline (the shared `ActionCore`) instead of naming an
entry in `flow.actions`, matching the webhook transport. The adapter-mount
`route()`/`flowKind`/`action` options are gone; chat is purely declarative
`on:`. See [Action forms](./action-forms.md) for the shared model across
webhook, chat, and scheduled.

## Config surface

A flow declares its chat subscriptions on `FlowDefinition.chat`:

```ts
chat?: {
  on?: Record<string, ChatEventBinding>;
  streamToThread?: boolean;
};

// A chat binding is an action in chat form: it extends the shared ActionCore
// (the handler `block` plus execution policy — `durable`, `tokenBudget`,
// `onCompleted`/`onErrored`, `inputSchema`, `userMessage`) with the event
// mapping. It lives on `flow.chat`, never `flow.actions`, so it is
// event-addressed and has no caller-addressed (HTTP/MCP) surface.
interface ChatEventBinding extends ActionCore {
  input: (event: unknown) => unknown | Promise<unknown>;
  sessionId?: (event: unknown) => string | Promise<string> | undefined;
  when?: (event: unknown) => boolean;
}
```

`ChatConfig` lives in `@flow-state-dev/core` (`packages/core/src/types/chat.ts`).
The `event` is typed `unknown` there because core cannot import the
chat-sdk's `ChatInboundEvent` without inverting the package dependency.
Chat-sdk users recover a typed event with `defineChatBinding<T>()`, which is
a passthrough cast at runtime.

Because the handler lives off `flow.actions`, the runtime resolves it from
`flow.chat.on[eventKey]` via the `metadata.chat.eventKey` coordinate the
adapter stamps (see `resolveActionCore` in `server`). The dispatched request
records the handler block's `name` as its action, for provenance only.

Each `on` key is matched against `ChatInboundEvent.kind` by exact string
equality. The SDK's event vocabulary (`mention`, `directMessage`,
`reaction`, `slashCommand`, …) is uniform across platforms, so a binding to
`mention` fires wherever the bot has a registered adapter. Keys outside the
vocabulary never match — raw GitHub PR lifecycle and similar events ride the
webhook transport instead.

## Registration-time validation

`validateChatConfig` runs inside `defineFlow`, alongside `validateMcpConfig`
and `validateSchedulesConfig`. It is a no-op when `chat` or `chat.on` is
absent or empty. Otherwise each binding is checked: `block` must be present
(the handler — a chat binding is an action, so a handler block is required);
`input` must be a function; `sessionId` and `when`, when present, must be
functions; event keys must be non-empty. Event-key spelling is *not*
validated against the SDK vocabulary (a typo simply never matches), because
hard-coding the vocabulary would pull a chat-sdk concern into core.

## Mount-time discovery

Chat events carry no flow kind in their payload, so the adapter cannot
resolve one flow per request the way MCP and Scheduled do (a
`host.registry.get(kind)` keyed by URL param). Instead it walks every
registered flow once, at mount, via the `start()` hook on
`TransportBindings`, and builds a subscription index grouped by event key
(`buildChatSubscriptionIndex`). This is the first non-trivial use of the
`start()` hook; documented here as a deliberate departure from the
per-request-lookup pattern of the sibling adapters.

`start()` runs synchronously. The router (`createFlowApiRouter`, which
`createFlowState` wraps) invokes it fire-and-forget, so only a synchronous
throw aborts startup. The adapter builds the index before any async work. The
index is a snapshot — frozen for the adapter's lifetime; hot reload of
subscriptions after mount is out of scope. An empty index is valid: with no
`chat.on` anywhere, every event is a no-op ack.

## Dispatch model

For an inbound event the adapter looks up the bucket for `event.kind`,
filters by each binding's `when` predicate, then dispatches. If any binding
matches, every matching binding fires — broadcast, each as an independent
`host.dispatch`. A binding's `input` and `sessionId` are awaited; a throwing
`input` skips only that binding, a throwing `when` is treated as no-match, and
a throwing `sessionId` falls back to the thread id. All three are logged. An
event with no matching binding is a no-op ack.

A dispatched request carries `metadata.chat = { eventKey, eventKind,
platform, threadId, channelId, messageId?, authorId?, isDM }`. The
`eventKey` is the matched `on` key and doubles as the resolution coordinate
(`resolveActionCore` reads `metadata.chat.eventKey`), so DevTool can answer
"why did this flow fire on this event?" without reading host source.

`streamToThread` resolves in precedence order: the flow's own
`chat.streamToThread`, then the adapter-mount `flowOverrides[kind]`, then the
adapter-level `streamToThread`, defaulting to `true`.

## Fan-out semantics

Broadcast, both within and across flows: every flow whose subscription
matches an event runs, independently — consistent with the industry default
(Inngest, GitHub Actions). First-match-wins would surprise authors. (Within
a single flow, the `on` map is keyed by event name, so at most one binding
per flow matches a given `event.kind`; broadcast within a flow is therefore
achieved by separate flows, not duplicate keys.)

## Relationship to other work

- **FIX-638 / FIX-667** — the predecessors. FIX-638 wired routing at the
  mount; FIX-667 moved it onto the flow. FIX-838 dropped the residual
  `route()`/`flowKind`/`action` mount options and moved the handler inline
  via `ActionCore`. The capability surface (`streamToThread`,
  `chatCapability`, the `chat.*` utility blocks, `flowOverrides`) is
  unchanged.
- **FIX-441** (cross-flow event bus) — adjacent. This is the inbound side
  (external chat events → flows); FIX-441 is the cross-flow side. Distinct
  primitives, no dependency.

## Related contracts

- [Action forms](./action-forms.md) — the shared `ActionCore` model and the
  `resolveActionCore` seam this transport resolves through.
- [Inbound Transports](./inbound-transports.md) — the adapter contract.
- [Scheduled Actions](./scheduled-actions.md), [MCP Server](./mcp-server.md)
  — sibling per-flow declarative transports.
