---
sidebar_position: 3
---

# Client API

`@flow-state-dev/client` is the HTTP and SSE client for a flow-state-dev server. It has no React or DOM dependency, so it runs in Node, the browser and edge runtimes. The React package builds on it.

For a walkthrough, see [Client > Overview](/docs/client/overview). This page is the reference.

## `createClient(options)`

`createClient` builds a client for one user and one server. Every call it makes acts as that user and goes through one transport.

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({
  userId: "user_1",
  baseUrl: "http://localhost:3000",
});
```

| Option | Type | Notes |
|--------|------|-------|
| `userId` | `string` | Required. The user every call acts as. With sign-in on, the server trusts the request's credentials over this value. |
| `baseUrl` | `string` | Where the flow routes are mounted, minus the mount: the origin plus any base path. `""` is the page's own origin. Required unless you pass a `fetcher`; with a `fetcher` and no `baseUrl`, requests go to relative paths, which a browser sends to the page's own origin. See [Choosing `baseUrl`](/docs/configuration/client#choosing-baseurl). |
| `apiPath` | `string` | Where the server mounts the flow API, after `baseUrl`. Default `"/api/flows"`. See [Choosing `apiPath`](/docs/configuration/client#choosing-apipath). |
| `fetcher` | `ClientFetch` | The `fetch` every call and stream goes through. Default: the global `fetch`. Pass a wrapper that adds credentials, or the engine's [`createInProcessFetch`](/docs/server/host-adapters#calling-flows-in-the-same-process) to reach an engine in the same process. |

It returns a `Client`:

| Member | What it does |
|--------|--------------|
| `userId` | The user every call acts as. |
| `flow(address)` | One flow. See [`fsd.flow`](#fsdflowaddress). |
| `sessions` | Session reads and edits. See [`fsd.sessions`](#fsdsessions). |
| `resources` | Resource content and collections. See [`fsd.resources`](#fsdresources). |
| `requests.interrupted(options?)` | The user's crash-interrupted requests. See [`fsd.requests.interrupted`](#fsdrequestsinterruptedoptions). |
| `flows()` | The flows the server hosts, as `FlowListEntry[]`. |
| `capabilities()` | What the server supports, as `FlowCapabilities`. |
| `stream(options)` | Follow the user stream: resource and scope-state changes for this user. See [`fsd.stream`](#fsdstreamoptions). |
| `transcribe({ audio, mediaType?, language? })` | Transcribe audio on the server. Resolves to `{ text, language? }`. `mediaType` defaults to `"audio/webm"`. |

A different user or a different server is a different client.

## `fsd.flow(address)`

Returns a `FlowHandle` for one flow. The address is a singleton flow's kind, or one copy's own id for a flow that runs as several copies (see [Flows](/docs/fundamentals/flows#how-an-instance-is-addressed)). There is no default flow; every action call names one.

Pass the flow's type to check action names and inputs at compile time. Import it with `import type` so no server code reaches a browser bundle.

```ts
import type { supportFlow } from "./flows/support";

const support = fsd.flow<typeof supportFlow>("support");
await support.send("reply", { text: "Hi" }); // name and input checked

await fsd.flow("notes-7").send("summarize", {}); // untyped: any name, `unknown` input
```

### `send(action, input, options?)`

Runs an action and resolves to a `SentRequest`: a [request handle](#request-handles) plus `response`, the server's answer to the send.

```ts
const sent = await support.send("reply", { text: "Hi" }, { sessionId: "sess_1" });

sent.id;                 // the request id
sent.response.status;    // "in_progress" | "completed" | "failed" | "incomplete"
sent.response.session?.id;

