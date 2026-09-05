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
  // baseUrl: "https://api.example.com",  // only when the API is on another origin
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

const sessions = createSessionClient();

const list = await sessions.list();
const detail = await sessions.get(sessionId);
const snapshot = await sessions.getSessionState(sessionId, {
  includeItems: true,
  clientData: ["session.activePlan"],
});
await sessions.delete(sessionId);
```

### `sessions.listChildSessions(parentSessionId, options?)`

List the sessions started under one session. Work that outlives a turn runs in a session of its own hanging off the parent, so it doesn't appear in the parent's own requests.

```ts
const children = await sessions.listChildSessions("sess_1", {
  limit: 25,  // 1–100, defaults to 25
  offset: 0,  // 0–10000
});

// A row's `id` is a session id, so every session read works on it.
for (const child of children) {
  const requests = await sessions.listSessionRequests(child.id);
}
```

Each row is a `ChildSessionSummary`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | The child's own session id. |
| `parentSessionId` | `string` | The session this work hangs off. |
| `createdAt` / `updatedAt` | `number` | |
| `topic` | `string \| undefined` | Display label: the key the child was derived from. |
| `coordinate` | `string \| undefined` | Display label for the entry running it. |
| `status` | `ChildSessionStatus \| undefined` | Absent until the child has run something. |

The table is the whole row. The server sends this named field set rather than a session record, so there is no `flowKind`, `userId` or `title` on it.

`ChildSessionStatus` is `"active" | "completed" | "failed" | "incomplete" | "aborted"`. `active` asserts only that the work hasn't finished, covering queued, running, and paused waiting for a person alike. It's the last state the server recorded, not a liveness check. `topic` and `coordinate` are labels to display and nothing else — don't route or identify from them, and fall back to `id` rather than to a made-up name. Guard all three with `== null`.

A session that started nothing returns `[]`. An unknown session, or one the caller isn't allowed to read, throws `ClientHttpError`.

There is no counterpart that starts one. Whether work runs in a child session is declared by the flow on the server.

Full walkthrough: [Client > Overview](/docs/client/overview#child-sessions).

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

const recovery = createRecoveryClient();

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
