# Server and Client Integration

This document covers how the server, client, and React packages work together to deliver the full-stack framework experience.

## Package Responsibilities

### `@flow-state-dev/server`

Server-side runtime. Handles:
- Flow registration and discovery
- Action execution orchestration
- SSE streaming with resume support
- State persistence (filesystem + in-memory adapters)
- Retry/rescue/work execution semantics

### `@flow-state-dev/client`

Isomorphic HTTP client. Handles:
- Action invocation via HTTP
- SSE request-stream consumption
- Session management (create, list, load)
- Reconnection and resume logic

**No React or DOM dependency.** The React package wraps this for transport.

### `@flow-state-dev/react`

React UI layer. Handles:
- Hooks wrapping `@flow-state-dev/client`
- Reactive session-first state management
- Item rendering via registered components
- Context providers

**No transport logic.** All HTTP/SSE goes through `client`.

## Server Setup

### Flow Registration

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import flow from "./flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(flow);

const router = createFlowApiRouter({ registry });
```

### Next.js Catch-All Route

```ts
// app/api/flows/[...path]/route.ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";

const registry = createFlowRegistry();
// Register flows...

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

### Canonical Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/flows` | List registered flows |
| GET | `/api/flows/capabilities` | Feature flags |
| POST | `/api/flows/:kind/actions/:action` | Execute action (new session) |
| POST | `/api/flows/:kind/:sessionId/actions/:action` | Execute action (existing session) |
| GET | `/api/flows/:kind/requests/:requestId/stream` | SSE request stream |
| GET | `/api/flows/sessions` | List sessions |
| GET | `/api/flows/sessions/:sessionId` | Session detail |
| GET | `/api/flows/sessions/:sessionId/requests` | Session requests |
| GET | `/api/flows/sessions/:sessionId/state` | State snapshot |
| POST | `/api/flows/:kind/sessions` | Create session |
| DELETE | `/api/flows/sessions/:sessionId` | Delete session |

### Custom Model Resolution

```ts
import { createFlowApiRouter, createAiSdkModelResolver } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  modelResolver: createAiSdkModelResolver((modelId) => myModelProvider(modelId)),
});
```

### Store Configuration

```ts
import { createFlowApiRouter, createFilesystemStores, createInMemoryStores } from "@flow-state-dev/server";

// Production: filesystem (default)
const router = createFlowApiRouter({ registry });

// Testing: in-memory
const router = createFlowApiRouter({
  registry,
  stores: createInMemoryStores(),
});

// Optional runtime safeguards for long-lived servers
const guardedRouter = createFlowApiRouter({
  registry,
  maxResponseBufferSize: 10_000,
  maxConcurrentStreams: 1_000,
  staleStreamTtlMs: 300_000,
});
```

## Client Setup

### Action Client

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
});

// Untyped
await client.sendAction("chat", { message: "Hello!" });

// Typed (with schema)
const typedClient = createClient({
  flowKind: "hello-chat",
  userId: "devuser",
  actions: { chat: chatInputSchema },
});
await typedClient.actions.chat({ message: "Hello!" });
```

### Session Client

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api/flows" });

const list = await sessions.list();
const detail = await sessions.get(sessionId);
const snapshot = await sessions.getState(sessionId, {
  includeItems: true,
  offset: 0,
  limit: 100,
});
```

### SSE Stream Client

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/hello-chat/requests/${requestId}/stream`,
  onItemAdded: (event) => { /* handle new item */ },
  onContentDelta: (event) => { /* handle text chunk */ },
  onRequestStatus: (event) => {
    if (event.status === "completed") { /* refetch state */ }
  },
});
```

## React Setup

### FlowProvider

```tsx
import { FlowProvider } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider
      flowKind="hello-chat"
      userId="devuser"
      renderers={{
        message: MessageComponent,
        reasoning: ReasoningComponent,
        component: {
          "my-chart": ChartComponent,
        },
      }}
    >
      <ChatUI />
    </FlowProvider>
  );
}
```

### Hooks

**`useFlow`** — Session lifecycle management:

```tsx
const { sessions, activeSessionId, createSession, selectSession } = useFlow();
```

**`useSession`** — Primary hook for session data and actions:

```tsx
const { detail, items, isStreaming, sendAction, refresh } = useSession(sessionId);

await sendAction("chat", { message: "Hello!" });
```

**`useProjections`** — Scope-grouped projection subscriptions:

```tsx
const projections = useProjections(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});
// projections.session.activePlan, projections.user.preferences
```

**`useAction`** — Low-level action execution:

```tsx
const { execute, loading, error } = useAction({
  flowKind: "hello-chat",
  action: "chat",
  userId: "devuser",
});
```

**`useRequestStream`** — Direct stream access:

```tsx
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

### Rendering

```tsx
import { ItemRenderer, ItemsRenderer } from "@flow-state-dev/react";

// Render a list of items
<ItemsRenderer items={items} />

// Render a single item
<ItemRenderer item={item} />
```

The renderer resolves components from `FlowProvider`'s `renderers` prop:
- Class-based types (`message`, `reasoning`, etc.) → one component each
- Parameterized types (`component`, `container`) → sub-key lookup by `item.component`

## Action Execution Flow

```
Client                        Server
  │                             │
  ├─ POST /actions/chat ──────►│
  │   { input, userId }        ├─ validate input
  │                             ├─ create LiveRequestStream
  │◄── 202 { requestId } ──────┤
  │                             ├─ execute block (async)
  ├─ GET /requests/:id/stream ►│
  │◄── SSE events ─────────────┤ (item.added, content.delta, ...)
  │◄── request.completed ──────┤
  │                             │
  ├─ GET /sessions/:id/state ─►│
  │◄── snapshot response ──────┤ (state + projections)
```

**Phase 1 policy:**
- `userId` is required on every action request
- Framework examples use `userId: "devuser"` as local default
- POST returns `202 Accepted` immediately — execution is async
- Client can pre-generate `requestId` and pass it in the POST body

## Canonical Authority

For full type signatures, store interfaces, and rendering contracts, see `../preperation/architecture/SERVER_AND_CLIENT.md`.
