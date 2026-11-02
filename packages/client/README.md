# @flow-state-dev/client

**Connect to flows from anywhere. Actions, sessions, streaming — no framework lock-in on the client side.**

Works in Node, the browser, edge runtimes. No React dependency. No DOM dependency. It talks HTTP and SSE to a server, or reaches an engine in the same process with no web server.

## Installation

```bash
pnpm add @flow-state-dev/client
```

## Creating a client

`createClient` builds a client for one user and one server. It holds the user every call acts as and the transport every call and stream goes through. Flows, sessions, resources and requests all hang off it.

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({ baseUrl: "http://localhost:3000", userId: "user_1" });

const support = fsd.flow("support");
const session = await support.createSession();
const sent = await support.send("reply", { text: "Hi" }, { sessionId: session.id });
const { status } = await sent.wait();
```

| Option | What it does |
|--|--|
| `userId` | Required. The user every call acts as. It is caller input: with sign-in on, the server trusts the request's credentials instead. |
| `baseUrl` | Where the server answers, e.g. `"http://localhost:3000"`, plus any base path. `""` is the page's own origin. Required unless you pass a `fetcher`. |
| `apiPath` | Where the server mounts the flow API, after `baseUrl`. Default `/api/flows`. Set it when the server mounts it elsewhere, such as a Node host's `basePath`. |
| `fetcher` | The `fetch` every call and stream goes through. Default: the global `fetch`, looked up on each call. |

### In the same process, with no web server

Pass the engine's `createInProcessFetch` as the fetcher and the client talks to
a `FlowState` in this process. The routes, checks and answers are the same as
over HTTP.

```ts
import { createFlowState, createInProcessFetch } from "@flow-state-dev/engine";
import { createClient } from "@flow-state-dev/client";

const flowState = createFlowState({ flows: { support } });
const fsd = createClient({ userId: "user_1", fetcher: createInProcessFetch(flowState) });
```

With a fetcher and no `baseUrl`, the client sends relative URLs: the in-process
fetcher reads only the path, and in a browser a credential wrapper reaches the
page's own origin.

### Adding credentials

A fetcher is also where credentials go. Wrap `fetch` and pass the wrapper:

```ts
const fsd = createClient({
  baseUrl: "https://api.example.com",
  userId,
  fetcher: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  },
});
```

## Flows

`fsd.flow(address)` is one flow. The address is a singleton flow's kind, or a
collection copy's own id. Pass the flow's type to check action names and
inputs at compile time. Import it as a type only, so no server code reaches the
browser bundle:

```ts
import type { supportFlow } from "./flows/support";

