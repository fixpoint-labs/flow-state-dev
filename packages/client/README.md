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
// `baseUrl` is where the FlowState routes are mounted, minus the mount
// (`apiPath`, `/api/flows` by default), which the client adds. In a browser on
// the same origin with no base path, leave it off. In Node or another server
// runtime, pass an absolute URL, plus any base path:
//   createClient({ flowKind: "my-app", userId: "user_1", baseUrl: "http://localhost:3000" })
// `apiPath` is where the server mounts the flow API (default `/api/flows`). Set
// it when the server mounts it elsewhere, e.g. a Node host's `basePath`:
//   createClient({ ..., baseUrl: "http://localhost:3000", apiPath: "/flows" })
// Every client constructor accepts it.
// `flowKind` binds the client to one flow instance (a kind, or a collection
// member's own id). Sessions it starts are recorded as that instance's, and
// returned records carry `flowId`, the owner a retry or continuation re-enters.

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

// `url` is the full route, `/api/flows/...` included; the client only puts `baseUrl`
// (origin plus any base path) in front of it and appends nothing. In a browser on the same origin with no base path, omit `baseUrl`. In Node a relative
// path can't be fetched, so add baseUrl: "http://localhost:3000" (plus any base path).
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

## Stream state store

`createSSEClient` hands you raw event callbacks. If you want those events folded into a ready-to-render item list — sorted, with streaming text accumulated and resumed or crash-recovered duplicate emissions collapsed — without writing your own reducer, use the request stream store. It's the same accumulator the React hooks use, lifted out so non-React consumers (a Node script, a custom UI framework, the DevTool) can share one tested reducer.

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
      store.flushDeltas();        // apply buffered text deltas
      render(store.getSorted());  // your render / notify hook
    },
  }),
});
```

`bindStoreToCallbacks` is the shared reducer: it maps each SSE event to a store mutation and calls `onChange("item" | "content" | "status")` so you decide when to snapshot — synchronously, or batched on an animation frame for trace-heavy views. The store buffers content deltas, so call `store.flushDeltas()` before reading `getSorted()`. The same binder works with `createSSEClientFromResponse` when you already hold a streamed POST `Response`.

The store holds each item under `item.id` by default, which is unique within one request. To hold items from several requests, where two can save items with the same id, pass `keyOf`:

```ts
const store = createRequestStreamStore({
  keyOf: (item) => `${item.requestId}/${item.id}`,
});
```

Every store method that takes an item id then takes that key instead, and an item's key must not change over its life. `bindStoreToCallbacks` addresses items by their id, so pair it only with the default key.

If you're on React you don't need this — `useSession` and `useRequestStream` wrap the store for you.

## Session management

```ts
import { createSessionClient } from "@flow-state-dev/client";

// Browser, same origin, no base path: no `baseUrl`. In Node, pass an absolute
// URL such as { baseUrl: "http://localhost:3000" }, plus any base path.
const sessions = createSessionClient();

// State snapshot with clientData and items
const snapshot = await sessions.getSessionState("sess_1", {
  includeItems: true,
  clientData: ["session.artifactsList", "user.preferences"],
});
// `snapshot.at` is the server time the read began. Items come in pages
// (`pagination.hasMore`, `pagination.nextOffset`). To follow the session, read
// every page, starting each later page one item early (`nextOffset - 1`) and
// reading again from the first page if that item is not the last one you hold,
// or if the page's `sessionCreatedAt` differs from the first page's. Then pass
// the first page's `at` and `sessionCreatedAt` to `createSessionSSEClient`
// (`since`, `sessionCreatedAt`), so it follows the session you read.

// List a session's requests. A finished request carries `result`: `error` when
// it failed, and `hasOutput`. Pass `includeResultOutput` for the action's return
// value as `result.output`, and `includeItems` for each request's item log.
// `result` is absent while a request runs, on aborted or interrupted requests,
// and on history from a server that didn't save results: guard with `== null`.
const requests = await sessions.listSessionRequests("sess_1", {
  includeResultOutput: true,
  includeItems: true,
});
```

### Listing one flow's sessions

Where a flow's sessions are filed depends on how the flow was declared, so `sessionQueryFor` reads the flow list and builds the right filter:

```ts
import { createClient, sessionQueryFor } from "@flow-state-dev/client";

const userId = "user_42";
const flows = await createClient({ flowKind: "chat", userId }).listFlows();

