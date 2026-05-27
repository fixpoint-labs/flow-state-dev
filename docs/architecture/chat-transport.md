# Chat Transport Adapter

`@flow-state-dev/chat-sdk` wraps a Vercel Chat SDK bot into an
`InboundTransportAdapter` — the fourth concrete adapter after the built-in
HTTP adapter, `@flow-state-dev/mcp`, and `@flow-state-dev/scheduled`. See
[Inbound Transports](./inbound-transports.md) for the contract it conforms
to. The runtime below the adapter is identical to HTTP: `host.dispatch`
runs the action, and `RequestRecord.source = "chat"` carries provenance
through to DevTool.

The original adapter (FIX-638) wired routing at the adapter mount — the
host passed a single `route(event)` callback. FIX-667 moves the primary
routing surface onto the flow definition, matching the per-flow declarative
pattern MCP, Scheduled, and Webhooks already use.

## Config surface

A flow declares its chat subscriptions on `FlowDefinition.chat`:

```ts
chat?: {
  on?: Record<string, ChatEventBinding>;
  streamToThread?: boolean;
};

interface ChatEventBinding {
  action: string;
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

Each `on` key is matched against `ChatInboundEvent.kind` by exact string
equality. The SDK's event vocabulary (`mention`, `directMessage`,
`reaction`, `slashCommand`, …) is uniform across platforms, so a binding to
`mention` fires wherever the bot has a registered adapter. Keys outside the
vocabulary never match — raw GitHub PR lifecycle and similar events ride the
webhook transport instead.

## Registration-time validation

`validateChatConfig` runs inside `defineFlow`, alongside `validateMcpConfig`
and `validateSchedulesConfig`. It is a no-op when `chat` or `chat.on` is
absent or empty. Otherwise each binding is checked: `action` must be a key
in `flow.actions`; `input` must be a function; `sessionId` and `when`, when
present, must be functions; event keys must be non-empty. Event-key spelling
is *not* validated against the SDK vocabulary (a typo simply never matches),
because hard-coding the vocabulary would pull a chat-sdk concern into core.

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
throw aborts startup. The adapter
therefore builds the index and runs its fail-fast check (below) before any
async work. The index is a snapshot — frozen for the adapter's lifetime;
hot reload of subscriptions after mount is out of scope.

## Dispatch model

For an inbound event the adapter looks up the bucket for `event.kind`,
filters by each binding's `when` predicate, then:

1. **Flow-level subscriptions win.** If any binding matches, every matching
   binding fires — broadcast, each as an independent `host.dispatch`. A
   binding's `input` and `sessionId` are awaited; a throwing `input` skips
   only that binding, a throwing `when` is treated as no-match, and a
   throwing `sessionId` falls back to the thread id. All three are logged.
2. **Adapter-mount routing is the fallback.** Only when no flow-level
   binding matched does the adapter consult the FIX-638 `route()`/`flowKind`
   path. Precedence is total — `route()` is never called in addition to a
   matching subscription.

A request dispatched via a subscription stamps `metadata.subscriptionKey`
with the matched `on` key, so DevTool can answer "why did this flow fire on
this event?" without reading host source.

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

## Fail-fast on no routing

If no flow declares `chat.on` and the adapter mount sets neither `flowKind`
nor `route`, `start()` throws (`CHAT_ADAPTER_NO_ROUTING`) rather than
silently acking and dropping every event.

## Relationship to other work

- **FIX-638** — the predecessor. Its surface (`streamToThread`,
  `chatCapability`, the `chat.*` utility blocks, `route()`, `flowKind`,
  `flowOverrides`) keeps working unchanged; the declarative shape is
  additive.
- **FIX-441** (cross-flow event bus) — adjacent. This is the inbound side
  (external chat events → flows); FIX-441 is the cross-flow side. Distinct
  primitives, no dependency.

## Related contracts

- [Inbound Transports](./inbound-transports.md) — the adapter contract.
- [Scheduled Actions](./scheduled-actions.md), [MCP Server](./mcp-server.md)
  — sibling per-flow declarative transports.
