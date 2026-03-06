---
sidebar_position: 4
---

# React API

`@flow-state-dev/react` — React hooks, renderers, and context providers.

Peer dependency: `react ^18.0.0 || ^19.0.0`

## FlowProvider

```tsx
import { FlowProvider } from "@flow-state-dev/react";

<FlowProvider
  flowKind="my-app"
  sessionId="optional-initial-session"
  userId="devuser"
  baseUrl="/api/flows"
  renderers={{
    message: MessageComponent,
    reasoning: ReasoningComponent,
    component: {
      "chart": ChartComponent,
    },
  }}
>
  {children}
</FlowProvider>
```

Nested providers merge `renderers` (child keys override parent keys).

## Hooks

### `useFlow(options?)`

Session lifecycle management.

```ts
const flow = useFlow({ autoCreateSession: true });

flow.sessions;           // SessionDetail[]
flow.activeSessionId;    // string | null
flow.createSession();    // Promise<string>
flow.selectSession(id);  // void
```

### `useSession(sessionId, options?)`

Primary hook for session data and actions.

```ts
const session = useSession(sessionId, {
  items: true,                              // default
  items: false,                             // skip items
  items: { visibility: "ui" },             // filter by visibility
  items: { includeTransient: false },       // exclude transient items
});

session.detail;        // SessionDetail | null
session.snapshot;      // SessionStateSnapshotResponse | null
session.items;         // OutputItem[]
session.messages;      // MessageItem[]
session.blockOutputs;  // BlockOutputItem[]
session.functionCalls; // FunctionCallItem[]
session.isLoading;     // boolean
session.isStreaming;    // boolean
session.error;         // Error | null

await session.sendAction("chat", { message: "Hello!" });
session.refresh();
```

### `useClientData(session, options)`

Read client data values from session state snapshot.

```ts
// String array mode — subscribe by name
const data = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});

// Schema mode — subscribe with type inference
const data = useClientData(session, {
  session: {
    activePlan: activePlanSchema,
  },
});
```

### `useAction(options)`

Low-level action execution.

```ts
const { execute, loading, error } = useAction({
  flowKind: "my-app",
  action: "chat",
  userId: "devuser",
});

await execute({ message: "Hello!" });
```

### `useRequestStream(options)`

Direct request-stream access.

```ts
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

## Renderers

### `ItemRenderer`

Render a single item using the registered renderer.

```tsx
import { ItemRenderer } from "@flow-state-dev/react";

<ItemRenderer item={item} />
```

### `ItemsRenderer`

Render a list of items.

```tsx
import { ItemsRenderer } from "@flow-state-dev/react";

<ItemsRenderer items={session.items} />
```

### Custom Renderers

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatMessage({ item }: { item: MessageItem }) {
  return <p>{item.role}: {item.content[0]?.text}</p>;
}

// Register in FlowProvider
<FlowProvider renderers={{ message: ChatMessage }}>

// Suppress a type
<FlowProvider renderers={{ status: false }}>
```

### `RendererRegistry`

Type for the renderers map:

```ts
type RendererRegistry = {
  message?: ComponentType<{ item: MessageItem }> | false;
  reasoning?: ComponentType<{ item: ReasoningItem }> | false;
  component?: Record<string, ComponentType<{ item: ComponentItem }>>;
  container?: Record<string, ComponentType<{ item: ContainerItem }>>;
  // ... other item types
};
```