const final = await sent.wait();
```

| Option | Type | Notes |
|--------|------|-------|
| `sessionId` | `string` | The session to run in. Omitted, the server starts one and returns it in `response.session`. |
| `requestId` | `string` | Your own id for the request. Omitted, the server mints one. |
| `metadata` | `Record<string, unknown>` | Stored on the request record and shown in traces. Session `title` and `tags` are set through [`fsd.sessions.updateMetadata`](#fsdsessions), not here. |
| `stream` | `true` | Resolve to the server's SSE `Response` from the POST itself instead of a handle. Read it with [`createSSEClientFromResponse`](#createsseclientfromresponseoptions). A server that can't stream inline answers `202` JSON instead, so check the `content-type`. |

### `createSession(options?)`

Starts a session on this flow as the client's user. Resolves to a `SessionDetail`.

```ts
const session = await support.createSession({
  title: "Sprint planning",
  tags: ["planning"],
});
```

| Option | Type | Notes |
|--------|------|-------|
| `sessionId` | `string` | Your own id. See [Deriving the session id from your data](/docs/persistence/overview#deriving-the-session-id-from-your-data). |
| `title` / `description` / `tags` | | Session metadata shown in session lists. |
| `metadata` | `Record<string, unknown>` | Free-form metadata. |
| `state` | `Record<string, unknown>` | The new session's initial state, parsed by the flow's `stateSchema`. On a flow with a readonly field or a `session.createCheck`, a state that doesn't fit, or that the check refuses, fails the create and writes nothing. See [Example: one session per project](/docs/fundamentals/state-and-scopes#example-one-session-per-project). |

### `request(id)`

Returns a [request handle](#request-handles) for a request of this flow, by id. It reads nothing until you call a method, so it works for a request id you saved before a restart.

## Request handles

A `RequestHandle` comes from `send`, from `flow(address).request(id)`, or from `fsd.requests.interrupted()`. It carries `id` and `flow` (the address its routes take).

| Method | Resolves to | What it does |
|--------|-------------|--------------|
| `status()` | `RequestStatusSnapshot` | The request's state now: `id`, `status`, `startedAtMs`, `completedAtMs?`, `lastHeartbeatAt?`, `ageMs`, and `sessionId` (absent for a request with no session). |
| `wait({ pollMs?, timeoutMs? })` | `RequestStatusSnapshot` | Polls until the request has settled: it isn't `in_progress` and the server holds no live run of it. A request that stops for a person settles at `suspended`. `pollMs` defaults to 250. Past `timeoutMs` (default: never) it rejects with a `ClientHttpError` of status `0`. |
| `abort()` | `void` | Asks the server to stop it. On a server with durable execution this also stops a `suspended` request, which ends `aborted`. A request that already finished answers `409`. |
| `continue()` | the same handle | Carries on a crash-interrupted request under its own id. Finished blocks replay from the durable log; the one in flight runs again. `continue({ stream: true, includeTrace? })` resolves to the continuation's SSE `Response`. |
| `retry({ input? })` | a new `RequestHandle` | Runs the request again as a new request in the same session, with its original input or `input`. Only an `interrupted` or `failed` request can be retried; any other answers `409`. |
| `resume(body)` | the same handle | Answers a pending suspension. The run carries on under the same id. `resume(body, { stream: true })` resolves to its SSE `Response`. |
| `answer(body)` | the same handle | Answers a stop that waits for a user, in any run, including one a task board started. See [`answer(body)`](#answerbody). |
| `stream(options)` | `RequestStreamHandle` | Follows the request's events. See [Streams](#streams). |

`continue` and `retry` need the request's session. A handle from `send` or `interrupted()` already knows it; one from `request(id)` reads it from one `status()` call and keeps it. A request with no session rejects with a `ClientHttpError` of status `0` before anything is sent.

### `resume(body)`

```ts
await fsd.flow("chat").request("req_1").resume({
  suspensionId: "susp_abc",
  action: "approve",        // "approve" | "reject" | "submit" | "skip"
  data: { approved: true }, // payload for submit/approve; ctx.suspend() returns it
});
```

The server records the signed-in caller as who resumed it. When the app doesn't authenticate, that's the request's owner.

`submit` carries a payload in `data` that the server validates against the suspension's `resumeSchema`. `skip` declines an optional step and carries no payload. `approve` and `reject` are the binary outcomes. An `action` outside those four rejects with status `0` before sending.

Server errors:

- **400**: a missing or invalid `action`, a `data` payload that fails `resumeSchema` validation (path-keyed `validationErrors` in the body), or no durability provider configured.
- **404**: an unknown flow address, request or suspension. A request owned by another copy of the same flow answers `404` too.
- **409**: the request isn't suspended, the suspension is already resolved, a concurrent resume is in progress, or the action is outside the suspension's `allow` set.
- **410**: the suspension expired.

The React layer (`useSession().resumeSuspension`, `useSuspensions`) wires this up for you.

### `answer(body)`

An [Inbox](/docs/orchestration/task-board#building-an-inbox) answers a stop that waits for a user (a `ctx.waitForUser`, or a `user_approval` / `user_input` suspension) with `answer`. Unlike `resume`, it works on any run, including one a task board started, because it takes only where the stop is and the answer:

```ts
await fsd.flow(flowId).request(item.requestId).answer({
  suspensionId: item.suspensionId,
  action: "submit", // "approve" or "reject" for an approval
  data: "eu-west",
});
```

The server checks that the signed-in caller owns the stop's request before it reads the stop, and records that caller as who answered, so there is no `resumedBy`. A stop resolves once: whichever of an answer, a cancel, a deadline or a stop comes first wins.

Server errors:

- **400**: a missing or invalid `action`, or `data` that fails the stop's `resumeSchema`.
- **404**: the stop isn't the caller's (another user, tenant or organization), isn't one that waits for a user, or doesn't exist.
- **409**: the stop is already resolved (body `refused: "already-resolved"`), the action isn't one it allows, or another resume of the request is still running (`refused: "busy"`).
- **410**: the stop passed its deadline.

## `fsd.requests.interrupted(options?)`

Lists every interrupted request of the user's, including ones whose host stopped moments ago. A request stays in the list until it is continued or removed.

```ts
for (const lost of await fsd.requests.interrupted()) {
  console.log(lost.flowKind, lost.actionName, new Date(lost.interruptedAt));
  await lost.continue();
}
```

Each entry is an `InterruptedRequest`: a [request handle](#request-handles) addressed to its own flow, plus `sessionId?`, `flowKind`, `actionName` and `interruptedAt` (ms since epoch). `staleThresholdMs` can widen the server's own staleness threshold, never narrow it.

## `fsd.sessions`

Reads and manages sessions. Sessions are created on a flow, with [`fsd.flow(address).createSession`](#createsessionoptions).

| Method | Resolves to |
|--------|-------------|
| `list(options?)` | `SessionSummary[]`, newest first |
| `get(sessionId)` | `SessionDetail` |
| `requests(sessionId, options?)` | `SessionRequestSummary[]` |
| `children(parentSessionId, options?)` | `ChildSessionSummary[]` |
| `state(sessionId, options?)` | `SessionStateSnapshotResponse` |
| `updateMetadata(sessionId, { title?, description?, tags?, metadata? })` | `SessionDetail` |
| `delete(sessionId)` | `void` |
| `stream(sessionId, options?)` | `SessionStreamHandle`. See [Following a session](#following-a-session). |
| `debug.*` | DevTool reads of a session's resources and suspensions. The server must enable debug endpoints; otherwise `403`. |

`updateMetadata` changes only the fields you pass. `title`, `description` and `tags` are each replaced whole. `metadata` is merged key by key: the keys you send are written over the stored ones, and the rest stay. [Session management](/docs/client/overview#session-management) covers the errors it throws.

### `sessions.list(options?)`

```ts
const conversations = await fsd.sessions.list({ flowKind: "research" });

