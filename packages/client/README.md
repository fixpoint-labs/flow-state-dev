# @flow-state-dev/client

**Connect to flows from anywhere. Actions, sessions, streaming — no framework lock-in on the client side.**

Works in Node, the browser, edge runtimes. No React dependency. No DOM dependency. Just HTTP and SSE.

## Installation

```bash
pnpm add @flow-state-dev/client
```

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({ flowKind: "my-app", userId: "user_1" });

// Send an action and get back a request ID
const { requestId } = await client.sendAction("chat", { message: "Hello" });

// Or use a typed client for compile-time action safety
const typed = createTypedClient({ flow: myFlowDefinition, userId: "user_1" });
await typed.actions.chat({ message: "Hello" });
```

## Streaming

Subscribe to a request's SSE stream with typed event handlers:

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream`,
  onItemAdded: (event) => {
    // New item appeared (message, reasoning, component, etc.)
  },
  onContentDelta: (event) => {
    // Text chunk arrived — append to the current item's content
  },
  onRequestStatus: (event) => {
    if (event.status === "completed") {
      // Refetch state snapshot for the authoritative final state
    }
  },
  // Optional sliding dedup window (defaults to 1000 recent events)
  dedupWindowSize: 1000
});
```

Resume after disconnect — pass a sequence cursor and the server replays missed events:

```ts
const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream?starting_after=${lastSeq}`,
  // ...handlers
});
```

## Session management

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api" });

// State snapshot with clientData and items
const snapshot = await sessions.getSessionState("sess_1", {
  includeItems: true,
  clientData: ["session.artifactsList", "user.preferences"],
});

// List a session's requests. Returns summaries only by default; pass
// `includeItems` to back-fill each request's item log — useful for inspecting
// requests that already completed (e.g. the DevTool's trace view).
const requests = await sessions.listSessionRequests("sess_1", {
  includeItems: true,
});
```

## `createClient` vs `createTypedClient`

| | `createClient` | `createTypedClient` |
|--|----------------|---------------------|
| Action calls | `sendAction("chat", input)` | `actions.chat(input)` |
| Type safety | Runtime only | Compile-time + runtime |
| Best for | Generic UIs, devtools | App code with known flow definitions |

## Recovery

```ts
import { createRecoveryClient } from "@flow-state-dev/client";

const recovery = createRecoveryClient({ baseUrl: "/api" });

// Sweep stale active-request entries for one user. Marks any in_progress
// records whose heartbeat went stale as `interrupted` and returns the
// transitioned ones. Long-running dev servers and serverless deployments
// (which disable startup detection) call this on demand — for example, on
// devtool mount and on session-list refresh.
const interrupted = await recovery.checkInterrupted({ userId: "user_1" });

// Re-dispatch a previously interrupted or failed request. The server creates
// a brand-new request that re-runs the original action with the same input.
const { newRequestId } = await recovery.retry({
  flowKind: "chat",
  sessionId: "sess_1",
  requestId: "req_1",
  // Optional: override the original input
  // inputOverride: { message: "try again" },
});
```

`retry` only succeeds for requests whose status is `interrupted` or `failed`
— the server returns 409 otherwise.

## Public API

- `createClient(options)` — Dynamic action client
- `createTypedClient(options)` — Flow-bound typed client
- `createSessionClient(options)` — Session CRUD and state snapshots
- `createSSEClient(options)` — Request stream consumer
- `createUserSSEClient(options)` — User-level stream consumer
- `createRecoveryClient(options)` — Sweep stale requests and retry interrupted/failed ones
- `createResourceClient(options)` — Resource content fetch, CRUD, paginated state reads, and manifest
- `client.abortRequest(requestId)` — Signal the server to abort an in-progress request
- `ClientHttpError` — Typed HTTP error class

### Resource client methods (collections)

- `listCollectionItems(sessionId, ref, { limit?, offset?, topicPrefix? })` → `CollectionListPage`
- `getCollectionItemState(sessionId, ref, topic)` → `CollectionItemState | null`
- `getResourceManifest(sessionId)` → `ResourceManifest`

The list/get-state methods require `client.state.read: true` on the collection. The manifest endpoint enumerates every public resource on the session's flow.

## Notes

- `userId` is required for Phase 1 action/session calls
- Stream resume supports both `Last-Event-ID` header and `starting_after` query param
- Request and user SSE clients use a bounded sliding-window event dedup cache (`dedupWindowSize`, default `1000`)
- When both are supplied, `starting_after` takes precedence

## Scripts

```bash
pnpm --filter @flow-state-dev/client build
pnpm --filter @flow-state-dev/client typecheck
pnpm --filter @flow-state-dev/client test
```

## Architecture reference

- [Client](https://flow-state.dev/docs/client/overview) — Routes, transport, React hooks contract
- [Streaming](https://flow-state.dev/docs/streaming/overview) — Item/content model, SSE protocol, resume semantics
