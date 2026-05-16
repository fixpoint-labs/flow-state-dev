# @flow-state-dev/react

**React hooks and renderers for Flow State Dev. Wire AI workflows to your UI in minutes.**

```tsx
import { FlowProvider, useFlow, useSession, ItemRenderer } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider flowKind="my-app" userId="user_1">
      <Chat />
    </FlowProvider>
  );
}

function Chat() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      {session.items.map(item => (
        <ItemRenderer key={item.id} item={item} />
      ))}
      <button
        onClick={() => session.sendAction("chat", { message: "Hello" })}
        disabled={session.isStreaming}
      >
        {session.isStreaming ? "Working..." : "Send"}
      </button>
    </div>
  );
}
```

That's a streaming chat UI. Items appear in real time as the LLM generates them. State syncs automatically. Reconnection is handled. No SSE wiring, no manual refetches.

## Install

```bash
pnpm add @flow-state-dev/react
```

Peer dependency: `react ^18.0.0 || ^19.0.0`

## How it works

`@flow-state-dev/react` wraps the [`@flow-state-dev/client`](../client) transport layer with React hooks. All network communication goes through the client — no transport logic lives in this package. This means:

- Hooks manage lifecycle and reactivity, not HTTP or SSE
- You can swap transport behavior by configuring the client
- The same flow definitions work across React, vanilla JS, and Node

## FlowProvider

Wrap your app (or a subtree) with `<FlowProvider>` to set defaults and register custom renderers:

```tsx
<FlowProvider
  flowKind="my-app"
  userId="user_1"
  renderers={{
    component: { "strategy-report": StrategyReportCard },
    message: CustomMessageBubble,
    status: false, // suppress status items in the UI
  }}
>
  <App />
</FlowProvider>
```

Props:
- `flowKind?: string` — Default flow kind for child hooks
- `sessionId?: string` — Default session ID
- `userId?: string` — Required for Phase 1
- `baseUrl?: string` — API base URL
- `renderers?: RendererRegistry` — Custom renderers keyed by item type or component key
- `children: ReactNode`

Nested providers merge `renderers` — child keys override parent keys.

## Hooks

### `useFlow(options?)`

Session lifecycle — list, create, and select sessions:

```ts
const flow = useFlow({ autoCreateSession: true });
// flow.activeSessionId, flow.sessions, flow.createSession(), flow.selectSession()
```

### `useSession(sessionId, options?)`

The primary hook. Gives you everything about a session — items, state, streaming status, and the ability to send actions:

```ts
const session = useSession(sessionId, {
  items: { visibility: "ui", includeTransient: false },
});
```

Returns:
- `detail` — Session metadata
- `snapshot` — Current state snapshot with clientData
- `latestRequest` — Most recent request on this session as a `SessionRequestSummary`, regardless of status. `null` until first fetch resolves. Refreshed on mount and on every terminal SSE event so consumers can render recovery affordances.
- `items`, `messages`, `blockOutputs`, `functionCalls` — Filtered item views
- `isLoading`, `isStreaming`, `error` — Status flags
- `statusMessage` — Request-scoped status slot mirror. Latest `emitStatus` value from the in-flight request (empty string when unset; resets on request termination). Pair with a streaming indicator to show "what's happening right now" with a "Working..." fallback.
- `sendAction(action, input)` — Trigger an action
- `abortRequest()` — Stop the in-flight request (signals the server to mark it `aborted`)
- `resumeLatestRequest()` — Re-dispatch `latestRequest` and attach to the new stream. No-op when there's no latest request, or when its status is anything other than `interrupted` or `failed` (the only states the server will retry). Useful for rendering a "Resume" button when a previous request was interrupted by a server crash, HMR reload, or network drop:

  ```tsx
  {session.latestRequest?.status === "interrupted" && !session.isStreaming && (
    <button onClick={() => session.resumeLatestRequest()}>Resume</button>
  )}
  ```
- `getOwnedItems(ownedBy)` — Items owned by a container scope (O(1) indexed lookup)
- `refresh()` — Manually refetch

### `useClientData(session, options)`

Read client data values from the session snapshot. Values update mid-stream as `state_change` items arrive on the SSE stream — components see `ctx.<scope>.patchState(...)` writes within the same paint, not only at request termination. This applies to `expose` keys; `derived` projections refresh once at terminal status.

```ts
const data = useClientData(session, {
  session: ["artifactsList", "modeStatus"],
  user: ["preferences"],
  org: ["sharedConfig"],
});

// Or with schemas for type inference:
const data = useClientData(session, {
  session: { artifactsList: artifactsListSchema },
});
```