const withRuns = await fsd.sessions.list({
  flowKind: "research",
  include: "dispatch-runs",
});
```

| Option | Type | Notes |
|--------|------|-------|
| `flowKind` | `string` | Every session of a flow kind. |
| `flowId` | `string` | One copy of a collection flow, by its exact id. [`sessionQueryFor`](/docs/client/overview#listing-one-flows-sessions) picks `flowKind` or `flowId` for an address. |
| `userId` | `string` | Whose sessions. Default: the client's own user. A server with sign-in returns only the signed-in user's sessions whatever you pass. |
| `limit` / `offset` | `number` | Paging. |
| `include` | `"dispatch-runs"` | Also return the sessions dispatchers ran work in. Any other value answers `400`. |
| `state` | `Record<string, string>` | Only sessions whose readonly state fields hold these values. Needs `flowKind` or `flowId`; a field that isn't readonly on that flow is refused. See [Example: one session per project](/docs/fundamentals/state-and-scopes#example-one-session-per-project). |

Without `include`, the response holds the sessions a person started. With it, a row a dispatcher started carries `parentSessionId`, the session it was started from, plus the `topic` and `coordinate` labels below. Sessions belonging to another user, organization or tenant are never returned.

### `sessions.children(parentSessionId, options?)`

Lists the dispatch runs started from one session. Work that outlives a turn runs in a session of its own, so it doesn't appear in the starting session's requests.

```ts
const runs = await fsd.sessions.children("sess_1", {
  limit: 25, // 1–100, defaults to 25
  offset: 0, // 0–10000
});