// `sessions` is the session client created above.
const rows = await sessions.listSessions({
  ...sessionQueryFor("engineer-a", flows),
  userId,
});
```

A `cardinality: "collection"` flow has many addressable copies, so a copy's sessions are filed under its exact id. A `cardinality: "singleton"` flow is one instance whose address is its kind, so its sessions are filed under the kind. An address the flow list does not carry reads as a singleton.

You get back exactly one key: `{ flowId: address }` for a copy of a collection flow, `{ flowKind: address }` otherwise. Spread it into `listSessions` alongside whatever else you are filtering by.

### Dispatched runs

Work that outlives the turn that started it runs in a session of its own, so it
never appears in the requests of the session that started it.

`listSessions` with `include: "dispatch-runs"` returns those sessions beside the
flow's conversations:

```ts
const rows = await sessions.listSessions({
  flowKind: "research",
  include: "dispatch-runs",
});

// A row a dispatcher started names the session it was started from.
const runs = rows.filter((row) => row.parentSessionId != null);
```

Leave the option off and you get the sessions a person started. Rows belonging to
another principal, organization or tenant are absent either way.

### Sessions created with readonly state

A flow's session `stateSchema` can declare a field `.readonly()`: it is set when
the session is created and never changes. Pass it in the create's `state`, and
list sessions by it with `listSessions`'s `state` filter.

```ts
const fresh = await sessions.createSession({ flowKind: "agent", userId, state: { projectId: "q3-launch" } });
const mine = await sessions.listSessions({ flowKind: "agent", userId, state: { projectId: "q3-launch" } });
```

The filter needs `flowKind` or `flowId`, matches string values exactly, and is
refused for a field that isn't readonly on that flow. On a flow with a readonly
field or a create check, a create whose `state` doesn't match the schema rejects
with a 400 naming the field. A flow can also declare a
[`session.createCheck`](https://flow-state.dev/docs/fundamentals/state-and-scopes#creating-sessions)
for a rule that depends on the caller, such as whether the project is theirs; it
rejects with the server's status (400, 403 or 404) and message. Either way, no
session is written.

`listChildSessions` asks one session which dispatch runs were started from it.

```ts
// Paging only: `limit` is 1–100 (25 by default), `offset` is 0–10000.
const started = await sessions.listChildSessions("sess_1", { limit: 25 });

for (const run of started) {
  // A row's `id` is a session id, so the reads you already use work on it.
  const requests = await sessions.listSessionRequests(run.id);
}
```

Each row is a `ChildSessionSummary`: `id`, `parentSessionId`, `createdAt`,
`updatedAt`, and the optional `flowId`, `topic`, `coordinate`, and `status`. That is
the whole row — the server sends this named field set rather than a session record.
`flowId` is the instance that owns the run, the address to read it through when it
was dispatched into another instance. Absent on a row that records no owner.
`topic` is the key the run's session was derived from and `coordinate` the entry
it was dispatched to; both are display labels, nothing identifies or authorizes
from them, and a row can arrive without either. How legible `topic` is depends on
what the flow keyed on, so fall back to `id` rather than to a made-up name. Guard
all three with `== null`.

`status` is the last state the server recorded for the work, not a check on what is
happening right now. `"active"` asserts only that the work hasn't finished: queued,
mid-run, and paused waiting for a person all read `"active"`, and so does work whose
worker died, until the server records otherwise. The terminal values are
`"completed"`, `"failed"`, `"aborted"`, and `"incomplete"`. A row whose session has had
no run dispatched into it carries no `status` at all. Don't fold that absence into one of the
five values. Your own label for it, like `"Not started"`, is fine; mapping it to
`"active"` claims a run is pending when none has been dispatched.

A session that started nothing resolves to `[]`; an unknown session, or one the
caller isn't allowed to read, rejects with `ClientHttpError`. There is no counterpart
that starts one: whether work is dispatched at all is declared on the server when
the flow is wired up.

## `createClient` vs `createTypedClient`

| | `createClient` | `createTypedClient` |
|--|----------------|---------------------|
| Action calls | `sendAction("chat", input)` | `actions.chat(input)` |
| Type safety | Runtime only | Compile-time + runtime |
| Best for | Generic UIs, devtools | App code with known flow definitions |

## Recovery

```ts
import { createRecoveryClient } from "@flow-state-dev/client";

