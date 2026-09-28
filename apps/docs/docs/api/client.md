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
// `flowKind` here is the flow instance the client is bound to. The returned
// request carries `flowId`, the instance that owns it, which is the address
// a retry or continuation goes back through.
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

const created = await sessions.createSession({ flowKind: "my-app", userId: "devuser", title: "Sprint planning" });
const list = await sessions.listSessions({ flowKind: "my-app" });
const detail = await sessions.getSession(created.id);
const snapshot = await sessions.getSessionState(created.id, {
  includeItems: true,
  clientData: ["session.activePlan"],
});
await sessions.updateSessionMetadata(created.id, { tags: ["planning"] });
await sessions.deleteSession(created.id);
```

`updateSessionMetadata` changes only the fields you pass. `title`, `description` and `tags` are each replaced whole, so the call above leaves the session with the one tag `planning`. `metadata` is merged key by key: the keys you send are written over the stored ones, and the rest stay. [Session management](/docs/client/overview#session-management) covers the errors it throws.

### `sessions.listSessions(options?)`

List a flow's sessions.

```ts
const conversations = await sessions.listSessions({ flowKind: "research" });

const withRuns = await sessions.listSessions({
  flowKind: "research",
  include: "dispatch-runs",
});
```

| Option | Type | Notes |
|--------|------|-------|
| `flowKind` | `string` | Every session of a flow kind. |
| `flowId` | `string` | One copy of a collection flow, by its exact id. |
| `userId` | `string` | Filter to one user. An authenticated caller always gets their own sessions only. |
| `limit` / `offset` | `number` | Paging. |
| `include` | `"dispatch-runs"` | Also return the sessions dispatchers ran work in. |

Without `include`, the response holds the sessions a person started. With it, a
row a dispatcher started carries `parentSessionId` — the session it was started
from — plus the `topic` and `coordinate` labels below. Rows belonging to another
principal, organization or tenant stay absent. Any other value answers `400`.

### `sessions.listChildSessions(parentSessionId, options?)`

List the dispatch runs started from one session. Work that outlives a turn runs in a session of its own, so it doesn't appear in the starting session's own requests.

```ts
const runs = await sessions.listChildSessions("sess_1", {
  limit: 25,  // 1–100, defaults to 25
  offset: 0,  // 0–10000
});

// A row's `id` is a session id, so every session read works on it.
for (const run of runs) {
  const requests = await sessions.listSessionRequests(run.id);
}
```

Each row is a `ChildSessionSummary`:

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | The run's own session id. |
| `parentSessionId` | `string` | The session this run was started from. |
| `createdAt` / `updatedAt` | `number` | |
| `topic` | `string \| undefined` | Display label: the key the run's session was derived from. |
| `coordinate` | `string \| undefined` | Display label for the entry running it. |
| `status` | `ChildSessionStatus \| undefined` | Absent until a run has been dispatched into the session. |
| `flowId` | `string \| undefined` | The flow instance that owns the run; the address to read it through. Absent on a row that records no owner. |

The table is the whole row. The server sends this named field set rather than a session record, so there is no `flowKind`, `userId` or `title` on it.

`ChildSessionStatus` is `"active" | "completed" | "failed" | "incomplete" | "aborted"`. `active` asserts only that the work hasn't finished, covering queued, running, and paused waiting for a person alike. It's the last state the server recorded, not a liveness check; [What `status` tells you](/docs/server/background-work#what-status-tells-you) has each value. `topic` and `coordinate` are labels to display and nothing else — don't route or identify from them, and fall back to `id` rather than to a made-up name. Guard all three with `== null`.

A session that started nothing returns `[]`. An unknown session, or one the caller isn't allowed to read, throws `ClientHttpError`.

There is no counterpart that starts one. Whether work is dispatched at all is declared by the flow on the server.

Full walkthrough: [Client > Overview](/docs/client/overview#dispatched-runs).

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

### `createSessionSSEClient(options)`

Opens one stream for a whole session: `GET /api/flows/sessions/:sessionId/stream`. It delivers each finished item from any request in the session, with the id of the request that kept it, and a notice naming the session's unfinished background runs whenever that set changes. Items the session snapshot hides are never sent.

To build a live view, read the whole session snapshot, then open the stream from its first page's `at`, the server time that read began. The pages hold everything saved before that time, and the stream picks up everything saved after. Pass the snapshot's `sessionCreatedAt` too, so the stream follows the session you read and not a later one that takes its id. The example calls `readHistory`, from [Reading a live session's history](#reading-a-live-sessions-history) below, to read every page without missing an item. `useSession` with `live: true` does all of this for you.

```ts
import {
  compareItemOrder,
  createSessionClient,
  createSessionSSEClient,
} from "@flow-state-dev/client";

const sessions = createSessionClient();
const history = await readHistory(); // see "Reading a live session's history"

// Keyed by request id and item id together: two requests can save items with the same id.
const items = new Map(history.items.map((item) => [`${item.requestId}:${item.id}`, item]));