// A row's `id` is a session id, so every session read works on it.
for (const run of runs) {
  const requests = await fsd.sessions.requests(run.id);
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

That is the whole row: there is no `flowKind`, `userId` or `title` on it.

`ChildSessionStatus` is `"active" | "completed" | "failed" | "incomplete" | "aborted"`. `active` means only that the work hasn't finished, covering queued, running and paused waiting for a person alike. It's the last state the server recorded, not a liveness check; [What `status` tells you](/docs/server/background-work#what-status-tells-you) has each value. `topic` and `coordinate` are for display only. Don't route or identify from them, and fall back to `id` rather than a made-up name. Guard all three with `== null`.

A session that started nothing returns `[]`. An unknown session, or one the caller isn't allowed to read, rejects with `ClientHttpError`. There is no call that starts a run; whether work is dispatched is declared by the flow on the server.

Full walkthrough: [Client > Overview](/docs/client/overview#dispatched-runs).

### `sessions.requests(sessionId, options?)`

Lists the requests a session has run. Each entry is a `SessionRequestSummary`: the action name, the status, the timings and, once the request has ended, a `result` saying what the action came to.

```ts
const requests = await fsd.sessions.requests("sess_1", { includeResultOutput: true });

for (const req of requests) {
  const { result } = req;
  if (result == null) continue; // still running, aborted, or no result recorded
  if (result.error) console.log(req.actionName, "failed:", result.error.message);
  else if (result.outputNotRecorded) console.log(req.actionName, "finished, output not recorded");
  else console.log(req.actionName, "returned", result.output);
}
```

| Option | Type | Notes |
|--------|------|-------|
| `status` | `RequestStatus` | Only requests with this status. |
| `limit` / `offset` | `number` | Paging. |
| `includeItems` | `boolean` | Add each request's item log as `items`. |
| `includeResultOutput` | `boolean` | Add the action's return value as `result.output`. |

Without `includeResultOutput`, `result` carries `error` and a `hasOutput` flag but not the value itself.

| Request status | `result` |
|---|---|
| `completed` or `incomplete` | `{ hasOutput: true }`, plus `output` with `includeResultOutput`. `{ hasOutput: false }` when the action returned nothing. |
| `failed` | `{ error: { code, message }, hasOutput: false }`. When the action had returned before a completion hook failed the request, `hasOutput` is `true` and `output` is there with `includeResultOutput`. |
| `in_progress`, `suspended`, `aborted` or `interrupted` | absent |

`output` is a JSON copy of what the action returned, so a `Date` is stored as its ISO string and an object key set to `undefined` is left out. A value that doesn't survive a JSON round trip (a `BigInt`, an object that refers to itself, `NaN` or `Infinity`, a function or symbol, an `undefined` array slot, a `Map`, `Set` or `Error`) isn't stored. Those requests carry `outputNotRecorded: true` and `hasOutput: false` in place of the output, and their status is unaffected.

A finished request written by a server that didn't store results has no `result`. Check `result == null` rather than inferring the outcome from `status`.

### `sessions.state(sessionId, options?)`

Reads the session's state snapshot: the `clientData` values the flow exposes and, with `includeItems`, the item log.

| Option | Type | Notes |
|--------|------|-------|
| `includeItems` | `boolean` | Include the session's items. |
| `clientData` | `string[]` | The `clientData` keys to read, such as `"session.activePlan"`. |
| `itemTypes` | `string[]` | Only these item types. |
| `offset` / `limit` | `number` | Item paging. 100 items to a page by default. |

The snapshot's `at` is the server time the read began, and `sessionCreatedAt` identifies the session you read. Both feed [`sessions.stream`](#following-a-session).

## `fsd.resources`

Reads and writes a session's resources. Every method takes the session id and the resource ref.

| Method | Resolves to |
|--------|-------------|
| `getResourceContent(sessionId, ref)` | `{ ref, content }` |
| `getCollectionItemContent(sessionId, ref, topic)` | `{ ref, topic, content }` |
| `createCollectionItem(sessionId, ref, { topic, content? })` | `{ topic }` |
| `updateResourceContent(sessionId, ref, topic, { content })` | `void` |
| `deleteCollectionItem(sessionId, ref, topic)` | `void` |
| `listCollectionItems(sessionId, ref, { limit?, cursor?, topicPrefix? })` | `CollectionListPage`. Pass `nextCursor` back as `cursor` for the next page. |
| `getCollectionItemState(sessionId, ref, topic)` | `CollectionItemState \| null`, `null` when the topic is absent |
| `getResourceManifest(sessionId)` | `ResourceManifest`: every public resource the session's flow declares |

`listCollectionItems` and `getCollectionItemState` need `client.state.read: true` on the collection. What each resource lets a client see and write is set on the server; see [Client access](/docs/resources/client-access).

### `readEveryCollectionPage(source, sessionId, ref, options?)`

Reads every row of one collection, following `nextCursor` to the end. `source` is any object with `listCollectionItems`, such as `fsd.resources`.

```ts
import { readEveryCollectionPage } from "@flow-state-dev/client";

const rows = await readEveryCollectionPage(fsd.resources, sessionId, "workers");
```

It rejects with `CollectionReadStoppedError` (`reason: "page-limit" | "repeated-cursor"`) when the server keeps returning cursors past `COLLECTION_READ_MAX_PAGES` (1,000) pages or sends the same cursor twice, so a read that stopped early never comes back as the whole list.

## Streams

### `stream(options)` on a request handle

Follows one request's events. Pass the callbacks you need.

```ts
const stream = sent.stream({
  onItemAdded: (event) => { /* new item */ },
  onItemUpdated: (event) => { /* item changed */ },
  onContentDelta: (event) => { /* text chunk */ },
  onRequestStatus: (event) => {
    if (event.status === "completed") { /* done */ }
  },
  startingAfter: lastSeq, // resume after this sequence number
});

stream.close();
```

Besides the callbacks, it takes `startingAfter` (resume after a sequence number), `lastEventId` (resume after an event id, ignored when `startingAfter` is set), `dedupWindowSize` (how many recent events are remembered to drop a duplicate, default 1000) and `includeTrace` (also deliver `block_trace`, `router_decision` and `state_snapshot` items). A request stream does not reconnect on its own; open it again with `startingAfter` set to the last sequence number you saw.

### Following a session

`fsd.sessions.stream(sessionId, options)` opens one stream for a whole session. It delivers each finished item from any request in the session, with the id of the request that kept it, and a notice naming the session's unfinished background runs whenever that set changes. Items the session snapshot hides are never sent.

To build a live view, read the whole session snapshot, then open the stream from its first page's `at`, the server time that read began. The pages hold everything saved before that time, and the stream picks up everything saved after. Pass the snapshot's `sessionCreatedAt` too, so the stream follows the session you read and not a later one that takes its id. The example calls `readHistory`, from [Reading a live session's history](#reading-a-live-sessions-history) below, to read every page without missing an item. `useSession` with `live: true` does all of this for you.

```ts
import { compareItemOrder } from "@flow-state-dev/client";

const history = await readHistory(); // see "Reading a live session's history"

// Keyed by request id and item id together: two requests can save items with the same id.
const items = new Map(history.items.map((item) => [`${item.requestId}:${item.id}`, item]));

const stream = fsd.sessions.stream(sessionId, {
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
| `since` | A server time (epoch ms) to start from: the snapshot's `at`, or `stream.lastAt` from an earlier connection. The stream starts a few seconds before it. Omitted, it starts about a minute back. |
| `sessionCreatedAt` | The snapshot's `sessionCreatedAt`. Every connection, reconnects included, then follows that session only. Once its id holds another session, the reconnect is refused and the client stops: 404, or 403 if the app authenticates and another user or organization holds the id. Omitted, a reconnect follows whatever session holds the id, if the caller may read it. |
| `itemTypes` | Item types to send. Give it the same list as the snapshot's `itemTypes` so the stream sends what the snapshot shows. |
| `onReconnecting` | Called with `{ attempt }` each time the connection has dropped and the client is about to try again. `attempt` counts the tries since the stream last delivered an event. `1` is the first try after a drop, such as the server's own close. `2` or more means a try has failed, and what the stream last told you, such as which runs are unfinished, may be out of date until it delivers again. |
| `retry` | `{ initialDelayMs, maxDelayMs }`, the wait before each reconnect. The first wait is `initialDelayMs` (default `1000`), and each failed try doubles it, up to `maxDelayMs` (default `30000`). Once the stream delivers an event, the next drop starts again from `initialDelayMs`. |

The handle has `close()`, `lastAt` (the server time of the last event heard) and `stopped`.

The snapshot's items come in `compareItemOrder` order: `ts`, then `itemIndex`, then `requestId`, then `id`. The stream sends different requests' items in no set order, so sort anything you merge with the same comparator and a live view shows what a reload shows.

The stream reconnects with backoff, including when the server closes the connection after at most 15 minutes, and passes back the server time it last heard so the server resends what it might have missed. So the same copy of an item can arrive more than once, after a reconnect or when it was saved just before the snapshot's `at`. An item one request emits more than once under the same id, such as a keyed component, also arrives once per emission, each copy with its own `ts` and `itemIndex`. Holding items by request id and item id, keeping the copy that sorts later and letting a finished copy replace an in-progress one, as above, handles both.

It stops for good, through `onStop` and without retrying, on a 401, 403, 404, 409 or 501. The server also ends the connection when the session is deleted or replaced by a new session under the same id. If the session is gone, the reconnect gets 404; if the app authenticates and another user or organization now holds the id, it gets 403. If the same owner created the session again, or the app doesn't authenticate, the reconnect gets 404 when you passed `sessionCreatedAt`, and otherwise follows the new session.

#### Reading a live session's history

With `includeItems: true` the snapshot's items come oldest first, 100 to a page by default, and `pagination.hasMore` says another page follows. Each page is cut from the history as it stands when you ask, so if the history shifts partway through your read, as when a keyed component is emitted again or a request is removed, an item can fall between two pages. The stream won't send that item later, so check for it: ask for each later page one item early, at `pagination.nextOffset - 1`, and compare its first item with the last one you hold. If `compareItemOrder` says they differ, read again from the first page. Do the same when a later page's `sessionCreatedAt` differs from the first page's: the id was deleted and taken by a new session during the read. Give up after a few tries; this one throws after five.

```ts
async function readHistory() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const first = await fsd.sessions.state(sessionId, { includeItems: true });
    const held = [...(first.items ?? [])];
    let page = first;
    let whole = true;
    while (whole && page.pagination?.hasMore) {
      page = await fsd.sessions.state(sessionId, {
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

### `fsd.stream(options)`

Follows the user stream: resource changes and scope-state changes for the client's user, across sessions. Callbacks are `onResourceChanged`, `onResourceContentUpdated`, `onResourceContentCreated`, `onResourceContentDeleted`, `onScopeStateChanged`, `onDebug`, `onEvent` and `onError`. It takes the same `startingAfter`, `lastEventId` and `dedupWindowSize` as a request stream.

### `createSSEClientFromResponse(options)`

Reads an SSE `Response` that a `{ stream: true }` call returned, with the same callbacks as a request stream.

```ts
import { createSSEClientFromResponse } from "@flow-state-dev/client";

const response = await support.send("reply", { text: "Hi" }, { stream: true });

if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
  createSSEClientFromResponse({
    response,
    onContentDelta: (event) => { /* text chunk */ },
  });
} else {
  const { request } = await response.json(); // 202: the server didn't stream inline
}
```

### `createRequestStreamStore()` and `bindStoreToCallbacks(store, options?)`

Accumulate a request's events into a sorted, ready-to-render item list outside React. `createRequestStreamStore()` returns a `RequestStreamStore`; `bindStoreToCallbacks` turns it into a set of request-stream callbacks you can spread into a handle's `stream` or into `createSSEClientFromResponse`.

```ts
import { bindStoreToCallbacks, createRequestStreamStore } from "@flow-state-dev/client";

const store = createRequestStreamStore();

fsd.flow("my-app").request(requestId).stream({
  ...bindStoreToCallbacks(store, {
    onChange: () => {
      store.flushDeltas();
      render(store.getSorted());
    },
  }),
});
```

The store buffers content deltas, so call `store.flushDeltas()` before reading `getSorted()`. `onChange(kind)` receives `"item" | "content" | "status"` so a consumer can flush at different rates per kind, and an optional `itemFilter` gates which items reach the store. The store also tracks `status`, `lastSequenceNumber` and the `statusEvents` log. The React `useSession` and `useRequestStream` hooks wrap the same reducer, so reach for it directly only outside React.

By default the store holds each item under its `id`, which is unique within one request. To hold items from several requests, where two can save items with the same id, pass `keyOf`:

```ts
const store = createRequestStreamStore({
  keyOf: (item) => `${item.requestId}/${item.id}`,
});
```

Every store method that takes an item id then takes that key. `bindStoreToCallbacks` addresses items by id, so pair it only with the default key.

## Other exports

- `sessionQueryFor(address, flows)`: the `sessions.list` filter (`{ flowId }` or `{ flowKind }`) for one flow address. See [Listing one flow's sessions](/docs/client/overview#listing-one-flows-sessions).
- `compareItemOrder(a, b)`: display order for items from many requests.

## Errors

### `ClientHttpError`

Every failed call rejects with `ClientHttpError`. It carries `status`, the server's HTTP status, and `body`, the parsed response body. `status` is `0` when the client refused before sending: a missing argument, a resume action outside the four, a `continue` or `retry` on a request with no session, or a `wait` that timed out.

```ts
import { ClientHttpError } from "@flow-state-dev/client";

try {
  await fsd.flow("chat").send("reply", { text: "Hello!" });
} catch (err) {
  if (err instanceof ClientHttpError) {
    console.error(err.status, err.body);
  }
}
```
