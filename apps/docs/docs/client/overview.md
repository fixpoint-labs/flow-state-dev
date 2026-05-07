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
  baseUrl: "/api", // optional, defaults to same origin
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

## Session management

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient({ baseUrl: "/api" });
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
