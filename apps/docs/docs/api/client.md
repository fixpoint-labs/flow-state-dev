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

### `createRequestStreamStore()` and `bindStoreToCallbacks(store, options?)`

Accumulate a request's SSE events into a sorted, canonical item view outside React. `createRequestStreamStore()` returns a `RequestStreamStore`; `bindStoreToCallbacks` adapts it to the `RequestSSECallbacks` shape so you can spread it into `createSSEClient` or `createSSEClientFromResponse`.

```ts
import {
  createRequestStreamStore,
  bindStoreToCallbacks,
  createSSEClient,
} from "@flow-state-dev/client";

const store = createRequestStreamStore();

createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream`,
  ...bindStoreToCallbacks(store, {
    onChange: () => {
      store.flushDeltas();
      render(store.getSorted());
    },
  }),
});
```

`bindStoreToCallbacks` buffers content deltas, so call `store.flushDeltas()` before reading `getSorted()`. `onChange(kind)` receives `"item" | "content" | "status"` so a consumer can flush at different rates per kind, and an optional `itemFilter` gates which items reach the store. The store also tracks `status`, `lastSequenceNumber`, and the `statusEvents` log. This is the same reducer the React `useSession` / `useRequestStream` hooks wrap — reach for it directly only in non-React consumers.

### `createUserSSEClient(options)`

Create a user-scoped event stream client for cross-session notifications.

### `createRecoveryClient(options)`

Create a client for the request-recovery surface — sweep stale active-request entries, re-dispatch interrupted/failed requests, and resume suspended flows.

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

// Resolve a pending suspension.
const result = await recovery.resumeSuspension("chat", "req_1", {
  suspensionId: "susp_abc",
  action: "approve",            // "approve" | "reject" | "submit" | "skip"
  data: { approved: true },     // payload for submit/approve; ctx.suspend() returns it
  resumedBy: "user_xyz",        // optional; stored on the audit record
});
// result.requestId — the request id that will continue (same as the input requestId)

// Stream the resume: get the continuation's SSE stream from the POST response.
const response = await recovery.resumeSuspensionStream("chat", "req_1", {
  suspensionId: "susp_abc",
  action: "approve",
});
if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
  // Consume response.body as the continuation's event stream (see createSSEClientFromResponse).
}
```

`resumeSuspensionStream` POSTs with `Accept: text/event-stream` and returns the raw `Response` whose body is the resumed run's SSE stream — the continuation runs on the same instance that handled the POST, so the resuming client follows it live even on serverless (no shared pub/sub). Falls back to a `202` JSON response when the server doesn't stream; branch on the `content-type` header. The React layer (`useSession().resumeSuspension`, `useSuspensions`) wires this for you.

`retry` returns 409 from the server unless the original request's status is `interrupted` or `failed`.

`action` is one of `"approve" | "reject" | "submit" | "skip"`. `submit` carries a typed payload in `data` that the server validates against the suspension's `resumeSchema`; `skip` declines an optional step and carries no payload; `approve` / `reject` are the binary outcomes. The server returns `409` for an action outside the suspension's `allow` set.

`resumeSuspension` error codes:
- **400** — missing or invalid `action`, a `data` payload that fails `resumeSchema` validation (path-keyed `validationErrors` in the body), or no durability provider configured
- **404** — unknown `flowKind`, `requestId`, or `suspensionId`
- **409** — request is not currently suspended, or this suspension is already resolved, or a concurrent resume is in progress
- **410** — the suspension has expired (`timeoutMs` elapsed)

All failures throw `ClientHttpError` with a `.status` property.

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
