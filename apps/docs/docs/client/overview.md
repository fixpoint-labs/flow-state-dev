---
sidebar_position: 1
---

# Overview

`@flow-state-dev/client` is an isomorphic API client for flow-state.dev. It works in Node, the browser, and edge runtimes. No React dependency. No DOM. Just HTTP and SSE.

If you're building a React app, see [Client > React](/docs/client/react). The React package wraps this client with hooks and renderers. This page covers direct client usage — for headless scripts, non-React UIs, or when you want full control.

## createClient

The basic client is dynamic. You specify flow kind and user, then call actions by name.

```ts
import { createClient } from "@flow-state-dev/client";

const client = createClient({
  flowKind: "my-app",
  userId: "user_1",
  // baseUrl: "https://api.example.com", // only when the API is on another origin
});

const { requestId } = await client.sendAction("chat", { message: "Hello" });
```

`sendAction` returns a `requestId`. Execution is async. The server returns `202 Accepted`; the real work happens in the background. Connect to the stream to receive results.

## createTypedClient

For type safety, use a typed client generated from your flow definition:

```ts
import { createTypedClient } from "@flow-state-dev/client";
import myFlow from "./flows/my-app/flow";

const client = createTypedClient({
  flow: myFlow,
  userId: "user_1",
});

const { requestId } = await client.actions.chat({ message: "Hello" });
```

Action names and input shapes are checked at compile time. The typed client also exposes `sendAction` if you need it.

## Stream connection

Subscribe to a request's SSE stream with `createSSEClient`:

```ts
import { createSSEClient } from "@flow-state-dev/client";

const stream = createSSEClient({
  url: `/api/flows/my-app/requests/${requestId}/stream`,
  onItemAdded: (event) => {
    // New item (message, reasoning, component, etc.)
  },
  onContentDelta: (event) => {
    // Text chunk for streaming items
  },
  onRequestStatus: (event) => {
    if (event.status === "completed") {
      // Refetch state snapshot for authoritative final state
    }
  },
  onSessionMetadataChanged: (event) => {
    // Title, description, or tags updated (e.g. by sessionTitleGenerator)
    console.log(event.title);
  },
});
```

The client handles reconnection, resume from cursor, and event assembly. Pass `Last-Event-ID` or `starting_after` in the URL to resume after disconnect. The server replays missed events, then continues live.

If you'd rather have those events folded into a ready-to-render item list than handle each callback yourself, pass `createRequestStreamStore()` through `bindStoreToCallbacks` — the same accumulator the React hooks use, available to any non-React consumer. See [Stream state store](../api/client.md#createrequeststreamstore-and-bindstoretocallbacksstore-options) in the API reference. On React you don't need it; `useSession` and `useRequestStream` wrap it for you.

## Session management

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient();
```

**Creating sessions with metadata:**

```ts
const session = await sessions.createSession({
  flowKind: "my-app",
  userId: "user_1",
  title: "Sprint planning",          // optional
  description: "Q2 kickoff session", // optional
  tags: ["planning", "sprint-12"],   // optional
});
```

Sessions expose `title`, `description`, and `tags` as first-class fields — separate from workflow state. They show up in session lists and are useful for building conversation history UIs.

**Updating metadata after the fact:**

```ts
await sessions.updateSessionMetadata("sess_1", {
  title: "Revised title",
  tags: ["updated"],
});
```

Fields are merged — only the fields you include are changed. Omitting `title` leaves the existing title untouched.

**Fetching session state:**

```ts
const snapshot = await sessions.getSessionState("sess_1", {
  includeItems: true,
  clientData: ["session.artifactsList", "user.preferences"],
});
```

`getSessionState` returns state snapshots with clientData. Use `includeItems` to get the session item log. Specify which clientData keys you need.

**Listing sessions:**

```ts
const list = await sessions.listSessions({ flowKind: "my-app" });
// Each entry includes id, title, description, tags, createdAt, updatedAt
```

The typed client includes a session client when created with a flow. Use it for creating sessions, listing requests, and fetching state.

### Child sessions

Some flows start work that outlives the turn that kicked it off. A long research pass, a document being drafted, a job that runs for an hour. Work like that runs in a session of its own hanging off the one the user is in, so it never shows up in the parent session's own requests. `listChildSessions` asks a session what ran under it.

[Work that outlives the turn](/guides/background-work) covers where these sessions come from and how they differ from the other things the docs call background work; [Dispatched work](/docs/server/background-work) is the HTTP surface underneath the two calls below.

```ts
const children = await sessions.listChildSessions("sess_1");

