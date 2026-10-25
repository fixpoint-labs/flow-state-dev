---
sidebar_position: 1
---

# Overview

`@flow-state-dev/client` is how code outside the server talks to your flows. It works in Node, the browser and edge runtimes, with no React or DOM dependency. It speaks HTTP and SSE to a server, or calls an engine in the same process with no web server at all.

If you're building a React app, see [Client > React](/docs/client/react); the React package wraps this client with hooks and renderers. This page covers using the client directly, for scripts, tests, workers and non-React UIs.

## Creating a client

`createClient` builds a client for one user and one server. It holds the user every call acts as and the transport every call goes through. Flows, sessions, resources and requests all hang off it.

```ts
import { createClient } from "@flow-state-dev/client";

const fsd = createClient({
  userId: "user_1",
  baseUrl: "http://localhost:3000",
});
```

`baseUrl` is where the server answers, plus any base path; the client adds `/api/flows` itself. In a browser on the same origin, pass `""`. [Client options](/docs/configuration/client) covers `baseUrl`, `apiPath` and `fetcher` in detail, including how to add credentials and how to call an engine in the same process with no web server.

## Sending an action

`fsd.flow(address)` is one flow. The address is the flow's kind, or one copy's id for a flow that runs as several copies. There is no default flow, so every call names one.

```ts
const support = fsd.flow("support");

const session = await support.createSession({ title: "Billing question" });
const sent = await support.send("reply", { text: "Hello" }, { sessionId: session.id });

const final = await sent.wait();
console.log(final.status); // "completed", "failed", "suspended", ...
```

`send` resolves once the server has accepted the request, usually before the work has finished. `sent.response` is the server's answer to the send (`{ status, request, session?, error? }`), and `sent` itself is a request handle you can wait on, stream, abort or resume. Leave out `sessionId` and the server starts a session; its id is in `sent.response.session`.

To check action names and inputs at compile time, pass the flow's type. Import it with `import type`, so none of the server code ends up in a browser bundle:

```ts
import type { supportFlow } from "./flows/support";

const support = fsd.flow<typeof supportFlow>("support");
await support.send("reply", { text: "Hello" }); // a typo in "reply" or a wrong input is a type error
```

## Requests