// Browser, same origin, no base path: no `baseUrl`. From Node, pass an absolute
// URL, plus any base path.
const recovery = createRecoveryClient();

// Sweep stale active-request entries for one user. Marks any in_progress
// records whose heartbeat went stale as `interrupted` and returns the
// transitioned ones. Long-running dev servers and serverless deployments
// (which disable startup detection) call this on demand — for example, on
// devtool mount and on session-list refresh. Only entries in the caller's
// tenant are swept. A call with no tenant id (the `x-tenant-id` header by
// default) sweeps only entries that have no tenant.
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
— the server returns 409 otherwise. `flowKind` here has to be the request's
recorded owner (`flowId` on the record); naming another instance is a 409
`wrong-instance-request`, and the result carries the owner as `flowId`.

```ts
// Continue a crash-interrupted request under its OWN id. Unlike `retry`,
// no new request is created: completed blocks replay from the durable log
// and the in-flight block re-runs, transitioning
// `interrupted -> in_progress -> terminal` in place. Returns the same id.
const { requestId } = await recovery.continue({
  flowKind: "chat",
  sessionId: "sess_1",
  requestId: "req_1",
});

// Streaming sibling of `continue`. POSTs to the same `/continue` route with
// Accept: text/event-stream so the server returns the continuation's SSE
// stream directly from the POST response, and returns the raw Response
// whose body is that stream — the inline-SSE counterpart to `continue()`,
// mirroring resumeSuspensionStream's approach so serverless deployments
// (no shared pub/sub) still see the continued run live.
const continued = await recovery.continueStream({
  flowKind: "chat",
  sessionId: "sess_1",
  requestId: "req_1",
});
```

```ts
// Resolve a pending suspension (approve/reject), streaming the continuation.
// resumeSuspensionStream POSTs with Accept: text/event-stream and returns the
// raw Response whose body is the resumed run's SSE stream — so the resuming
// client follows it live, even on serverless. Use createSSEClientFromResponse
// to consume it; the React layer wires this for you.
const response = await recovery.resumeSuspensionStream("chat", "req_1", {
  suspensionId: "susp_1",
  action: "approve",
});

// Non-streaming variant — fire-and-forget; returns once the resume is accepted.
const result = await recovery.resumeSuspension("chat", "req_1", {
  suspensionId: "susp_1",
  action: "approve",
});
```

`action` is one of `"approve" | "reject" | "submit" | "skip"`. `submit` carries a typed payload in `data` that the server validates against the suspension's `resumeSchema` (an invalid payload is a `400` with path-keyed `validationErrors`); `skip` declines an optional step and carries no payload; `approve`/`reject` are the binary outcomes. An action outside the suspension's `allow` set is a `409`.

## Public API

- `createClient(options)` — Dynamic action client
- `createTypedClient(options)` — Flow-bound typed client
- `createSessionClient(options)` — Session CRUD and state snapshots
- `createSSEClient(options)` — Request stream consumer
- `createSessionSSEClient(options)` — Whole-session stream: finished items from every request, and run changes
- `compareItemOrder(a, b)` — Display order for items from many requests (`ts`, `itemIndex`, `requestId`, then `id`); a session snapshot's items come in this order, so sort merged items with it
- `createUserSSEClient(options)` — User-level stream consumer
- `createRequestStreamStore({ keyOf? })` — Headless request-stream accumulator (sorted items, streaming text, status/sequence)
- `bindStoreToCallbacks(store, options?)` — Map SSE events onto a store (the shared reducer)
- `createRecoveryClient(options)` — Sweep stale requests and retry interrupted/failed ones
- `createResourceClient(options)` — Resource content fetch, CRUD, paginated state reads, and manifest
- `client.abortRequest(requestId)` — Signal the server to abort an in-progress request
- `sessionQueryFor(address, flows)` — Build the `listSessions` filter (`flowId` or `flowKind`) for one flow address
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
- [Client options](https://flow-state.dev/docs/configuration/client#choosing-baseurl) — `createClient` and `FlowProvider` options, including what to pass as `baseUrl` in the browser vs. Node, and [`apiPath`](https://flow-state.dev/docs/configuration/client#choosing-apipath) for a server mounted somewhere other than `/api/flows`
- [Streaming](https://flow-state.dev/docs/streaming/overview) — Item/content model, SSE protocol, resume semantics