const stream = createSessionSSEClient({
  sessionId,
  since: history.at, // the first page's `at`
  sessionCreatedAt: history.sessionCreatedAt,
  onItem: ({ requestId, item }) => {
    const key = `${requestId}:${item.id}`;
    const held = items.get(key);
    // A streamed item is finished. It replaces an in-progress copy, or a copy that sorts earlier.
    if (held === undefined || held.status === "in_progress" || compareItemOrder(item, held) >= 0) {
      items.set(key, item);
      render([...items.values()].sort(compareItemOrder));
    }
  },
  onRuns: ({ runs }) => showWorking(runs), // every unfinished run, each time the set changes
  onStop: ({ status }) => { /* refused, or the server has no session stream */ },
});

stream.close();
```

| Option | Notes |
|--------|-------|
| `since` | A server time (epoch ms) to start from: the snapshot's `at`, or `stream.lastAt` from an earlier connection. The stream starts a few seconds before it. Omitted, or when a snapshot comes back without `at`, it starts about a minute back. |
| `sessionCreatedAt` | The snapshot's `sessionCreatedAt`. Every connection, reconnects included, then follows that session only. Once its id holds another session, the reconnect is refused and the client stops: 404, or 403 if the app authenticates and another user or organization holds the id. Omitted, a reconnect follows whatever session holds the id, if the caller may read it. |
| `itemTypes` | Item types to send. Give it the same list as the snapshot's `itemTypes` so the stream sends what the snapshot shows. |
| `onReconnecting` | Called with `{ attempt }` each time the connection has dropped and the client is about to try again. `attempt` counts the tries since the stream last delivered an event. `1` is the first try after a drop, such as the server's own close. `2` or more means a try has failed, and what the stream last told you, such as which runs are unfinished, may be out of date until it delivers again. |
| `retry` | `{ initialDelayMs, maxDelayMs }`, the wait before each reconnect. The first wait is `initialDelayMs` (default `1000`), and each failed try doubles it, up to `maxDelayMs` (default `30000`). Once the stream delivers an event, the next drop starts again from `initialDelayMs`. |

The snapshot's items come in `compareItemOrder` order: `ts`, then `itemIndex`, then `requestId`, then `id`. The stream sends different requests' items in no set order, so sort anything you merge with the same comparator and a live view shows what a reload shows.

It reconnects with backoff, including when the server closes the connection after at most 15 minutes, and passes back the server time it last heard so the server resends what it might have missed. So the same copy of an item can arrive more than once, after a reconnect or when it was saved just before the snapshot's `at`. An item one request emits more than once under the same id, such as a keyed component, also arrives once per emission, each copy with its own `ts` and `itemIndex`. Holding items by request id and item id, keeping the copy that sorts later and letting a finished copy replace an in-progress one, as above, handles both. It stops, without retrying, when the server refuses the session or has no such route.

The server also ends the connection when the session is deleted or replaced by a new session under the same id. The client reconnects as usual. If the session is gone, the reconnect gets 404; if the app authenticates and another user or organization now holds the id, it gets 403. If the same owner created the session again, or the app doesn't authenticate, the reconnect gets 404 when you passed `sessionCreatedAt`, and otherwise follows the new session. A 403 or 404 stops the client through `onStop`, with no error.

#### Reading a live session's history

With `includeItems: true` the snapshot's items come oldest first, 100 to a page by default, and `pagination.hasMore` says another page follows. Each page is cut from the history as it stands when you ask, so if the history shifts partway through your read, as when a keyed component is emitted again or a request is removed, an item can fall between two pages. The stream won't send that item later, so check for it: ask for each later page one item early, at `pagination.nextOffset - 1`, and compare its first item with the last one you hold. If `compareItemOrder` says they differ, read again from the first page. Do the same when a later page's `sessionCreatedAt` differs from the first page's: the id was deleted and taken by a new session during the read. Give up after a few tries; this one throws after five.

```ts
async function readHistory() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const first = await sessions.getSessionState(sessionId, { includeItems: true });
    const held = [...(first.items ?? [])];
    let page = first;
    let whole = true;
    while (whole && page.pagination?.hasMore) {
      page = await sessions.getSessionState(sessionId, {
        includeItems: true,
        offset: page.pagination.nextOffset - 1, // start on the last item already held
      });
      const [overlap, ...rest] = page.items ?? [];
      const last = held[held.length - 1];
      whole =
        page.sessionCreatedAt === first.sessionCreatedAt && // still the same session
        overlap !== undefined &&
        last !== undefined &&
        compareItemOrder(overlap, last) === 0;
      held.push(...rest);
    }
    if (whole) return { at: first.at, sessionCreatedAt: first.sessionCreatedAt, items: held };
  }
  throw new Error(`Session ${sessionId} kept shifting while its history was read`);
}
```

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
// transitioned from `in_progress` to `interrupted`. Only entries in the
// caller's tenant are swept. A call with no tenant id (the `x-tenant-id`
// header by default) sweeps only entries that have no tenant.
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
- **404** — unknown `flowKind` (an instance id; a multi-copy flow's bare kind is unknown), `requestId`, or `suspensionId`. A request owned by another copy of the same flow answers `404` too, with the same body as one that does not exist
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
