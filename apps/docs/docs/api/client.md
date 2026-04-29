---
sidebar_position: 3
---

# Client API

`@flow-state-dev/client` — Isomorphic HTTP/SSE transport client.

No React or DOM dependency. The React package wraps this for transport.

## Action Clients

### `createClient(options)`

Create a dynamic action client.

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({
  flowKind: "my-app",
  userId: "devuser",
  baseUrl: "/api/flows",  // default
});

const { requestId } = await client.sendAction("chat", { message: "Hello!" });
await client.sendAction("chat", { message: "Hi!" }, { sessionId: "sess_1" });
```

### `createTypedClient(options)`

Create a type-safe action client bound to a flow definition.

```ts
import { createTypedClient } from "@flow-state-dev/client";

const client = createTypedClient({
  flow: myFlow,
  userId: "devuser",
});

await client.actions.chat({ message: "Hello!" });
```

## Session Client

### `createSessionClient(options?)`

Create a session management client.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api/flows" });

const list = await sessions.list();
const detail = await sessions.get(sessionId);
const snapshot = await sessions.getSessionState(sessionId, {
  includeItems: true,
  clientData: ["session.activePlan"],
});
await sessions.delete(sessionId);
```

## SSE Clients

### `createSSEClient(options)`

Create a request stream client.

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream`,
  onItemAdded: (event) => { /* new item */ },
  onItemUpdated: (event) => { /* item changed */ },
  onContentDelta: (event) => { /* text chunk */ },
  onRequestStatus: (event) => {
    if (event.status === "completed") { /* done */ }
  },
});
```

Supports resume via `Last-Event-ID` or `starting_after`.

### `createUserSSEClient(options)`

Create a user-scoped event stream client for cross-session notifications.

### `createRecoveryClient(options)`

Create a client for the request-recovery surface — sweep stale active-request entries and re-dispatch interrupted/failed requests.

```ts
import { createRecoveryClient } from "@flow-state-dev/client";

const recovery = createRecoveryClient({ baseUrl: "/api" });

// Sweep stale entries for one user; returns the requests this call
// transitioned from `in_progress` to `interrupted`.
await recovery.checkInterrupted({ userId: "user_1" });

// Re-dispatch a previously interrupted or failed request. Returns the
// new request id; subscribe to its stream as you would any new request.
const { newRequestId } = await recovery.retry({
  flowKind: "chat",
  sessionId: "sess_1",
  requestId: "req_1",
});
```

`retry` returns 409 from the server unless the original request's status is `interrupted` or `failed`.

## Error Handling

### `ClientHttpError`

Thrown on HTTP errors. Contains `status`, `statusText`, and `body`.

```ts
try {
  await client.sendAction("chat", { message: "Hello!" });
} catch (err) {
  if (err instanceof ClientHttpError) {
    console.error(err.status, err.body);
  }
}
```