A request handle is how you follow and steer one request. You get one from `send`, from `fsd.flow(address).request(id)`, or from [`fsd.requests.interrupted()`](#after-a-crash).

```ts
const request = fsd.flow("support").request("req_123");

await request.status();   // { id, status, startedAtMs, sessionId?, ... }
await request.wait();     // resolves once the request has settled
await request.abort();    // ask the server to stop it
```

| Method | What it does |
|--------|--------------|
| `status()` | The request's state now. |
| `wait({ pollMs?, timeoutMs? })` | Resolves once the request has settled. A request that stops to ask a person settles at `suspended`. |
| `abort()` | Ask the server to stop it. |
| `continue()` | Carry on a crash-interrupted request. It keeps its request id. |
| `retry({ input? })` | Run it again as a new request, with a new id, in the same session. |
| `resume({ suspensionId, action, data? })` | Answer a pending approval or form. It keeps its request id. |
| `stream(callbacks)` | Follow its events live. |

`fsd.flow(address).request(id)` reads nothing until you call a method, so an id is all you need to keep. [The API reference](/docs/api/client#request-handles) has every option and failure.

## Streaming a request

```ts
const stream = sent.stream({
  onItemAdded: (event) => {
    // New item (message, reasoning, component, etc.)
  },
  onContentDelta: (event) => {
    // Text chunk for streaming items
  },
  onRequestStatus: (event) => {
    if (event.status === "completed") {
      // Read the state snapshot for the final picture
    }
  },
  onSessionMetadataChanged: (event) => {
    // Title, description, or tags updated (e.g. by sessionTitleGenerator)
    console.log(event.title);
  },
});

stream.close();
```

If the connection drops, open the stream again with `startingAfter` set to the last sequence number you saw. The server replays what you missed, then continues live.

If you'd rather have those events folded into a ready-to-render item list than handle each callback yourself, pass `createRequestStreamStore()` through `bindStoreToCallbacks`, the same accumulator the React hooks use. See [the store](/docs/api/client#createrequeststreamstore-and-bindstoretocallbacksstore-options) in the API reference. On React you don't need it; `useSession` and `useRequestStream` wrap it for you.

A request's stream carries one request. To follow everything that happens in a session, including requests another tab, person or agent sent, use [`fsd.sessions.stream`](/docs/api/client#following-a-session). It delivers each item once it's finished, not text as it's generated.

## After a crash

If the server process crashes or restarts while a request is running, the request is left `interrupted`. You can pick it up again from the client.

If you saved the request id, continue it by id:

```ts
await fsd.flow("support").request(savedRequestId).continue();
```

`continue()` keeps the request id. Blocks that had finished are replayed from the durable log rather than run again, and the block that was in flight runs again. If you would rather start over with a new request in the same session, use `retry()`, which resolves to the new request.

If you saved nothing, ask the server which of this user's requests were interrupted:

```ts
for (const lost of await fsd.requests.interrupted()) {
  console.log(`${lost.flowKind}/${lost.actionName} stopped at`, new Date(lost.interruptedAt));
  await lost.continue();
}
```

Each entry is a request handle already addressed to its own flow, plus `sessionId`, `flowKind`, `actionName` and `interruptedAt`. A request stays in the list until it is continued or removed, so calling `interrupted()` again lists it again.

Only an `interrupted` request can be continued; any other answers `409`. Use `resume` for a `suspended` one. A request that has no session can't be continued or retried, and the call rejects before anything is sent. [Durable execution](/docs/advanced/durable-execution) covers what replays and what runs again.

## Session management

`fsd.sessions` reads and manages the user's sessions. You create a session on a flow, with `fsd.flow(address).createSession`.

**Creating sessions with metadata:**

```ts
const session = await fsd.flow("my-app").createSession({
  title: "Sprint planning",          // optional
  description: "Q2 kickoff session", // optional
  tags: ["planning", "sprint-12"],   // optional
});
```

Sessions carry `title`, `description` and `tags` as their own fields, separate from workflow state. They show up in session lists and are useful for building conversation history UIs.

**Updating metadata after the fact:**

```ts
await fsd.sessions.updateMetadata("sess_1", {
  title: "Revised title",
  tags: ["updated"],
  metadata: { reviewed: true },
});
```

Only the fields you include are changed. Omitting `title` leaves the existing title untouched, even one another writer sets while your edit is in flight. What a field you include does depends on the field:

- `title`, `description` and `tags` are replaced whole. The call above leaves the session with exactly one tag, `updated`. To add a tag, read the current list, add to it, and send the whole list.
- `metadata` is merged key by key. `reviewed` is written, and every other key already on the session stays. A key you send replaces that key's stored value whole, even when the value is an object.

If the session keeps changing too fast for your edit to land, the call throws `ClientHttpError` with `status` 409 and changes nothing, and you can send the same edit again. A 409 whose `body` is `{ error: "migration-required" }` is different: the session needs migrating, and retrying won't clear it. See [Who owns a record](/docs/persistence/overview#who-owns-a-record). If the session is deleted, or replaced by a new session under the same id, while your edit is being applied, the call throws `ClientHttpError` with `status` 404 and changes nothing.

**Fetching session state:**

```ts
const snapshot = await fsd.sessions.state("sess_1", {
  includeItems: true,
  clientData: ["session.artifactsList", "user.preferences"],
});
```

`state` returns the session's snapshot with the `clientData` keys you name. Add `includeItems` to get the session's item log.

**Deleting a session:**

```ts
await fsd.sessions.delete("sess_1");
```

`delete` doesn't stop or wait for requests and background runs that are still going.

You can pass your own `sessionId` to `createSession` (see [Deriving the session id from your data](/docs/persistence/overview#deriving-the-session-id-from-your-data)). Give a new session a new id. If you derive ids from your data, include something that changes each time you recreate the session, such as a counter you bump on every delete.

If you reuse a deleted session's id, the new session picks up what the old one left behind:

- **What it shows.** If the new session is created by the same user, in the same organization and tenant, it lists the deleted session's background runs in its background-work list and its live stream, even if it's for a different flow instance. It shows the deleted session's requests, in its snapshot and its live stream, only if it's also for the same flow instance. A new session created by anyone else shows none of them.
- **What gets written to it.** Requests that were still running in the deleted session keep writing under that id, so they write to the new session if it's in the same tenant, whoever created it. Their state changes, [journal](/docs/fundamentals/state-and-scopes#sessions-in-depth) entries, and any title, description, tags or metadata they set land there. A session under the same id in another tenant is stored separately and gets none of it. Background runs write to their own sessions, not this one.
- **Resources.** Those requests can write the new session's resources too. A content write always lands, even over content the new session deleted. A state write lands if the new session has already written that resource, and is applied to the new session's value. If the new session hasn't written it, a write that changes a value the request had already loaded is refused, and any other write creates the resource. Resources marked [`sharedToLineage`](/docs/resources/storage#session-scope-and-background-work) aren't affected: the new session never sees those writes.

**Listing sessions:**

```ts
const list = await fsd.sessions.list({ flowKind: "my-app" });
// The client's own user's sessions, newest first.
// Each entry includes id, flowId, title, description, tags, createdAt, updatedAt.
// `flowId` is the instance that owns the session; pass `flowId` instead of
// `flowKind` to list one copy of a multi-copy flow.

// Sessions dispatchers ran work in come back too when you ask for them.
const withRuns = await fsd.sessions.list({
  flowKind: "my-app",
  include: "dispatch-runs",
});
```

A row a dispatcher started carries `parentSessionId`, the conversation it was
started from, along with its `topic` and `coordinate` labels. Rows belonging to
another principal, organization or tenant are absent either way.

`list` returns the client's own user's sessions unless you pass another `userId`. A server with sign-in returns only the signed-in user's sessions either way.

### Listing one flow's sessions

Where a flow's sessions are filed depends on how the flow was declared, so `sessionQueryFor` reads the flow list and builds the right filter:

```ts
import { sessionQueryFor } from "@flow-state-dev/client";

const flows = await fsd.flows();
const rows = await fsd.sessions.list(sessionQueryFor("engineer-a", flows));
```

It returns `{ flowId: address }` for a copy of a collection flow and `{ flowKind: address }` otherwise. An address missing from the flow list is treated as a single-copy flow's kind. Spread it into `fsd.sessions.list` alongside any other filter.

### Dispatched runs

Some flows start work that outlives the turn that kicked it off. A long research pass, a document being drafted, a job that runs for an hour. Work like that runs in a session of its own, a *dispatch run*, so it never shows up in the requests of the session the user is in. `fsd.sessions.list` with `include: "dispatch-runs"` finds those runs across the flow; `fsd.sessions.children` asks one session which runs were started from it, returning one `ChildSessionSummary` per run.

[Work that outlives the turn](/guides/background-work) covers where these sessions come from and how they differ from the other things the docs call background work; [Dispatched work](/docs/server/background-work) is the HTTP surface underneath the two calls below.

```ts
const runs = await fsd.sessions.children("sess_1");

for (const run of runs) {
  console.log(
    run.id,
    run.topic ?? run.id,
    run.status ?? "not started",
  );
}
```

Each row is a `ChildSessionSummary`:

```ts
type ChildSessionSummary = {
  id: string;               // the run's own session id
  parentSessionId: string;  // the session it was started from
  createdAt: number;
  updatedAt: number;
  flowId?: string;          // the instance that owns the run; absent on a row that records no owner
  topic?: string;
  coordinate?: string;
  status?: "active" | "completed" | "failed" | "incomplete" | "aborted";
};
```

That is the whole row. The server sends this named field set rather than a session record, so there is no `flowKind`, `userId` or `title` on it. `flowId` is the address to read the run through when it was dispatched into another instance.

Paging is `{ limit, offset }`: `limit` runs 1–100 and defaults to 25, `offset` runs 0–10000.

A run's `id` is a session id, so hand it to any session read:

```ts
const [run] = await fsd.sessions.children("sess_1");

if (run) {
  const requests = await fsd.sessions.requests(run.id);
}
```

**What `status` tells you.** It's the last state the server recorded for the work, not a check on what's happening right now. `active` asserts only that the work hasn't finished: queued, mid-run, and paused waiting for a person all read `active`, and so does a run whose worker died, until the server records otherwise. The [server reference](/docs/server/background-work#what-status-tells-you) covers each terminal value and what a task board does to it.

A row whose session has had no run dispatched into it carries no `status` at all. Don't fold that absence into one of the five values. Your own label for it, like "Not started", is fine; mapping it to `active` claims a run is pending when none has been dispatched.

`topic` and `coordinate` are optional too. `topic` is the key the run's session was derived from, `coordinate` the entry it was dispatched to. Both are display labels; nothing identifies or authorizes from them. Whether `topic` reads well depends on what the flow keyed on: a document id or an issue key is legible, a task-board worker's composed key is not. The session id is the one field always there, so fall back to it rather than to a made-up name:

```tsx
<li>
  <span>{run.topic ?? run.id}</span>
  <span>{run.status == null ? "Not started" : run.status}</span>
</li>
```

**An empty list and an error mean different things.** A session that started nothing resolves to `[]`. A session id that doesn't exist, or one the caller isn't allowed to read, rejects with [`ClientHttpError`](/docs/api/client#clienthttperror). So `[]` means there is none, not that the lookup failed.

**There is no call that starts one.** Whether work is dispatched at all is the flow author's decision, declared on the server when the flow is wired up. From the client you read what exists.

## State snapshots and clientData

A state snapshot carries `clientData`: values the flow computes from its state and resources and chooses to expose. That is the only data a client sees. Raw state never reaches it.

Read a snapshot once a request has completed for the final state. The stream gives you live updates; the snapshot is the authoritative picture.

## Resources

`fsd.resources` reads and writes a session's resources. Collection resources page: `listCollectionItems` returns a page of item state, and `getCollectionItemState` reads one item by topic. `getResourceManifest` describes every public resource on a session's flow.

```ts
const page = await fsd.resources.listCollectionItems(sessionId, "notes", { limit: 50 });
const note = await fsd.resources.getCollectionItemState(sessionId, "notes", "launch-plan");
```

See [Client access](/docs/resources/client-access) for what a flow lets a client see and write, [Resource Collections](/docs/resources/collections#lazy-state-by-default) and [Resource Manifest](/docs/resources/manifest) for the model, and [React](/docs/client/react#resource-collection-hooks) for the hooks.

## Transcription

For voice flows, `fsd.transcribe` sends audio to the server and returns the text:

```ts
const { text } = await fsd.transcribe({ audio: audioBlob, mediaType: "audio/webm" });
await fsd.flow("voice-chat").send("reply", { text }, { sessionId });
```

## What the client handles

- **Resume from a cursor.** Pass `startingAfter` (or `lastEventId`) to a request stream; the server replays what you missed and continues.
- **Duplicate events.** A sliding window (`dedupWindowSize`, default 1000) drops events it has already delivered.
- **Session streams reconnect.** `fsd.sessions.stream` retries with backoff on its own. A request stream doesn't; reopen it with `startingAfter`.
- **One transport.** Every call and stream goes through the client's `fetcher`, so credentials and in-process dispatch apply everywhere.

## Requirements

- `userId` is required. It's the user every call acts as.
- The server must be running with your flows registered.
- If the client and server are on different origins, the server's CORS settings must allow the client's origin.

## See also

- [Client options](/docs/configuration/client): `baseUrl`, `apiPath`, `fetcher` and credentials
- [Streaming](/docs/streaming/overview): item types, the SSE protocol, resume
- [Client > React](/docs/client/react): React hooks that wrap this client
- [API Reference: client](/docs/api/client): the full surface
