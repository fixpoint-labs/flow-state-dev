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
        {session.isStreaming ? "Thinking..." : "Send"}
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
- `items`, `messages`, `blockOutputs`, `functionCalls` — Filtered item views
- `isLoading`, `isStreaming`, `error` — Status flags
- `statusMessage` — Request-scoped status slot mirror. Latest `emitStatus` value from the in-flight request (empty string when unset; resets on request termination). Pair with a streaming indicator to show "what's happening right now" with a "Thinking..." fallback.
- `sendAction(action, input)` — Trigger an action
- `getOwnedItems(ownedBy)` — Items owned by a container scope (O(1) indexed lookup)
- `refresh()` — Manually refetch

### `useClientData(session, options)`

Read client data values from the session snapshot:

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

## Scripts

```bash
pnpm --filter @flow-state-dev/react build
pnpm --filter @flow-state-dev/react typecheck
pnpm --filter @flow-state-dev/react test
```

## Architecture reference

- [Server and Client](../../docs/architecture/server-and-client.md) — React hooks contract, FlowProvider, rendering
- [Streaming](../../docs/architecture/streaming.md) — Item types, content model, transience
