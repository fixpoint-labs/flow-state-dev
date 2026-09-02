# Server and Client Integration

This document covers how the server, client, and React packages work together to deliver the full-stack framework experience.

## Package Responsibilities

### `@flow-state-dev/engine`

Server-side runtime. Handles:
- Flow registration and discovery
- Action execution orchestration
- SSE streaming with resume support
- State persistence (in-memory, filesystem, SQLite, and Postgres adapters)
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
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";
import flow from "./flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(flow);

const router = createFlowApiRouter({ registry });
```

### Next.js Catch-All Route

```ts
// app/api/flows/[...path]/route.ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
// Register flows...

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

### Canonical Endpoints

The route table below is produced by the built-in HTTP transport adapter
(`createHttpTransportAdapter`), which `createFlowApiRouter` mounts onto an
`InboundTransportHost` internally. Custom transports (MCP, webhook, scheduled,
custom) mount alongside it via the `adapters` option — see
[`docs/architecture/inbound-transports.md`](./inbound-transports.md).

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
import { createFlowApiRouter } from "@flow-state-dev/engine";
import { createModelResolver } from "@flow-state-dev/core/models";

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
});
```

### Store Configuration

```ts
import { createFlowApiRouter, createFilesystemStores, createInMemoryStores } from "@flow-state-dev/engine";

// Default when no `stores` is passed: in-memory (dev/test only).
// For production use SQLite (single server) or Postgres (multi-instance);
// the filesystem store is for local development, not production load.
const router = createFlowApiRouter({ registry });

// Testing: in-memory
const router = createFlowApiRouter({
  registry,
  stores: createInMemoryStores(),
});

// Optional runtime safeguard for long-lived servers
const guardedRouter = createFlowApiRouter({
  registry,
  maxResponseBufferSize: 10_000,
});
```

### Session Retention Policies

Retention policies bound the size of a session's persisted item log. Configured on the flow's `session` block, they evict old completed request records when limits are exceeded.

```ts
defineFlow({
  kind: "my-flow",
  session: {
    retention: {
      maxItems: 500,  // total items across all completed requests
      maxAge: "24h",  // duration string or milliseconds
    },
  },
  actions: { /* ... */ },
});
```

- Both `maxItems` and `maxAge` are optional. When both are set, either triggers eviction.
- Eviction is lazy (runs after each completed request). No background process.
- Operates at **request granularity** — entire old requests are removed, not individual items.
- The current request is never evicted. Failed requests are not eviction candidates.
- For items that should never be stored, use `transient: true` on block definitions instead.

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

#### Background work (child sessions)

A child session is a child session that outlives the turn that started it. Reading
one is two hops: `listChildSessions` for the rows, then the shipped
`listSessionRequests` with a row's `id` for that work's own history. Detachment
is declared by the flow author — the client has no way to request it.

```ts
// Same-origin: the client's paths are already absolute from the root.
const sessions = createSessionClient();

const children = await sessions.listChildSessions(parentSessionId, {
  limit: 25,
  offset: 0,
});

// One request for the whole list — the row carries what a list renders.
for (const ws of children) {
  render(ws.topic ?? ws.id, ws.status ?? null);
}
```

`ChildSessionSummary` is `{ id, parentSessionId, createdAt, updatedAt, topic?,
coordinate?, status? }` — a named field set, not a `SessionSummary`.

- **`status`** is `"active" | "completed" | "incomplete" | "failed" | "aborted"`,
  and is **absent** when the child session has not run anything yet. `"active"`
  means *not finished* and nothing more: it does not separate running from
  queued from paused waiting for a person, and it is the last state the server
  recorded rather than a liveness check. It is its own `ChildSessionStatus`
  union rather than `RequestStatus` — that union's run states
  (`"in_progress"`, `"suspended"`, `"interrupted"`) collapse into `"active"`
  and can never appear here, so reusing it would hand consumers an exhaustive
  switch over branches that cannot fire. A finer breakdown arrives later as a
  separate optional field, never as new members of this union.
- **`topic` / `coordinate`** are display-only labels. They route, authorize and
  identify nothing, and are absent on any session that is not background work.
- Every optional field is `== null`-guarded by consumers (BP-030).

The client's one piece of filtering is a compatibility check: a row whose
`parentSessionId` does not match the requested parent is dropped rather than
relabelled as that conversation's background work. Authorization is the
server's, resolved from the stored parent record (BP-031).

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
const {
  detail, items, isStreaming, isFinishing, sendAction, refresh,
  children, childrenStale
} = useSession(sessionId);

await sendAction("chat", { message: "Hello!" });
// isFinishing: true when main chain is done but background .sideChain() tasks are still running.
// Use (isStreaming && !isFinishing) to block UI only during main chain execution.
```

**Background work (`children`)** — a second axis beside `items`, carrying the
child sessions running under this session as `ChildSessionSummary` rows from
`client`. This layer re-exports the client's row type and names no field shapes
of its own; nothing is merged into `items`, and no transport shape is decided
here.

The axis is **interaction-scoped, not live**. It is read on mount, at the
**start** of every work-starting call on the returned view (`sendAction`,
`resumeLatestRequest`, `resumeSuspension`, `continueRequest`), and by `refresh`
— which now covers this axis as well as the snapshot. There is deliberately no
polling and no stream-driven refresh: the launching turn's stream is
request-scoped and closes when the turn ends, while the work outlives it, and
there is no session-level channel to fall back on (`/users/:userId/stream`
returns 501). The read is therefore anchored to a local fact — this hook
dispatched the interaction — so no board option, dropped connection or
`items: false` can remove it. The cost is one child session read per turn,
independent of task-board activity.

Reads are guarded twice, because the two hazards are different. A **generation**
advances whenever the read identity changes — the session id or the session
client, which is rebuilt when `baseUrl` changes — and retires responses from a
superseded identity. A per-read **sequence** orders reads *within* one identity,
since the mount read, an action-start read and a manual `refresh()` share a
generation and can be in flight together; an older response is discarded rather
than allowed to overwrite newer rows or regress a terminal row to `active`.

A failed re-read keeps the last known rows and raises `childrenStale`,
cleared by the next success. Row status is rendered as received: this package
does not enumerate `ChildSessionStatus`, so an unrecognised value displays without
a change here.

**`useClientData`** — Scope-grouped client data subscriptions:

```tsx
const clientData = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});
// clientData.session?.activePlan, clientData.user?.preferences
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
  │◄── snapshot response ──────┤ (state + clientData)
```

**Phase 1 policy:**
- `userId` is required on every action request
- Framework examples use `userId: "devuser"` as local default
- POST returns `202 Accepted` immediately — execution is async
- Client can pre-generate `requestId` and pass it in the POST body

## Canonical Authority

This document is authoritative for server and client contracts. For full type signatures, store interfaces, and rendering contracts, refer to the published types in `@flow-state-dev/engine`, `@flow-state-dev/client`, and `@flow-state-dev/react`.