for (const child of children) {
  console.log(
    child.id,
    child.topic ?? "untitled",
    child.status ?? "not started",
  );
}
```

Each row is a `ChildSessionSummary`:

```ts
type ChildSessionSummary = {
  id: string;               // the child's own session id
  parentSessionId: string;
  createdAt: number;
  updatedAt: number;
  topic?: string;
  coordinate?: string;
  status?: "active" | "completed" | "failed" | "incomplete" | "aborted";
};
```

That is the whole row. The server sends this named field set rather than a session record, so there is no `flowKind`, `userId` or `title` on it.

Paging is `{ limit, offset }`: `limit` runs 1–100 and defaults to 25, `offset` runs 0–10000.

A child's `id` is a session id, so hand it to any session read to drill in:

```ts
const [child] = await sessions.listChildSessions("sess_1");

if (child) {
  const requests = await sessions.listSessionRequests(child.id);
}
```

**What `status` tells you.** It's the last state the server recorded for the work, not a check on what's happening right now. `active` asserts only that the work hasn't finished: queued, mid-run, and paused waiting for a person all read `active`, and so does a child whose worker died, until the server records otherwise. The terminal values are `completed`, `failed`, `aborted`, and `incomplete`.

A child that has never run anything carries no `status` at all. Don't fold that absence into one of the five values. Your own label for it, like "Not started", is fine; mapping it to `active` claims work is under way before it started.

`topic` and `coordinate` are optional too. `topic` names the body of work, `coordinate` names the entry running it. Both are display labels — nothing identifies or authorizes from them — and a row can arrive without either. Guard all three with `== null`:

```tsx
<li>
  <span>{child.topic ?? "Untitled work"}</span>
  <span>{child.status == null ? "Not started" : child.status}</span>
</li>
```

**An empty list and an error mean different things.** A session that started nothing resolves to `[]`. A session id that doesn't exist, or one the caller isn't allowed to read, rejects with [`ClientHttpError`](/docs/api/client#clienthttperror). So `[]` means there is none, not that the lookup failed.

**There is no call that starts one.** Whether work runs in a child session is the flow author's decision, declared on the server when the flow is wired up. From the client you read what exists.

## State snapshots and clientData

State snapshots include `clientData` — derived values computed from state and resources. clientData is the sole data gateway to clients. Raw state never reaches the client.

Request a snapshot after `request.completed` for the authoritative final state. The stream gives you live updates; the snapshot gives you correctness.

## Resource methods

Collection resources expose paginated read methods on the resource client: `listCollectionItems` returns a page of item state, `getCollectionItemState` fetches a single item by topic. A separate `getResourceManifest` returns the static description of every public resource on a session's flow. See [Resource Collections — lazy state](/docs/resources/collections#lazy-state-by-default) and [Resource Manifest](/docs/resources/manifest) for the full mental model and React hook surface in [client/react](/docs/client/react#resource-collection-hooks).

## Transcription helper

For voice flows, the client exports a transcription helper:

```ts
import { transcribe } from "@flow-state-dev/client";

const result = await transcribe(audioBlob, { /* options */ });
```

Use this to convert user audio to text before sending to an action.

## What the client handles

- **Reconnection** — Automatic retry with configurable backoff.
- **Resume from cursor** — Pass `Last-Event-ID` or `starting_after`; the server replays and continues.
- **Event assembly** — Dedup by sequence number. Sliding window (`dedupWindowSize`, default 1000) avoids duplicates on reconnect.
- **Request lifecycle** — `request.created`, `request.in_progress`, `request.completed` / `.incomplete` / `.failed`.

## createClient vs createTypedClient

| | createClient | createTypedClient |
|--|--------------|-------------------|
| Action calls | `sendAction("chat", input)` | `actions.chat(input)` |
| Type safety | Runtime only | Compile-time + runtime |
| Best for | Generic UIs, devtools, scripts | App code with known flow |

## Requirements

- `userId` is required for action and session calls in Phase 1.
- The server must be running and registered with your flows.
- For streaming, ensure CORS allows your origin if client and server differ.

## See also

- [Items](/docs/streaming/overview) — Item types, audiences, emitting
- [Streaming](/docs/streaming/items) — SSE protocol, event types, resume semantics
- [Client > React](/docs/client/react) — React hooks that wrap this client
- [API Reference: client](/docs/api/client) — Full API surface
