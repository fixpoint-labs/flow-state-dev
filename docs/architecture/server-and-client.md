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

The registry indexes by exact instance id: a singleton by its kind, a collection member by its own id, and a collection's bare kind by nothing. See [flows-and-actions](./flows-and-actions.md#flowtype-and-flowinstance) for the declaration contract.

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
| POST | `/api/flows/:flowId/actions/:action` | Execute action (new session) |
| POST | `/api/flows/:flowId/:sessionId/actions/:action` | Execute action (existing session) |
| GET | `/api/flows/:flowId/requests/:requestId/stream` | SSE request stream |
| GET | `/api/flows/sessions` | List sessions (`flowKind` and exact `flowId` filters) |
| GET | `/api/flows/sessions/:sessionId` | Session detail |
| GET | `/api/flows/sessions/:sessionId/requests` | Session requests |
| GET | `/api/flows/sessions/:sessionId/state` | State snapshot |
| GET | `/api/flows/sessions/:sessionId/stream` | SSE session stream (every request's finished items, unfinished runs) |
| POST | `/api/flows/:flowId/sessions` | Create session |
| DELETE | `/api/flows/sessions/:sessionId` | Delete session |

`:flowId` is the instance id (a singleton's kind, a collection member's own id). Every session and request records its owner as `flowId` beside the definition's `flowKind`, and every response that projects a session or request (`GET /api/flows` entries also carry `cardinality`) includes `flowId`. Routes that name a flow and a record check the two agree before the resolver runs (`409 wrong-instance-session` / `wrong-instance-request`, or `409 migration-required` for an ownerless record under a collection kind); routes that name only a record resolve the governing flow — whose resolver authorizes the read, and which decides the anonymous-listing filter (`anonymousFlowIds`) — from the record's owner. Retry, continue, resume, and interrupted-request recovery re-enter the recorded owner. Clients bind an instance id in `flowKind` and re-enter through the `flowId` on the records they hold.

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
- A request is not evicted until its run has finished, `onFinished` included, and twice the live-tail liveness timeout (`LIVE_TAIL_LIVENESS_MS`, 30s by default, so 60s) has passed since. Its record turns terminal before its run finishes writing, and a live stream may still be following it; evicting it earlier frees a caller-supplied id while either is active. The run marks its record `finalizedAtMs` as its last write, after `.sideChain()` work its hooks queued has settled, and retention waits for that mark rather than for a length of time, because `onFinished` has no time limit and another process's run is invisible to this one. The mark is fenced on the record's `incarnation`, so it never lands on a request that took the id since. When two runs of one request overlap (a `/continue` started after the sweep took a slow but live run for dead), only the last of them to end in this process marks the record and removes the shared active-registry entry; an overlapping run in another process is judged by its heartbeat, as the sweep already does. A run that dies before marking it, or whose late writes failed to flush, or whose mark the store refused three times, is marked by the stale-request sweep, but only when the run was heartbeating through its tail (a completed run with heartbeats on): with heartbeats off (`request.heartbeatIntervalMs: 0`) a stale entry proves nothing, so such a record is marked only by its own run, and is kept for good if that run is gone. With the sweep disabled, such a request is kept too. **Rollout safety:** a record with no `finalizedAtMs` field at all was written by a version that never marks, and during a rolling deploy its run may still be finishing on an old instance. It is kept until the stale-request threshold (60s, or the host's `staleSweepThresholdMs` if longer) or `maxAge`, whichever is larger, plus the window, has passed since it completed. A request spared this way is evicted when the session's next request completes, so a session can sit above its limits until then. Its items still count toward `maxItems` while it waits, so older history is evicted to make room for them.
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

const list = await sessions.listSessions({ flowKind: "my-app" });
const detail = await sessions.getSession(sessionId);
const snapshot = await sessions.getSessionState(sessionId, {
  includeItems: true,
  offset: 0,
  limit: 100,
});
```

#### Background work (child sessions)

A child session is where work that outlives the turn runs. Reading one is
two hops: `listChildSessions` for the rows, then the shipped
`listSessionRequests` with a row's `id` for that work's own history. Whether
work runs in a child session is declared by the flow author — the client has
no way to request it.

```ts
// Same-origin: the client's paths are already absolute from the root.
const sessions = createSessionClient();

const children = await sessions.listChildSessions(parentSessionId, {
  limit: 25,
  offset: 0,
});

// One request for the whole list — the row carries what a list renders.
for (const child of children) {
  render(child.topic ?? child.id, child.status ?? null);
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
- **`topic` / `coordinate`** are display-only labels — the key the child was
  derived from, and the `<type>:<target>` entry it was dispatched to. They
  route, authorize and identify nothing, and are absent on any session that
  is not dispatched work.
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
  childSessions, childSessionsStale
} = useSession(sessionId);

await sendAction("chat", { message: "Hello!" });
// isFinishing: true when main chain is done but background .sideChain() tasks are still running.
// Use (isStreaming && !isFinishing) to block UI only during main chain execution.
```

**Background work (`childSessions`)** — a second axis beside `items`, carrying
the child sessions running under this session as `ChildSessionSummary` rows from
`client`. This layer re-exports the client's row type and names no field shapes
of its own; nothing is merged into `items`, and no transport shape is decided
here.

The axis is **interaction-scoped by default**. It is read on mount, at the
**start** of every work-starting call on the returned view (`sendAction`,
`resumeLatestRequest`, `resumeSuspension`, `continueRequest`), and by `refresh`
— which now covers this axis as well as the snapshot. There is deliberately no
polling: the launching turn's stream is request-scoped and closes when the turn
ends, while the work outlives it. The read is therefore anchored to a local
fact — this hook dispatched the interaction — so no board option, dropped
connection or `items: false` can remove it. The cost is one child-session read
per turn, independent of task-board activity.

A view that sets `live: true` also re-reads it on the session stream's
run-changed notice (`GET /sessions/:sessionId/stream`), through the same
guarded read, so the generation and sequence guards below cover both. The
notice names the unfinished runs, and the hook keeps any the page lacks, so an
unfinished run older than the page still shows.

Reads are guarded twice, because the two hazards are different. A **generation**
advances whenever the read identity changes — the session id or the session
client, which is rebuilt when `baseUrl` changes — and retires responses from a
superseded identity. A per-read **sequence** orders reads *within* one identity,
since the mount read, an action-start read and a manual `refresh()` share a
generation and can be in flight together; an older response is discarded rather
than allowed to overwrite newer rows or regress a terminal row to `active`.

A failed re-read keeps the last known rows and raises `childSessionsStale`,
cleared by the next success. Row status is rendered as received: this package
does not enumerate `ChildSessionStatus`, so an unrecognised value displays
without a change here.

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