const support = fsd.flow<typeof supportFlow>("support");
await support.send("reply", { text: "Hi" });   // name and input checked
await fsd.flow("notes-7").send("summarize", {}); // a collection copy, untyped
```

- `send(action, input, { sessionId?, requestId?, metadata? })` resolves to the
  request it started: a request handle plus `.response`, the server's answer.
  With no `sessionId` the server starts a session.
- `send(action, input, { stream: true })` resolves to the server's SSE
  `Response` from the POST itself. Read it with `createSSEClientFromResponse`.
  A server that can't stream inline answers 202 JSON instead, so check the
  `content-type`.
- `createSession({ sessionId?, title?, description?, tags?, state?, metadata? })` starts a session on
  this flow as the client's user.
- `request(id)` is a request of this flow, by id. It reads nothing until you
  call a method.
- `read(name, input, { sessionId })` runs one of the flow's `reads` on the
  session and resolves to its output. Nothing is stored, so it is the call to
  poll with. A refusal (an unknown read or session, a write the read tried)
  rejects with `ClientHttpError` carrying the status.

## Requests

A request handle comes from `send`, from `flow(address).request(id)`, or from
`fsd.requests.interrupted()`.

| Method | What it does |
|--|--|
| `status()` | The request's lifecycle state now. |
| `wait({ pollMs?, timeoutMs? })` | Resolves once the request has settled: it is not `in_progress`, and the server holds no live run of it. A run that stops for a person settles at `suspended`. |
| `abort()` | Ask the server to stop it. On a server with durable execution this also stops a `suspended` request, which ends `aborted`. A 409 means it already finished, or was resumed before the stop reached it. |
| `continue()` | Carry on a crash-interrupted request under its own id. Finished blocks replay from the durable log; the one in flight runs again. Resolves to the same handle. `{ stream: true }` returns the continuation's SSE `Response`. |
| `retry({ input? })` | Run it again as a new request in the same session, with its original input or `input`. Resolves to the new request. Only an `interrupted` or `failed` request can be retried. |
| `resume({ suspensionId, action, data? })` | Answer a pending suspension. The run carries on under the same id, and the server records the signed-in caller as who answered. `{ stream: true }` returns its SSE `Response`. |
| `answer({ suspensionId, action, data? })` | Answer a stop that waits for a user, in any run, a task board's included, which `resume` refuses (below). Resolves to the same handle. |
| `stream(callbacks)` | Follow the request's events (below). |

`continue` and `retry` need the request's session. A handle from `send` or
`requests.interrupted()` already knows it; one from `request(id)` reads it from
one status call and keeps it. A request with no session rejects before any call.

`resume`'s `action` is one of `"approve" | "reject" | "submit" | "skip"`.
`submit` carries a typed payload in `data`, which the server validates against
the suspension's `resumeSchema` (an invalid payload is a 400 with path-keyed
`validationErrors`). `skip` declines an optional step. An action outside the
suspension's `allow` set is a 409.

To answer a stop that waits for a user from an inbox (a `ctx.suspendForUser`, or a
`user_approval` / `user_input` stop), use `answer`. The server checks the
caller owns the stop's request before it reads the stop, and records the
signed-in caller as who answered, so there is no `resumedBy`:

```ts
await fsd.flow(flowId).request(item.requestId).answer({
  suspensionId: item.suspensionId,
  action: "submit",
  data: "eu-west",
});
```

It rejects on a refusal: `404` for a stop that isn't the caller's or isn't a
user's, `409` for one already resolved (an answer, a cancel, a deadline or a
stop got there first), `410` past its deadline, `400` for an answer its
`resumeSchema` rejects.

### After a crash

A host that crashed or restarted leaves its running requests behind.
`fsd.requests.interrupted()` lists every interrupted request of the user's, including ones whose host stopped moments ago. A request stays in the list until it is continued or removed.

```ts
// Saved the id? Use it.
await fsd.flow("support").request(savedId).continue();

// Saved nothing? Read the user's interrupted requests.
for (const lost of await fsd.requests.interrupted()) {
  await lost.continue();
}
```

Each entry is a request handle plus `sessionId`, `flowKind`, `actionName` and
`interruptedAt`. `staleThresholdMs` can only widen the server's own threshold,
never narrow it.

## Streaming

Follow one request with typed callbacks:

```ts
const stream = sent.stream({
  onItemAdded: (event) => {
    // A new item: a message, reasoning, a component
  },
  onContentDelta: (event) => {
    // A text chunk for the current item
  },
  onRequestStatus: (event) => {
    if (event.status === "completed") {
      // Read the session state for the final picture
    }
  },
  // Pick up after a disconnect: the server replays what you missed.
  startingAfter: lastSeq,
});

stream.close();
```

`fsd.sessions.stream(sessionId, options)` follows a whole session: every
finished item any request in it keeps, and a notice whenever its unfinished runs
change. It reconnects with backoff; a 401, 403, 404, 409 or 501 stops it for
good (`onStop`). `fsd.stream(callbacks)` follows the user stream, the user's
resource and scope-state changes.

Every stream goes through the client's fetcher, so an in-process client streams
with no web server, and a credentialed one streams with its credentials.

## Stream state store

A request's `stream` hands you raw event callbacks. To get those events as a sorted, ready-to-render item list, with streaming text accumulated and repeated emissions collapsed, use the request stream store. It's the accumulator the React hooks use, so it works in a Node script or a custom UI.

```ts
import { createRequestStreamStore, bindStoreToCallbacks } from "@flow-state-dev/client";

const store = createRequestStreamStore();

