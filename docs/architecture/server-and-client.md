# Server and Client Integration

This document covers how the server, client, and React packages work together to deliver the full-stack framework experience.

## Package Responsibilities

### `@flow-state-dev/engine`

Server-side runtime. Handles:
- Flow registration and discovery
- Action execution orchestration
- SSE streaming with resume support
- State persistence (in-memory, filesystem, SQLite, and Postgres adapters)
- Retry/rescue/work execution semantics

### `@flow-state-dev/client`

Isomorphic HTTP client. Handles:
- Action invocation via HTTP
- SSE request-stream consumption
- Session management (create, list, load)
- Reconnection and resume logic

**No React or DOM dependency.** The React package wraps this for transport.

### `@flow-state-dev/react`

React UI layer. Handles:
- Hooks wrapping `@flow-state-dev/client`
- Reactive session-first state management
- Item rendering via registered components
- Context providers

**No transport logic.** All HTTP/SSE goes through `client`.

## Server Setup

### Flow Registration

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";
import flow from "./flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(flow);

const router = createFlowApiRouter({ registry });
```

The registry indexes by exact instance id: a singleton by its kind, a collection member by its own id, and a collection's bare kind by nothing. See [flows-and-actions](./flows-and-actions.md#flowtype-and-flowinstance) for the declaration contract.

### Next.js Catch-All Route

```ts
// app/api/flows/[...path]/route.ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
// Register flows...

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

### Canonical Endpoints

The route table below is produced by the built-in HTTP transport adapter
(`createHttpTransportAdapter`), which `createFlowApiRouter` mounts onto an
`InboundTransportHost` internally. Custom transports (MCP, webhook, scheduled,
custom) mount alongside it via the `adapters` option — see
[`docs/architecture/inbound-transports.md`](./inbound-transports.md).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/flows` | List registered flows |
| GET | `/api/flows/capabilities` | `{ userStream: false, push }`: `push` is `{ transport: "websocket" }` once a host turns push delivery on (`serve()`), else `null` |
| POST | `/api/flows/users/:userId/stream` | Push mint (FIX-2428): checks each topic, answers a 30 s ticket for the granted ones |
| GET | `/api/flows/users/:userId/stream` | The push socket, taken as an upgrade by the host; a plain GET answers 426 |
| POST | `/api/flows/:flowId/actions/:action` | Execute action (new session) |
| POST | `/api/flows/:flowId/:sessionId/actions/:action` | Execute action (existing session) |
| POST | `/api/flows/:flowId/views/:viewName` | Run a user or org view with no session: `200 { output, topics }`, stored nowhere. The caller comes from the flow's own resolver ([Views](./flows-and-actions.md#views)) |
| POST | `/api/flows/:flowId/:sessionId/views/:viewName` | Run a session view on an existing session: `200 { output, topics }`. Fenced as the action route; it never creates a session ([Views](./flows-and-actions.md#views)) |
| GET | `/api/flows/:flowId/requests/:requestId/stream` | SSE request stream |
| GET | `/api/flows/sessions` | List sessions (`flowKind` and exact `flowId` filters) |
| GET | `/api/flows/sessions/:sessionId` | Session detail (projected: `state` holds only `session.client.expose` and readonly fields; no journal or stored resources) |
| GET | `/api/flows/sessions/:sessionId/requests` | Session requests |
| GET | `/api/flows/sessions/:sessionId/state` | State snapshot |
| GET | `/api/flows/sessions/:sessionId/stream` | SSE session stream (every request's finished items, unfinished runs) |
| POST | `/api/flows/:flowId/sessions` | Create session |
| DELETE | `/api/flows/sessions/:sessionId` | Delete session |
| POST | `/api/flows/blobs` | Upload one attachment as the raw body (`content-type` is its type, `filename` query optional); `201 { attachment }` with `data: "fsd-blob:<id>"`. Checked by the host's resolver |
| POST | `/api/flows/:flowId/blobs` | The same upload, checked by that flow's own resolver, so the file is held for the user its sends resolve |
| GET | `/api/flows/blobs/:blobId` | The file's bytes, to a caller who can read the session that owns it, or, for a file a person's own scope keeps (a task's brief), to that person; any other caller gets 404. Images inline, other types as a download, always `nosniff` |

Every route that answers with a session record (detail, listing, create, metadata edit) sends it projected the same way. Scope state is private by default, so a client receives only the fields the flow exposes, plus its readonly fields: those are the session's identity, set at create and already a listing filter. Server-side code that needs the whole record reads the session store.

`:flowId` is the instance id (a singleton's kind, a collection member's own id). Every session and request records its owner as `flowId` beside the definition's `flowKind`, and every response that projects a session or request (`GET /api/flows` entries also carry `cardinality`) includes `flowId`. Routes that name a flow and a record check the two agree before the resolver runs (`409 wrong-instance-session` / `wrong-instance-request`, or `409 migration-required` for an ownerless record under a collection kind); routes that name only a record resolve the governing flow — whose resolver authorizes the read, and which decides the anonymous-listing filter (`anonymousFlowIds`) — from the record's owner. Retry, continue, resume, and interrupted-request recovery re-enter the recorded owner. Clients bind an instance id in `flowKind` and re-enter through the `flowId` on the records they hold.

### Custom Model Resolution

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";
import { createModelResolver } from "@flow-state-dev/core/models";

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
});
```

