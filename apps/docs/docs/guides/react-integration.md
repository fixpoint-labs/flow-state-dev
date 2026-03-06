---
sidebar_position: 3
---

# React Integration

How to use flow-state.dev's React bindings to build interactive UIs.

## FlowProvider

Wrap your app (or a section of it) with `FlowProvider` to set defaults and register renderers:

```tsx
import { FlowProvider } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider
      flowKind="my-app"
      userId="devuser"
      renderers={{
        message: MessageComponent,
        reasoning: ReasoningComponent,
        component: {
          "chart": ChartComponent,
          "data-table": DataTableComponent,
        },
      }}
    >
      <MyUI />
    </FlowProvider>
  );
}
```

### Renderer Registry

Renderers map item types to React components:
- **Class-based types** (`message`, `reasoning`, etc.) — One component each
- **Parameterized types** (`component`, `container`) — Sub-key lookup by `item.component`

Nested providers merge renderers (child keys override parent keys).

## Hooks

### `useFlow` — Session Lifecycle

```tsx
const flow = useFlow({ autoCreateSession: true });

// Available:
flow.sessions;          // Session list
flow.activeSessionId;   // Current session ID
flow.createSession();   // Create new session
flow.selectSession(id); // Switch session
```

### `useSession` — Primary Hook

```tsx
const session = useSession(flow.activeSessionId, {
  items: { visibility: "ui" },
});

// Available:
session.detail;        // SessionDetail object
session.items;         // All items
session.messages;      // Message items only
session.blockOutputs;  // Block output items only
session.isStreaming;   // Active request in progress
session.isLoading;     // Initial load in progress
session.error;         // Error state

// Actions:
await session.sendAction("chat", { message: "Hello!" });
session.refresh();     // Force refetch
```

### `useClientData` — Client Data

```tsx
const clientData = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});

// Typed mode with schema validation:
const clientData = useClientData(session, {
  session: {
    activePlan: activePlanSchema,
  },
});
```

### `useAction` — Low-Level

For direct action execution without session management:

```tsx
const { execute, loading, error } = useAction({
  flowKind: "my-app",
  action: "chat",
  userId: "devuser",
});
```

### `useRequestStream` — Direct Stream Access

```tsx
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

## Rendering Items

### ItemRenderer and ItemsRenderer

```tsx
import { ItemRenderer, ItemsRenderer } from "@flow-state-dev/react";

// Render all items
<ItemsRenderer items={session.items} />

// Render a single item
<ItemRenderer item={item} />
```

### Custom Renderers

All custom renderers receive `{ item }` as their prop:

```tsx
import type { MessageItem } from "@flow-state-dev/core/items";

function ChatMessage({ item }: { item: MessageItem }) {
  return (
    <div className={item.role === "user" ? "user-msg" : "assistant-msg"}>
      {item.content.map((part, i) => (
        <span key={i}>{part.text}</span>
      ))}
    </div>
  );
}
```

### Suppressing Built-in Renderers

Pass `false` to suppress a type:

```tsx
const renderers = {
  status: false,      // Don't render status items
  reasoning: false,   // Don't render reasoning items
};
```

## Typical Pattern

```tsx
function ChatUI() {
  const flow = useFlow({ autoCreateSession: true });
  const session = useSession(flow.activeSessionId);

  return (
    <div>
      {/* Render items */}
      {session.items.map((item) => (
        <ItemRenderer key={item.id} item={item} />
      ))}

      {/* Input form */}
      <form onSubmit={(e) => {
        e.preventDefault();
        const msg = new FormData(e.currentTarget).get("message") as string;
        session.sendAction("chat", { message: msg });
        e.currentTarget.reset();
      }}>
        <input name="message" />
        <button disabled={session.isStreaming}>Send</button>
      </form>
    </div>
  );
}
```