fsd.flow("support").request(requestId).stream({
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

`fsd.sessions` reads and manages sessions. A listing with no `userId` is the
client's own user's sessions; name another user to list theirs, which a server
with sign-in narrows to the signed-in user anyway.

```ts
// State snapshot with clientData and items
const snapshot = await fsd.sessions.state("sess_1", {
  includeItems: true,
  clientData: ["session.artifactsList", "user.preferences"],
});
// `snapshot.at` is the server time the read began. Items come in pages
// (`pagination.hasMore`, `pagination.nextOffset`). To follow the session, read
// every page, starting each later page one item early (`nextOffset - 1`) and
// reading again from the first page if that item is not the last one you hold,
// or if the page's `sessionCreatedAt` differs from the first page's. Then pass
// the first page's `at` and `sessionCreatedAt` to `fsd.sessions.stream`
// (`since`, `sessionCreatedAt`), so it follows the session you read.

// List a session's requests. A finished request carries `result`: `error` when
// it failed, and `hasOutput`. Pass `includeResultOutput` for the action's return
// value as `result.output`, and `includeItems` for each request's item log.
// `result` is absent while a request runs, on aborted or interrupted requests,
// and on history from a server that didn't save results: guard with `== null`.
const requests = await fsd.sessions.requests("sess_1", {
  includeResultOutput: true,
  includeItems: true,
});
```

A request whose history window had dropped earlier turns carries `historyStart: { requestId }`, the oldest earlier turn its history window still held. Draw a divider above that turn: the turns before it were out of the model's view, or in the summary on a flow with a [history summary](https://flow-state.dev/docs/advanced/generator-context#summarizing-turns-past-the-window). It's absent while every earlier turn was in the window. Guard with `== null`.

### Reading a long session from its end

A session's items come back oldest first, so a conversation that has run for
days is best read from its end. `readSessionTail` reads the newest page,
`readSessionEarlier` adds earlier items when someone asks for them (a *Load
earlier* button), and `refreshSessionWindow` reads the window again for a view
with no live feed.

```ts
import { readSessionEarlier, readSessionTail, refreshSessionWindow } from "@flow-state-dev/client";

let window = await readSessionTail(fsd.sessions, "sess_1", { itemTypes: ["message"] });
// window.items: the newest 200 items, oldest first. window.hasEarlier: show "Load earlier".
window = await readSessionEarlier(fsd.sessions, window);
// Later, with no stream to follow: new items, and any stored among the ones shown.
window = await refreshSessionWindow(fsd.sessions, window);
```

Every read runs from the window's start to the session's end. A reply is stored
while it is still being written and finishes in place, and an item can be
stored behind ones already shown; a read of only what came after the old end
would miss both. Pass
`window.at` and `window.sessionCreatedAt` to `fsd.sessions.stream` to follow
the session from there instead.

### Listing one flow's sessions

Where a flow's sessions are filed depends on how the flow was declared, so `sessionQueryFor` reads the flow list and builds the right filter:

```ts
import { sessionQueryFor } from "@flow-state-dev/client";

const flows = await fsd.flows();
const rows = await fsd.sessions.list(sessionQueryFor("engineer-a", flows));
```

A `cardinality: "collection"` flow has many addressable copies, so a copy's sessions are filed under its exact id. A `cardinality: "singleton"` flow is one instance whose address is its kind, so its sessions are filed under the kind. An address the flow list does not carry reads as a singleton.

You get back exactly one key: `{ flowId: address }` for a copy of a collection flow, `{ flowKind: address }` otherwise. Spread it into `fsd.sessions.list` alongside whatever else you are filtering by.

### Dispatched runs

Work that outlives the turn that started it runs in a session of its own, so it
never appears in the requests of the session that started it.

`fsd.sessions.list` with `include: "dispatch-runs"` returns those sessions beside the
flow's conversations:

```ts
const rows = await fsd.sessions.list({
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
list sessions by it with `fsd.sessions.list`'s `state` filter.

```ts
const fresh = await fsd.flow("agent").createSession({ state: { projectId: "q3-launch" } });
const mine = await fsd.sessions.list({ flowKind: "agent", state: { projectId: "q3-launch" } });
```

The filter needs `flowKind` or `flowId`, matches string values exactly, and is
refused for a field that isn't readonly on that flow. On a flow with a readonly
field or a create check, a create whose `state` doesn't match the schema rejects
with a 400 naming the field. A flow can also declare a
[`session.createCheck`](https://flow-state.dev/docs/fundamentals/state-and-scopes#creating-sessions)
for a rule that depends on the caller, such as whether the project is theirs; it
rejects with the server's status (400, 403 or 404) and message. Either way, no
session is written.

`fsd.sessions.children` asks one session which dispatch runs were started from it.

```ts
// Paging only: `limit` is 1–100 (25 by default), `offset` is 0–10000.
const started = await fsd.sessions.children("sess_1", { limit: 25 });

for (const run of started) {
  // A row's `id` is a session id, so the reads you already use work on it.
  const requests = await fsd.sessions.requests(run.id);
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

## Public API

- `createClient({ userId, baseUrl?, apiPath?, fetcher? })` — A client for one user and one server:
  - `flows()`, `capabilities()`
  - `flow(address)` — `send`, `createSession`, `request(id)`
  - `sessions` — `list`, `get`, `requests`, `children`, `state`, `updateMetadata`, `delete`, `stream`, and `debug` (DevTool reads; the server must opt in)
  - `resources` — content, collection items and the manifest (below)
  - `requests.interrupted({ staleThresholdMs? })` — The user's interrupted requests, as request handles
  - `stream(callbacks)` — The user stream
  - `transcribe({ audio, mediaType?, language? })` — Transcribe audio on the server
- `createSSEClientFromResponse({ response, ...callbacks })` — Read an SSE `Response` a `{ stream: true }` call returned
- `createRequestStreamStore({ keyOf? })` — Headless request-stream accumulator (sorted items, streaming text, status/sequence)
- `bindStoreToCallbacks(store, options?)` — Map SSE events onto a store (the shared reducer)
- `compareItemOrder(a, b)` — Display order for items from many requests (`ts`, `itemIndex`, `requestId`, then `id`); a session snapshot's items come in this order, so sort merged items with it
- `sessionQueryFor(address, flows)` — Build the `sessions.list` filter (`flowId` or `flowKind`) for one flow address
- `sendHarnessLine(prompt, running, sender)` — Send a line typed into a harness session: into the running turn when its harness takes it (the flow's steer action, core's `harnessSteering`), else as the next turn. Answers `"taken"`, `"after-this-turn"` or `"turn"`
- `harnessLines(sendOne?)` — Keep one page's lines in typed order: `send(prompt, running, sender)` waits for the line before, and once a line has gone to run after the running turn, later lines follow it until `turnChanged()`
- `steerRunningTurn(client, { flowKind, sessionId, prompt, action? })` — Send the flow's steer action on its own, so a session hook's stream stays on the running turn, and read its `{ taken, live }` answer
- `ClientHttpError` — Every failure. `status` is the server's answer, or `0` when the client refused before sending (a missing argument, a request with no session to continue)

### Resources

- `getResourceContent(sessionId, ref)` → `{ ref, content }`
- `getCollectionItemContent(sessionId, ref, topic)`, `createCollectionItem(sessionId, ref, { topic, content? })`, `updateResourceContent(sessionId, ref, topic, { content })`, `deleteCollectionItem(sessionId, ref, topic)`
- `listCollectionItems(sessionId, ref, { limit?, cursor?, topicPrefix? })` → `CollectionListPage`
- `getCollectionItemState(sessionId, ref, topic)` → `CollectionItemState | null`
- `getResourceManifest(sessionId)` → `ResourceManifest`

- `readEveryCollectionPage(source, sessionId, ref, { limit?, keepReading? })` — Every row of one collection, following `nextCursor` to the end. Rejects with `CollectionReadStoppedError` (`reason: "page-limit" | "repeated-cursor"`) when the server keeps returning cursors past `COLLECTION_READ_MAX_PAGES` (1,000) pages or sends the same cursor twice, so a read that stopped early is never handed back as the whole list

The list/get-state methods require `client.state.read: true` on the collection. The manifest endpoint enumerates every public resource on the session's flow.

## Notes

- `userId` is required: it is the user every call acts as
- Stream resume supports both `Last-Event-ID` header and `starting_after` query param
- Request and user streams use a bounded sliding-window event dedup cache (`dedupWindowSize`, default `1000`)
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