### Store Configuration

```ts
import { createFlowApiRouter, createFilesystemStores, createInMemoryStores } from "@flow-state-dev/engine";

// Default when no `stores` is passed: in-memory (dev/test only).
// For production use SQLite (single server) or Postgres (multi-instance);
// the filesystem store is for local development, not production load.
const router = createFlowApiRouter({ registry });

// Testing: in-memory
const router = createFlowApiRouter({
  registry,
  stores: createInMemoryStores(),
});

// Optional runtime safeguard for long-lived servers
const guardedRouter = createFlowApiRouter({
  registry,
  maxResponseBufferSize: 10_000,
});
```

### Session Retention Policies

Retention policies bound the size of a session's persisted item log. Configured on the flow's `session` block, they evict old past turns (completed requests, and requests a dead host left `interrupted`: the same set the history view reads) when limits are exceeded.

```ts
defineFlow({
  kind: "my-flow",
  session: {
    retention: {
      maxItems: 500,  // total items across all past turns
      maxAge: "24h",  // duration string or milliseconds
    },
  },
  actions: { /* ... */ },
});
```

- Both `maxItems` and `maxAge` are optional. When both are set, either triggers eviction.
- Eviction is lazy (runs after each completed request). No background process.
- Operates at **request granularity** — entire old requests are removed, not individual items.
- The current request is never evicted. Failed requests are not eviction candidates.
- A request is not evicted until its run has finished, `onFinished` included (a `suspended` request never finishes a run and is never evicted; retention evicts only completed and interrupted requests), and twice the live-tail liveness timeout (`LIVE_TAIL_LIVENESS_MS`, 30s by default, so 60s) has passed since. Its record turns terminal before its run finishes writing, and a live stream may still be following it; evicting it earlier frees a caller-supplied id while either is active. The run marks its record `finalizedAtMs` as its last write, after `.sideChain()` work its hooks queued has settled, and retention waits for that mark rather than for a length of time, because `onFinished` has no time limit and another process's run is invisible to this one. The mark is fenced on the record's `incarnation`, so it never lands on a request that took the id since. When two runs of one request overlap (a `/continue` started after the sweep took a slow but live run for dead), only the last of them to end in this process marks the record and removes the shared active-registry entry; an overlapping run in another process is judged by its heartbeat, as the sweep already does. A run that dies before marking it, or whose late writes failed to flush, or whose mark the store refused three times, is marked by the stale-request sweep, but only when the run was heartbeating through its tail (a completed run with heartbeats on): with heartbeats off (`request.heartbeatIntervalMs: 0`) a stale entry proves nothing, so such a record is marked only by its own run, and is kept for good if that run is gone. With the sweep disabled, such a request is kept too. **Rollout safety:** a record with no `finalizedAtMs` field at all was written by a version that never marks, and during a rolling deploy its run may still be finishing on an old instance. It is kept until the stale-request threshold (60s, or the host's `staleSweepThresholdMs` if longer) or `maxAge`, whichever is larger, plus the window, has passed since it completed. A request spared this way is evicted when the session's next request completes, so a session can sit above its limits until then. Its items still count toward `maxItems` while it waits, so older history is evicted to make room for them.
- An `interrupted` request is evicted like a completed one, aged from when it was found interrupted (`interruptedAt`). One the stale sweep marked has no run left to stamp `finalizedAtMs`, so it is held for the rollout-safety bound above, counted from `interruptedAt`. An interrupted request parked on a gate that drives it again (pending, or resolved and owed a re-drive) is not dead (the same id runs again), and is never evicted, though its items still count toward `maxItems`; like the history view and a stop, retention reads its gates through the host's durability provider (`parkedInterruptedIds`). A gate read that fails ends the pass with nothing deleted.
- For items that should never be stored, use `transient: true` on block definitions instead.

## Client Setup

### One client

`createClient` holds the user and the transport; flows, sessions, resources
and requests hang off it. The transport is a URL over HTTP, or the engine's
`createInProcessFetch(flowState)` as the `fetcher`, which reaches the engine in
the same process with no web server. Every call and stream goes through that
one fetcher.

```ts
import { createClient } from "@flow-state-dev/client";
import type { helloChat } from "./flows/hello-chat";

// Browser, same origin, no base path: `baseUrl: ""`. In Node, pass an absolute
// URL ("http://localhost:3000", plus any base path). The client adds
// `/api/flows` itself; don't include it. Canonical rule:
// apps/docs/docs/configuration/client.md → "Choosing baseUrl".
const fsd = createClient({ baseUrl: "", userId: "devuser" });

// Untyped
await fsd.flow("hello-chat").send("chat", { message: "Hello!" });

// Typed: the flow's type, imported as a type only
const sent = await fsd.flow<typeof helloChat>("hello-chat").send("chat", { message: "Hello!" });

// The request: status, wait, result, abort, continue, retry, resume, stream
// result() is wait()'s polls by id, each asking for the stored answer; the settling read is returned.
const { status, output, error } = await sent.result({ timeoutMs: 30_000 });
for (const lost of await fsd.requests.interrupted()) await lost.continue();
```

### Attachments

A file is uploaded once and sent by reference. `upload` resolves to a
`FileContent` whose `data` is `fsd-blob:<id>`; put that in a message, never the
bytes. An action request names its files in a top-level `attachments` array
beside `input`, and the action route claims them into the turn's session before
any block runs: all or nothing, refused by name when a file is not the caller's
or was already sent with another conversation, and handed back if the send is
then refused. Until a send claims it, a file is held for its uploader, and an
unclaimed upload is swept after 24 hours. Use the flow's own `upload` when the
flow authenticates its callers, so the uploader is the user its sends resolve.

```ts
const file = await fsd.flow("hello-chat").upload({ data: blob, filename: "plan.pdf" });
// file.data === "fsd-blob:<id>"
await fsd.flow("hello-chat").send("chat", { message: text }, { sessionId, attachments: [file] });
// React: sendAction("chat", { message: text }, { userMessage: text, attachments: [file] })
```

The action route's parse step checks the files once, for every flow, before it
claims them: the action must have a `userMessage`, since files go on the
person's line (`attachments_not_accepted` otherwise), each file must name the
type it was uploaded as, and the message must be within
`ATTACHMENT_LIMITS` (`attachmentLimitRefusal` in
`@flow-state-dev/contracts/attachments`: `attachment_limit`,
`attachment_type_refused`). The run then writes a `file` part per file after
the text on the user line, in reference form, records them on the request, and
shows them to blocks as `ctx.request.attachments`; a flow's input schema never
sees them.

The session's history keeps the files as references
(`engine/src/context/history-files.ts`): the turns are chosen on references,
then, counting back from the newest line, files up to one message's limits are
kept and older ones named. Only two places read bytes, and both read them at
the moment they hand them on. The first is the model call: the run's
`ModelResolver.prepareMessages`, which a generator applies to every call
(`core/src/models/prepared-model.ts`), reads each file through
`resolveAttachment` and sends it inline as an image or file part. The second
is a coding harness's turn. `HarnessRunInput.attachments` carries the turn's
files as references only, and its schema refuses bytes. The engine fills
`ATTACHMENT_SEAM` on the block's context
(`engine/src/context/createExecutionContext.ts`) with the same read-once
resolver, bound to the request's session and person. A harness reads
through `readHarnessAttachments`, so it can read only that session's files.
Before it starts anything, a harness refuses a turn whose file is a type its
`accepts` doesn't list and that has no text to send in its place, or whose
file can't be read. A server with no blob
store has no reader, so every turn with files is refused there. Everything a
run records of its conversation (a generator's trace of its history, a tool
loop's prelude, a harness turn's input) therefore holds references, never
bytes. An older file is
named on its turn as `[image: shot.png, not re-sent]`, and one
that can no longer be read as `no longer available`; a reference never reaches
a provider. Re-sent files are billed as input on every call; prompt caching is
what keeps that cheap.

A generator that installs `attachmentsCapability` (`@flow-state-dev/core/attachments`,
beside `recordAttachments`) reads its history with `ItemQuery.earlierDocuments:
"named"`: an earlier turn's document is not re-sent but named with its id
(`[document: q3.pdf, id b_…, not re-sent; read it with readAttachment]`), and
images keep the window. The capability's context lists the session's newest
documents from the `attachments` list; its `readAttachment` tool takes an id or
a name (matched against the whole list) and reads through `ATTACHMENT_SEAM`, so
a file not this session's answers "not in this conversation". The tool's output,
recorded on its `tool_output` item, is the file's reference only. The model call
resolves a tool result whose output is a document's reference to its text
(`resolveHistoryFiles`), on every step of that turn's tool loop; a later turn's
history replays the reference, not the text.

A document reaches each target as that target reads it
(`attachmentSentAs` in `@flow-state-dev/contracts/attachments`). A text-like
file (text, Markdown, CSV, JSON, YAML, HTML, XML, source) always goes as text
headed `### <filename>`. A PDF goes as a file part where the target's
`accepts` lists `application/pdf` (a generator's comes from its model's
provider, `core/src/models/attachment-accepts.ts`; Claude Code's lists it),
and as its extracted text everywhere else (Codex, Cursor, a provider not in the
table). The provider is `ModelResolver.providerOf`'s answer for the model
string, else `extractProviderName`'s guess, so an app resolver that maps its
own aliases sends PDFs as text unless it also maps `providerOf`; a
`GeneratorModel` instance names no target and gets PDFs as files, as before.
The upload route checks a document before it stores it: a text-like
file is UTF-8 with no NUL bytes and at most `maxTextBytes` (`attachment_text_too_large`,
`attachment_not_text`); a PDF opens and has at most `maxPdfPages` pages,
counted from its page tree (`pdf_too_many_pages`, `pdf_unreadable`). The same
pass extracts the PDF's text page by page, a page with no text layer saying
so, and stores it beside the PDF under `pdfTextBlobId`
(`engine/src/blobs/pdf-text.ts`); a claim takes it with the PDF into the same
owner, so it is read where the PDF is and deleted with it. Both readers get a
document's text through `readAttachmentText` (`engine/src/blobs/attachment-text.ts`),
which refuses a PDF's text over `maxTextBytes` with `pdf_text_too_large`
before the target is called; a harness splits its turn with
`readHarnessTurnFiles`. Text is never cut.

A file can also outlive the turn it came with. A record kept at the user scope,
such as a task's brief on a conversation's board, keeps copies of the turn's
files through `keepAttachmentsForUser` (`core/internal`), which the engine
answers under `USER_ATTACHMENT_SEAM`: each file is read through the same
resolver, stored again under a new id, and claimed into the user's own scope
(`userBlobOwner`, whose key also names the flow instance that kept it). The
copy and the turn's file have separate owners, so deleting the conversation
leaves the copy. A run reads its session's files and its user's own scope's,
whichever flow kept them, so every run of a task, in whatever session or flow,
reads the brief's files, and nobody else's run does. The read route checks the
caller under the keeping flow's sign-in, since its address names no flow. An action hands such files
to the line it writes through `userMessage`'s `attachments`, read off
server-held state; they follow the person's own files on that line.

### Sessions

A listing with no `userId` is the client's own user's sessions.

```ts
const list = await fsd.sessions.list({ flowKind: "my-app" });
const detail = await fsd.sessions.get(sessionId);
const snapshot = await fsd.sessions.state(sessionId, {
  includeItems: true,
  offset: 0,
  limit: 100,
});
```

#### Background work (child sessions)

A child session is where work that outlives the turn runs. Reading one is
two hops: `fsd.sessions.children` for the rows, then `fsd.sessions.requests`
with a row's `id` for that work's own history. Whether
work runs in a child session is declared by the flow author — the client has
no way to request it.

```ts
const children = await fsd.sessions.children(parentSessionId, {
  limit: 25,
  offset: 0,
});

// One request for the whole list — the row carries what a list renders.
for (const child of children) {
  render(child.topic ?? child.id, child.status ?? null);
}
```

`ChildSessionSummary` is `{ id, parentSessionId, createdAt, updatedAt, topic?,
coordinate?, status? }` — a named field set, not a `SessionSummary`.

- **`status`** is `"active" | "completed" | "incomplete" | "failed" | "aborted"`,
  and is **absent** when the child session has not run anything yet. `"active"`
  means *not finished* and nothing more: it does not separate running from
  queued from paused waiting for a person, and it is the last state the server
  recorded rather than a liveness check. It is its own `ChildSessionStatus`
  union rather than `RequestStatus` — that union's run states
  (`"in_progress"`, `"suspended"`, `"interrupted"`) collapse into `"active"`
  and can never appear here, so reusing it would hand consumers an exhaustive
  switch over branches that cannot fire. A finer breakdown arrives later as a
  separate optional field, never as new members of this union.
- **`topic` / `coordinate`** are display-only labels — the key the child was
  derived from, and the `<type>:<target>` entry it was dispatched to. They
  route, authorize and identify nothing, and are absent on any session that
  is not dispatched work.
- Every optional field is `== null`-guarded by consumers (BP-030).

The client's one piece of filtering is a compatibility check: a row whose
`parentSessionId` does not match the requested parent is dropped rather than
relabelled as that conversation's background work. Authorization is the
server's, resolved from the stored parent record (BP-031).

### Streams

A request's stream, through the same client and fetcher as every other call:

```ts
const stream = fsd.flow("hello-chat").request(requestId).stream({
  onItemAdded: (event) => { /* handle new item */ },
  onContentDelta: (event) => { /* handle text chunk */ },
  onRequestStatus: (event) => {
    if (event.status === "completed") { /* refetch state */ }
  },
});
```

### Change notices

A change notice (`WireNotice`) says that something under a topic changed: its
topic, its kind, the request that made it, and, when the publisher held them,
the `ids` of what changed (FIX-2625). Never a row. Publishers add the ids they
already hold: a task on a `board` notice, a collection entry's storage key on
its `resource` notice (beside the path that names it, and only when the path
may be named, so an owner-private row and a user-scope entry name neither), a
child session on the `run` notice its parent session hears, and a request on
its session's `request` notice. The `run` notice on a user's own topic names
nothing: that topic is the user's in every org, and the mint grants it by user
and tenant alone, so a session id there would reach their screens in another
org. `items`, `state` and `resync` name nothing. Ids are hints: a reader that
can't use them reads everything, and a client from before them ignores the
field.

Three points every notice passes, so each rule lives once:

- **The publish queue** (`publishNotices`, `bus/publish-writes.ts`) folds one
  turn's notices by topic, kind and origin and unions their ids; the client's
  one merge (`live/coalesce.ts`) does the same for notices waiting on a read.
  Both call `unionNoticeIds`: no ids beats ids, and past `NOTICE_MAX_IDS`
  (100) a notice names none and means read everything. Notices of different
  topics or kinds still merge to `null`. Ids read off a wire (a socket frame,
  a Postgres payload) go through `noticeIdsOf`: anything but a list of strings
  is dropped, never the notice.
- **The bus.** The in-memory bus hands the notice over whole. The Postgres
  bus carries ids in its `NOTIFY` payload and, past 8000 bytes, drops them
  before it widens the topic. It decides nothing about what a browser sees.
- **The push edge** (`push/socket-session.ts` `hear`). `noticeIds` on
  `createFlowState` or `createFlowApiRouter` turns ids off per topic scope
  (`{ org: false }`); every push edge of the app reads it. With ids off, the
  scope's notices go out with no `ids`, and every `resource` notice reaches a
  scope-wide subscription on the bare scope topic, so no entry key reaches a
  browser there. Every one, not only those whose ids mark an entry: a process
  from before ids, mid-deploy on a shared bus, sends an entry's path with no
  ids, and the edge can't tell that path from a single resource's name. A
  subscription narrowed to the resource keeps its path, since its client named
  it. Every full read stays: connect, reconnect, `resync`, a poll tick and a
  bus that doesn't cross processes all reach a reader as `null`.

## React Setup

### FlowProvider

```tsx
import { FlowProvider } from "@flow-state-dev/react";

function App() {
  return (
    <FlowProvider
      flowKind="hello-chat"
      userId="devuser"
      renderers={{
        message: MessageComponent,
        reasoning: ReasoningComponent,
        component: {
          "my-chart": ChartComponent,
        },
      }}
    >
      <ChatUI />
    </FlowProvider>
  );
}
```

### Hooks

**`useFlow`** — Session lifecycle management:

```tsx
const { sessions, activeSessionId, createSession, selectSession } = useFlow();
```

**`useSession`** — Primary hook for session data and actions:

```tsx
const {
  detail, items, isStreaming, isFinishing, sendAction, refresh,
  childSessions, childSessionsStale
} = useSession(sessionId);

await sendAction("chat", { message: "Hello!" });
// isFinishing: true when main chain is done but background .sideChain() tasks are still running.
// Use (isStreaming && !isFinishing) to block UI only during main chain execution.
```

**Background work (`childSessions`)** — a second axis beside `items`, carrying
the child sessions running under this session as `ChildSessionSummary` rows from
`client`. This layer re-exports the client's row type and names no field shapes
of its own; nothing is merged into `items`, and no transport shape is decided
here.

The axis is **interaction-scoped by default**. It is read on mount, at the
**start** of every work-starting call on the returned view (`sendAction`,
`resumeLatestRequest`, `resumeSuspension`, `continueRequest`), and by `refresh`
— which now covers this axis as well as the snapshot. There is deliberately no
polling: the launching turn's stream is request-scoped and closes when the turn
ends, while the work outlives it. The read is therefore anchored to a local
fact — this hook dispatched the interaction — so no board option, dropped
connection or `items: false` can remove it. The cost is one child-session read
per turn, independent of task-board activity.

A view that sets `live: true` also re-reads it on the session stream's
run-changed notice (`GET /sessions/:sessionId/stream`), through the same
guarded read, so the generation and sequence guards below cover both. The
notice names the unfinished runs, and the hook keeps any the page lacks, so an
unfinished run older than the page still shows.

Reads are guarded twice, because the two hazards are different. A **generation**
advances whenever the read identity changes — the session id or the session
client, which is rebuilt when `baseUrl` changes — and retires responses from a
superseded identity. A per-read **sequence** orders reads *within* one identity,
since the mount read, an action-start read and a manual `refresh()` share a
generation and can be in flight together; an older response is discarded rather
than allowed to overwrite newer rows or regress a terminal row to `active`.

A failed re-read keeps the last known rows and raises `childSessionsStale`,
cleared by the next success. Row status is rendered as received: this package
does not enumerate `ChildSessionStatus`, so an unrecognised value displays
without a change here.

**`useClientData`** — Scope-grouped client data subscriptions:

```tsx
const clientData = useClientData(session, {
  session: ["activePlan", "messageCount"],
  user: ["preferences"],
});
// clientData.session?.activePlan, clientData.user?.preferences
```

**`useAction`** — Low-level action execution:

```tsx
const { execute, loading, error } = useAction({
  flowKind: "hello-chat",
  action: "chat",
  userId: "devuser",
});
```

**`useRequestStream`** — Direct stream access:

```tsx
const { items, status, isStreaming } = useRequestStream({
  requestId,
  filter: { itemTypes: ["message", "component"] },
});
```

### Rendering

```tsx
import { ItemRenderer, ItemsRenderer } from "@flow-state-dev/react";

// Render a list of items
<ItemsRenderer items={items} />

// Render a single item
<ItemRenderer item={item} />
```

The renderer resolves components from `FlowProvider`'s `renderers` prop:
- Class-based types (`message`, `reasoning`, etc.) → one component each
- Parameterized types (`component`, `container`) → sub-key lookup by `item.component`

## Action Execution Flow

```
Client                        Server
  │                             │
  ├─ POST /actions/chat ──────►│
  │   { input, userId }        ├─ validate input
  │                             ├─ create LiveRequestStream
  │◄── 202 { requestId } ──────┤
  │                             ├─ execute block (async)
  ├─ GET /requests/:id/stream ►│
  │◄── SSE events ─────────────┤ (item.added, content.delta, ...)
  │◄── request.completed ──────┤
  │                             │
  ├─ GET /sessions/:id/state ─►│
  │◄── snapshot response ──────┤ (state + clientData)
```

**Phase 1 policy:**
- `userId` is required on every action request
- Framework examples use `userId: "devuser"` as local default
- POST returns `202 Accepted` immediately — execution is async
- Client can pre-generate `requestId` and pass it in the POST body
- The action's result is stored on the request record as `result` (`output`, and/or `error`) in the same write as the final status. `GET /sessions/:id/requests` returns it, with `result.output` only on `include_result_output=true` (every entry carries `hasOutput`). `GET /requests/:requestId/status?include_result_output=true` returns the same projection for one request by its id, the read for a caller that wants one request's answer; without the flag the status snapshot carries no `result`. A missing `result` means unfinished, aborted/interrupted, or a legacy record (BP-030)

## Canonical Authority

This document is authoritative for server and client contracts. For full type signatures, store interfaces, and rendering contracts, refer to the published types in `@flow-state-dev/engine`, `@flow-state-dev/client`, and `@flow-state-dev/react`.