### `useContainerItems(containerItem, source)`

Resolves owned items and component state for a container scope. Works with sequencers/routers that declare `container` config.

```ts
import { useContainerItems } from "@flow-state-dev/react";

function PlanRenderer({ item }: { item: ContainerItem }) {
  const { state, items } = useContainerItems<PlanState>(item, session);
  // state = latest plan snapshot from ComponentItem
  // items = all items emitted within this container's scope
}
```

`source` accepts either a `SessionView` (indexed O(1) lookups) or an `OutputItem[]` array.

### `useResourceCollection(session, ref)`

Underlying primitive for collection resources. Returns `list`, `get`, `query`, `actions`, `refetch`, `prefetched`, and `count`. Pages are cached per-instance and invalidated on observed `resource_change` items for the affected ref.

### `useResourceCollectionList(session, ref, { limit?, topicPrefix? })`

Convenience hook for paginated list views. Returns `items` (array of `CollectionItemHandle`), `pagination`, `isLoading`, `error`, `loadMore`, `refetch`. Surfaces the snapshot's `prefetched` window as the initial paint when set.

### `useResourceCollectionItem(session, ref, topic)`

Single-item lookup by topic. Returns `null` when not present.

### `useResourceManifest(session)`

Fetches the static manifest of public resources for the session's flow. Cached module-level by `flowKind` so all components share one fetch.

### `useAction(options)`

Low-level hook for direct action execution without session management.

### `useRequestStream(options)`

Low-level hook for subscribing to a request's SSE stream with reactive item/status views.

## Render helpers

`ItemRenderer` and `ItemsRenderer` handle the dispatch from item types to your registered renderers:

```tsx
// Single item
<ItemRenderer item={item} />

// List of items
<ItemsRenderer items={session.items} />
```

Custom renderers receive `{ item }` as their prop:

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatBubble({ item }: { item: MessageItem }) {
  return (
    <div className={item.role === "user" ? "user-bubble" : "assistant-bubble"}>
      {item.content[0]?.text}
    </div>
  );
}
```

Register renderers via `FlowProvider` or pass them directly to `ItemRenderer`.

### `<ModelBadge>`

Renders the `ModelIdentity` carried on any generator-emitted item or `block_trace` as a small pill. The `actual` model id is the visible label; the tooltip lists the requested string and gateway when present. Renders nothing when `model` is undefined, so it's safe to pass `item.model` directly from any item.

```tsx
import { ModelBadge } from "@flow-state-dev/react";
import type { MessageItem } from "@flow-state-dev/core/items";

function AssistantMessage({ item }: { item: MessageItem }) {
  return (
    <div>
      <ModelBadge model={item.model} />
      <div>{item.content[0]?.text}</div>
    </div>
  );
}
```

## Connection resilience

When the SSE connection drops mid-flight (network blip, tab background, server restart), `useSession` flips `session.isStuck` to `true` and exposes `session.dismissRequest()` so the user can clear the request without reloading.

```tsx
function ConnectionBanner() {
  const session = useSession(activeSessionId);
  if (!session.isStuck) return null;
  return (
    <div role="alert">
      <span>Connection lost.</span>
      <button onClick={() => session.dismissRequest()}>Dismiss</button>
    </div>
  );
}
```

The watchdog tracks the last SSE event or wire heartbeat; if the gap exceeds `stuckThresholdMs` (default 30_000 ms; should be ≥ 2× the server's `defaultSseHeartbeatMs`) while a request is in flight, `isStuck` flips. `dismissRequest()` works without a live SSE stream — it issues an out-of-band POST abort, injects a synthetic abort item into the local items log, and refreshes the latest snapshot.

```tsx
const session = useSession(sessionId, { stuckThresholdMs: 30_000 });
```

A user-triggered `sendAction` while `isStuck` is true auto-dismisses the prior request before opening the new stream, so the chat keeps moving. See [Connection Resilience](https://flow-state.dev/docs/server/connection-resilience) for the full layered defense (server heartbeat + sweeper + client watchdog).

## Scripts

```bash
pnpm --filter @flow-state-dev/react build
pnpm --filter @flow-state-dev/react typecheck
pnpm --filter @flow-state-dev/react test
```

## Architecture reference

- [Server and Client](../../docs/architecture/server-and-client.md) — React hooks contract, FlowProvider, rendering
- [Streaming](../../docs/architecture/streaming.md) — Item types, content model, transience
