# Fact sheet: What the browser sees (C-10)

Pass 1. Cites only existing user docs, the exported surface and its doc comments, tests and
`goals/`, and one example. Paths are from the repo root. `apps/docs/docs/client/overview.md` is
written `overview.md` below, `client/react.md` as `react.md`, `configuration/client.md` as
`config-client.md`. Implementation files (`packages/engine/src/...`) were read to confirm what a
call returns; each fact below is what a caller can observe.

The page's example is the support flow (`support`, action `reply`), matching the existing client
docs. `examples/hello-chat/src/app.tsx` is the one runnable example that uses the React half.

## Contradictions to settle before drafting

- **`client.derived` is gone.** `react.md:273` ("Derived projections (declared in
  `client.<scope>.derived`) refresh once at terminal request status"), `state-and-scopes.md:424-444` and `configuration/flow.md:182` still teach
  `derived`. The code throws at `defineFlow` when a scope's `client` declares it: "declares
  "derived", which was removed. Declare a view instead" (`packages/core/src/flow/defineFlow.ts:76-101`).
  The page states `expose` and views, never `derived`. The old pages are wrong on this point;
  report it, do not copy it.
- **Views have no existing user doc.** Grep of `apps/docs/docs` and `apps/docs/guides` finds no
  `useView`. The facts below come from the exported surface, its doc comments, tests and a goal.
  `goals/views/a-screen-watches-a-view/goal.md` records its own `c:inventory` leg as red until
  the removals land, so the removal of `derived` is shipped in `defineFlow` but the goal's
  inventory check was still open on its last verdict. Mark the view facts for reconcile at cutover.
- `react.md:53` and `config-client.md:152` differ in nothing here; both say hooks take
  `flowKind`, `userId`, `baseUrl` overrides, `fetcher` and `apiPath` only from the provider.
  Confirmed in code: `useClient` takes overrides of `userId`, `baseUrl`, `apiPath`
  (`packages/react/src/internal/useClient.ts:17-30`), but `useFlow`, `useAction` pass only `userId`
  and `baseUrl` (`useFlow.ts:61`, `useAction.ts:64`). Config-client's claim holds for the hooks.

## What the client is (Q4: "You are not using React. What do you import?")

1. `@flow-state-dev/client` is how code outside the server talks to flows. It runs in Node, the
   browser and edge runtimes, with no React or DOM dependency. It speaks HTTP and SSE to a server,
   or calls an engine in the same process. `overview.md:7`. `packages/client/package.json` lists no
   `react` dependency or peer (checked with grep: no match). `@flow-state-dev/react` declares
   `react` `^18.0.0 || ^19.0.0` as a peer (`packages/react/package.json:84-85`).
2. `createClient({ userId, baseUrl, apiPath?, fetcher? })` builds a client for one user and one
   server (`packages/client/src/client.ts:56-80`, `:602`). `userId` is required;
   `createClient` throws without it (`client.ts:603`, `requireValue`). `config-client.md:79-84`:
   without `baseUrl` or `fetcher` it throws; `baseUrl: ""` is the page's own origin in a browser;
   in Node pass an absolute URL; the client adds `/api/flows` (`apiPath`) itself.
3. The client is not bound to a flow. `fsd.flow(address)` names one on each call
   (`client.ts:530`; `config-client.md:26`). There is no default flow (`overview.md:28`).
4. `fsd.flow<typeof supportFlow>("support")` types action names and inputs; import the type with
   `import type` so no server code reaches a browser bundle. `overview.md:42-49`.
5. React hooks and `FlowProvider` build their client from the provider's `userId`, `baseUrl`,
   `apiPath` and `fetcher`. Hooks with the same user and transport under one provider share one
   client, so share one push socket (`packages/react/src/internal/useClient.ts:3-11`;
   `FlowContext.ts:28-33`). `react.md:46`: every hook and component under `FlowProvider` calls
   through one client built from `baseUrl`, `apiPath`, `fetcher` and `userId`.
6. A hook with no `userId` from itself or its provider uses `"devuser"`
   (`useClient.ts:15`), but `useAction` throws "useAction requires userId (option or
   FlowProvider)" and "requires flowKind" when either is missing (`useAction.ts:53-59`).

## Three things a page does with a flow

### 1. Call an action

7. `fsd.flow("support").createSession({ title })`, then
   `.send("reply", { text }, { sessionId })` (`overview.md:26-37`). `send` resolves once the
   server accepts the request, usually before the work finishes (`overview.md:40`). `sent.response`
   is `{ status, request, session?, error? }`; `sent` is a request handle you can `wait`,
   `stream`, `abort` or `resume`. Leave out `sessionId` and the server starts a session; its id is
   in `sent.response.session` (`overview.md:40`).
8. `sent.wait()` resolves once the request settles; `final.status` is `"completed"`, `"failed"`,
   `"suspended"` and so on (`overview.md:36-37`). Request handle methods: `status`, `wait`,
   `abort`, `continue`, `retry`, `resume`, `stream` (`overview.md:63-71`).
9. React: `useAction({ flowKind, action, userId?, baseUrl?, result? })` returns
   `{ execute(input, sessionId?), loading, error? }`
   (`packages/react/src/hooks/useAction.ts:12-35`). Without `result: true`, `execute` resolves
   when the server accepts the send (the `ExecuteActionResponse`); with `result: true` it
   resolves to the request's result (`status`, plus `output`, `outputNotRecorded` or `error`) and
   `loading` holds until the request settles (`useAction.ts:17-24`). `execute` rethrows a failure
   and also sets `error` (`useAction.ts:91-95`). An unmount stops the wait, never the run
   (`useAction.ts:22-23`).
10. `useSession(...).sendAction(action, input, { metadata?, userMessage?, attachments? })` is the
    session-bound way to call an action; `userMessage` shows the line at once before the server's
    copy arrives (the `sendAction` member of `SessionView`, `useSession.ts:441-447`). It throws
    "useSession.sendAction requires a sessionId" with no session (`useSession.ts:2195`).
11. The wrong action name or input is a type error with `fsd.flow<typeof flow>`; the server
    still checks the input at run time. Only the first half is shown on `overview.md:44-49`.
    Do not state the second half without a test; it is not on a cited line, so leave it out.

### 2. Follow a session's stream

12. A request's stream carries one request:
    `sent.stream({ onItemAdded, onContentDelta, onRequestStatus, onSessionMetadataChanged })`,
    closed with `stream.close()` (`overview.md:75-97`). If the connection drops, reopen with
    `startingAfter` set to the last sequence number seen; the server replays what was missed, then
    goes live (`overview.md:99`). A request stream does not reconnect on its own
    (`overview.md:334`).
13. `fsd.sessions.stream(sessionId, options?)` follows everything in a session, including requests
    another tab, person or agent sent. It delivers each item once finished, not text as it is
    generated (`overview.md:103`; `client.ts:479`). It retries with backoff on its own
    (`overview.md:334`).
14. `createRequestStreamStore()` through `bindStoreToCallbacks` folds stream events into a
    ready-to-render item list; the React hooks use it (`overview.md:101`).
15. React: `useSession(sessionId, options)` is the hook that follows. It returns `items`,
    `isStreaming`, `isLoading`, `error`, `detail`, `snapshot`, `latestRequest`, `sendAction`,
    `abortRequest`, `refresh`, `resumeLatestRequest` and more (`useSession.ts:323-440`; the
    table-of-members is Reference). While a request streams, message and reasoning text
    accumulates token by token (`react.md:316`, `useRequestStream`).
16. `useSession` follows requests it sent. To hear requests it did not send (another tab, a
    coordinator's workers), pass `live: true`: one stream for the session, each finished item
    joins `items` about a second after it is saved, whole, not as text is typed
    (`useSession.ts:266-297`; `react.md:128-138`). Default `false`. A live view holds a connection
    open while mounted and the server reads the session about once a second for it
    (`react.md:146`). A server that doesn't offer the stream leaves the view as if `live` were off,
    with no error (`useSession.ts:283-286`).
17. `useFlow({ autoCreateSession })` lists sessions and holds the active one: returns `flows`,
    `sessions`, `activeSessionId`, `isLoading`, `createSession`, `ensureSession`, `selectSession`,
    `refreshSessions` (`packages/react/src/hooks/useFlow.ts:34-53`). `autoSelectSession` defaults
    to `true` (`useFlow.ts:22-28`).
18. A request that stops to ask a user ends `"suspended"`; the hook `useSuspensions` and the
    renderers answer it (`overview.md:63-71`; `react.md:446-460`). Out of scope for this page:
    link only.
19. Crash: a request cut off by a server crash is left `interrupted`; `continue()` keeps its id,
    `retry()` starts a new one (`overview.md:105-128`). `useSession` exposes
    `latestRequest.status === "interrupted"` and `resumeLatestRequest`, a no-op unless the latest
    request is `interrupted` or `failed` (`react.md:114-124`; `useSession.ts:464`). Reference material; one sentence at most.

### 3. Read what the server exposes

20. A state snapshot carries `clientData`: values the flow chooses to expose. "That is the only
    data a client sees. Raw state never reaches it." (`overview.md:291`.)
    `fsd.sessions.state(sessionId, { includeItems?, clientData? })` returns the snapshot with the
    `clientData` keys you name (`overview.md:163-172`).
21. A scope with no `client` block exposes nothing. Adding a field to state does not put it in the
    browser; it has to be named in `client.expose` (`state-and-scopes.md:457`). `expose` names
    must be top-level keys on that scope's `stateSchema`; `defineFlow` throws on one that is not
    (`packages/core/src/flow/defineFlow.ts:105-116` area; `state-and-scopes.md:459`).
22. `expose` copies each named field verbatim, per scope: session, user, org
    (`state-and-scopes.md:423`; engine copies `state[name]` for each exposed name,
    `packages/engine/src/routes/route-utils.ts:395-413`). A scope that exposes nothing sends no
    `clientData` entry for that scope (`packages/engine/src/routes/state-routes.ts:219-232`).
23. The browser cannot opt into private state by passing a flag. `?clientData=` only picks which
    exposed names are sent; a name that was never exposed is not returned
    (`route-utils.ts:395-413`, `:367-381`; `config-client.md:156`: "The server decides the
    snapshot ... The browser cannot opt into private state by passing a flag").
24. `useClientData(session, { session: [...], user: [...], org: [...] })` reads those values from
    the session's snapshot: an array of names, or a map of name to Zod schema for typed values
    (`packages/react/src/hooks/useClientData.ts:16-30`, `:89-101`). A name that is not exposed
    reads back `undefined` (`useClientData.ts:78-84`: it maps each requested name to
    `source[name]`).
25. Values update mid-stream: `state_change` items on the stream patch exposed keys already in the
    snapshot, so a component re-renders as `ctx.<scope>.patchState(...)` runs. The merge applies
    only to keys already exposed in `clientData`; a key not exposed is dropped (test:
    `packages/react/test/mergeStateChangeIntoSnapshot.test.ts:125-138`, "merges patch delta only
    for keys already exposed in clientData", the `secret` key stays `undefined`; `:236-247`,
    increment ignores `hidden`). Limits (Reference): a key whose initial snapshot value is
    `undefined` waits for the terminal refresh; `atomicState` writes stay stale until terminal
    refresh (`react.md:277-278`).
26. The state a flow keeps and the state it exposes are two sets. Example in the one runnable
    app: `examples/hello-chat/src/app.tsx:50` reads `session.snapshot?.clientData?.session?.messageCount`
    and shows it. Whether `messageCount` is exposed in that flow is on the flow's `client.expose`;
    a name left out reads `undefined`.
27. **Views.** A view is the other way to expose: the server computes an answer with one block,
    at the scope its data lives in (session, user or org). `defineView({ scope, block, key?,
    inputSchema?, description? })`, installed in `defineFlow({ views: { name: view } })`
    (`packages/core/src/flow/defineView.ts:19-31`, `:33-64`). `defineView` throws at definition
    on a bad scope, a missing block, a block with no output schema ("A view's answer is typed by
    its block's `outputSchema`"), or a non-function `key` (`defineView.ts:36-54`).
    Mark for reconcile at cutover: no user doc yet.
28. A view is called through HTTP routes `POST /:flowKind/views/:viewName` (user or org view, no
    session) and `POST /:flowKind/:sessionId/views/:viewName` (session view)
    (`packages/engine/src/routes/router.ts:186-191`; `view-routes.ts:5-6`). A session view
    called without a session is refused with a message naming the session route
    (`view-routes.ts:100`).
29. Client: `viewRef<typeof roster>(flow, view)` is the typed handle, safe in a browser bundle
    since it holds no block; it throws on an empty flow address or view name
    (`packages/client/src/view/view.ts:22-38`). `client.view(ref, input, { sessionId? })` runs it
    once and answers `{ value, topics, keys? }` (`view.ts:46-60`). Exported from
    `@flow-state-dev/client`: `viewRef` and the `View*` types (`packages/client/src/index.ts:45-51`).
30. React: `useView(ref, input?, { sessionId?, enabled?, pollIntervalMs?, client? })` returns
    `{ value, stale }` (`packages/react/src/hooks/useView.ts:22-70`). `value` is `undefined`
    until the first answer lands; `stale` is `true` while the last read failed. The screen names no
    topic: the answer carries the topics of what the view read, and the hook reads again on a
    change. Every screen watching the same view with the same input shares one read. `enabled:
    false` watches nothing (default `true`). Default poll 3 s, `null` for none (`useView.ts:36-40`).
    Tests: shares one read; answers nothing while disabled; answers nothing for a new input until
    its own answer lands (`packages/react/test/useView.test.ts:52,76,89`).
31. Views reach screens within a second of a change on the Node host, and a second user's change
    wakes none of another user's view calls; 0 view calls in 10 s idle with the poll off
    (`goals/views/a-screen-watches-a-view/goal.md`, `b:within-1s`, `b:idle-0-reads`; verdict log
    shows 41-49 ms). A user or org view answers with no session
    (`goal.md`, `a:no-session`).
32. Resources have their own gate: a resource with no `client` property is invisible to
    clients; its state reaches the client only through `expose`, `exclude` or `data` on its
    `client` block; content has `read`/`prefetch` permissions
    (`apps/docs/docs/resources/client-access.md:7,33-38,44-47`). The page names it in one
    sentence and links.

## What the browser never gets (Q2: "A field is in session state but not on the page. Why?")

33. Raw state. Only fields named in a scope's `client.expose` (or answered by a view) cross
    (`overview.md:291`; `state-and-scopes.md:419,457`). Answer to Q2: the field was never named
    in `client.expose` for that scope, so it stays on the server; add it to `expose` (it must be a
    top-level key of the scope's `stateSchema`) or compute it in a view.
34. Items marked not-for-client. Each item has a visibility `{ client, history }`:
    `block_trace`, `router_decision`, `state_snapshot` and `generator_step` are always
    `client: false`; `message`, `reasoning` and `tool_output` follow the producing block's
    `itemVisibility`, defaulting to `{ client: true, history: true }`; every other type is
    `client: true, history: false` (`packages/contracts/src/items/resolve-visibility.ts:10-50`).
    The server drops a not-for-client item from a request stream
    (`packages/engine/src/streaming/client-filter.ts:33-38`) and from a snapshot's items
    (`packages/engine/src/routes/route-utils.ts:553`).
    A request stream can ask for trace items back with `includeTrace` on `continue` and on
    stream options (`packages/client/src/client.ts:278,372`); do not state this on the page, it
    is Reference.
35. Resources with no `client` block (item 32), and their raw state, never appear in the
    snapshot: "Resources with no `client` config no longer surface here"
    (`state-routes.ts:187-189`, a code comment; the observable form is
    `client-access.md:33`, "Without a `client` property, the resource is invisible to clients").
36. `userId` is caller input, never trusted: with sign-in the server authenticates the request's
    credentials (`client.ts:57-61`; `config-client.md:79`). A `fetcher` that adds an
    `Authorization` header gives every read and stream that credential (`react.md:46`;
    `config-client.md:86-102`). The server decides who the caller is (`config-client.md:102`).
    The `sessions.list` call returns the client's own user's sessions; a server with sign-in
    returns only the signed-in user's either way (`overview.md:210`; `client.ts:609-618`).
37. A background run's session is another session: the conversation's `items` do not include it;
    `session.childSessions` lists it (`react.md:186-208`). Out of scope for this page.

## Rendering items (Q3: "An item type has no renderer. What does the reader see, and where do you add one?")

38. `ItemsRenderer` renders a list of items in the order given; `ItemRenderer` renders one
    (`packages/react/src/components/ItemsRenderer.ts:1-6`; `ItemRenderer.ts:212-218`). Both are
    exported from `@flow-state-dev/react` (`packages/react/src/index.ts:125-137`). Shown in
    `examples/hello-chat/src/app.tsx:73`: `<ItemsRenderer items={session.items} />`.
39. Resolution order for one item (`ItemRenderer.ts:1-13`, `:235-303`):
    1. a renderer registered in the provider's `renderers`, if any; `false` suppresses the type
       (renders nothing);
    2. a built-in for `message`, `reasoning`, `status`, `error`, `tool_output`, and for
       `suspension` an approval, question, selection or form card chosen by `reason` and the
       resume schema's shape;
    3. otherwise a JSON `<pre>` showing `{ type, component?, status }`
       (`ItemRenderer.ts:289-302`).
    So **an item type with no renderer shows a small JSON block with its type, its component key
    (for `component` and `container` items) and its status**, not the item's content. Add a
    renderer for it in `FlowProvider`'s `renderers`. Types without a built-in beyond `message`,
    `reasoning`, `status`, `error`, `tool_output`, `suspension`: `block_trace`, `source`,
    `component`, `container` and any other type. Note that `block_trace` is never sent to the
    client (item 34), so only `source`, `component` and `container` show in practice.
40. Four types render nothing, with no renderer needed: `state_change`, `resource_change`,
    `suspension_resume` and `continuation` (`ItemRenderer.ts:64-75`).
41. The registry shape: `RendererRegistry = { message?, reasoning?, block_trace?, tool_output?,
    status?, source?, error?, suspension?, component?: Record<string, ...>, container?:
    Record<string, ...> }`, each slot a React component or `false`
    (`packages/react/src/registry/block-renderers.ts:31-47`). `component` and `container` items
    look up a second key, the item's `component` name (`block-renderers.ts:57-72`).
    Every custom renderer receives `{ item }` as its only prop (`ItemRenderer.ts:12`;
    `react.md:338`).
42. A `component` item whose key matches a registered `container` renderer is not rendered on its
    own: the container owns it (`ItemRenderer.ts:261-271`). Reference-level; omit.
43. Register renderers on `FlowProvider`: `renderers={{ message: ChatMessage, component: {
    chart: Chart } }}` (`react.md:13-34`). Nested providers merge; a child's key overrides the
    parent's, and `false` in the child wins over a parent renderer
    (`FlowContext.ts:66-98`; `react.md:42`).
44. Example custom renderer: `function ChatMessage({ item }: { item: MessageItem })` with
    `import type { MessageItem } from "@flow-state-dev/core/items"`; it reads `item.role` and
    `item.content`, each part's `.text` (`react.md:340-352`). The built-in message fallback
    reads only `output_text` parts (`ItemRenderer.ts:82-86`); a custom renderer sees all
    content parts. Prop types match `OutputItem` members from `@flow-state-dev/core/items`
    (`ItemRenderer.ts:15-25`).
45. `ItemsRenderer` by default drops a component item's earlier snapshots that share a `key`
    within a request, keeping the latest (`deduplicateByKey`, default true), and hides
    sub-agent items (`history: false`) unless `showSubAgents` is set
    (`ItemsRenderer.ts:31-46`, `:98-115`). Reference-level; one clause at most, if the page shows
    a keyed component.
46. `ItemsRenderer` also takes `toolGroupRenderer` and `live` to group consecutive `tool_output`
    and `reasoning` items (`ItemsRenderer.ts:47-66`). Reference only.
47. Custom renderers for suspensions: `renderers.suspension` replaces the built-in card, `false`
    suppresses it (`block-renderers.ts:39-44`; `react.md:564-582`). The built-in card needs
    `flowKind` on the provider to call the resume endpoint (`react.md:488`). Link, do not
    explain.
48. Reference component packages: `@flow-state-dev/ui` (K-40, `reference/ui-components`) per the
    page plan; not read for this sheet.

## Wrapping the app: `FlowProvider`

49. `FlowProvider` props: `flowKind?`, `sessionId?`, `userId?`, `baseUrl?`, `apiPath?`, `fetcher?`,
    `renderers?`, `children` (`FlowContext.ts:42-62`). Hooks under it read these as defaults
    (`config-client.md:131-152`). A nested provider inherits its parent's value for any prop it
    does not set, including `baseUrl`, `apiPath`, `fetcher` (`FlowContext.ts:110-120`). Pass
    `baseUrl=""` to reset a nested provider to same-origin (`config-client.md:146`).
50. Hooks accept `flowKind`, `userId`, `baseUrl` as overrides; `fetcher` and `apiPath` come only
    from the provider (`config-client.md:152`). A stable `fetcher` reference is needed: pass one
    made with `useMemo` (`react.md:49-63`).
51. Smallest working example for the page: `examples/hello-chat/src/app.tsx:11-20` wraps a tree in
    `<FlowProvider flowKind="hello-chat" userId="devuser" baseUrl="http://localhost:3000">`;
    `:45-76` calls `useFlow({ autoCreateSession: true })`, `useSession(flow.activeSessionId)`,
    `session.sendAction("chat", { message })`, reads `session.snapshot?.clientData?.session?.messageCount`
    and renders `<ItemsRenderer items={session.items} />`. On the page, rename to the support
    flow (`flowKind="support"`, action `"reply"`, input `{ text }`) per the page plan's one-app
    rule, and use `useClientData` in place of the raw snapshot read.
52. Item key: `ItemRenderer` may be given `key={item.id}` by the caller when mapping manually
    (`react.md:598-600`). Not needed with `ItemsRenderer`.

## Without React (Q4)

53. Import `createClient` from `@flow-state-dev/client`. No React, no DOM (`overview.md:7`).
    The calls above are all on the client: `fsd.flow(addr).send`, `sent.stream`/`sent.wait`,
    `fsd.sessions.stream`, `fsd.sessions.state`, `fsd.flow(addr).createSession`,
    `client.view(viewRef(...), input)` (`client.ts:445,530,479`; `view.ts:46-60`).
54. In-process: pass the engine's `createInProcessFetch(flowState)` as `fetcher`, leave out
    `baseUrl`; the calls reach the same routes with the same checks, streams included
    (`config-client.md:104-118`; `overview.md:24-25`). Import from `@flow-state-dev/engine`.
    Reference-level detail; one sentence.
55. `fsd.subscribe([topic.session(sessionId)], { onChange, pollIntervalMs })`: `onChange` is told
    when to read, never what changed; on the Node host it runs as soon as the change is saved over
    a WebSocket, on a host with no push such as Vercel every `pollIntervalMs`
    (`overview.md:306-319`; `topic` exported from `@flow-state-dev/client`,
    `packages/client/src/index.ts:53`). React wrapper: `useSubscription(topics, read, options)`
    (`react.md:160-184`; export at `react/src/index.ts`, hook `useSubscription.ts`). Every
    `subscribe` on one client shares one WebSocket (`overview.md:336`). A one-sentence "reading
    again when others change" mention only, with a link to the realtime guide.
56. The React hooks are thin: the client does the work. `useSession` and `useRequestStream` wrap
    the same accumulator `createRequestStreamStore` exposes (`overview.md:101`). Package boundary
    from `CLAUDE.md` is out of bounds; the observable form is item 5.

## What it gets you (outline section 5)

Each point is an observable consequence in the support example.

57. **Types follow the flow.** `fsd.flow<typeof supportFlow>("support")` makes a wrong action name
    or input a compile error (`overview.md:44-49`); `viewRef<typeof roster>(...)` types a view's
    answer (`view.ts:30-34`); `useClientData` with a Zod schema map types the value
    (`useClientData.ts:32-50`, `react.md:263-268`).
58. **A new state field is private by default.** A field added to session state stays off the
    page until named in `client.expose` (`state-and-scopes.md:457`).
59. **A dropped stream resumes.** Reopen with `startingAfter`; the server replays what was missed
    (`overview.md:99`). A session stream reconnects on its own (`overview.md:334`). Duplicate
    events are dropped by a sliding window, `dedupWindowSize`, default 1000 (`overview.md:333`).
60. **A reload shows the same conversation.** `live: true` items join "in the order a reload would
    show" (`react.md:138`; `useSession.ts:273-277`). A session's items are a stored record, read
    back by `state({ includeItems: true })` (`overview.md:172`).
61. **One client per user and transport.** Hooks under one provider share it, so share one push
    socket (`useClient.ts:3-11`).
62. **Credentials in one place.** A `fetcher` wrapper gives every call and stream the same
    `Authorization` header (`config-client.md:86-102`; `react.md:46`).
63. **The same code works with or without a web server.** `createInProcessFetch` as the fetcher
    (`config-client.md:104-118`).

## How it fits with the others (outline section 6)

64. Sessions, items and streaming (C-sessions page, already drafted:
    `docs/contributing/docs-revamp/pages/concepts/sessions-items-and-streaming.md`): this page does
    not restate the item model or the SSE protocol; it links. Existing docs: `streaming/overview`
    (item types, SSE protocol, resume) (`overview.md:344-350` (See also)).
65. Flows and actions: the server side of "call an action" (`flows-and-actions` page).
66. Resource client access: `apps/docs/docs/resources/client-access.md` is what a flow lets a
    client see and write; hooks `useResourceCollection`, `useResourceCollectionList`,
    `useResourceCollectionItem`, `useResourceManifest` (`react.md:365-442`). Name them in one
    sentence; Reference holds the table.
67. A task board / background work is not part of the page: its runs appear in
    `session.childSessions`, not in `items` (`react.md:186-208`). Link only.
68. Human-in-the-loop and approvals: `useSuspensions`, `useApproval`, `SuspensionResolverProvider`
    (`react.md:444-586`); link to the guide `guides/human-in-the-loop`.

## Reference rows this page links to rather than states

(For pass 6; each is observable behavior with its source.)

- Request handle methods and options: `wait({ pollMs?, timeoutMs? })`, `retry({ input? })`,
  `resume({ suspensionId, action, data? })` (`overview.md:63-71`).
- `createClient` fields table and `baseUrl` rules by runtime (`config-client.md:28-84`).
- `send` options: `sessionId`, `requestId`, `metadata`, `stream: true` (`config-client.md:124-129`).
- `FlowProvider` fields table (`config-client.md:141-150`).
- `useSession` option and return tables (`useSession.ts:260-440`); `useFlow` (`useFlow.ts:17-53`);
  `useAction` (`useAction.ts:12-35`); `useView` (`useView.ts`); `useClientData`
  (`useClientData.ts:16-64`); `useRequestStream` source and filter
  (`react.md:307-316`); `useSubmit` (`react.md:294-305`).
- `useSession` live view stale flags: `childSessionsStale` and the reconnect cases
  (`react.md:158`, `:216`).
- `ClientHttpError` on a 409 or 404 from `updateMetadata` (`overview.md:161`).
- Session metadata, listing, deletion and id reuse (`overview.md:130-223`).
- `sessionQueryFor` (`overview.md:212-223`).

## Four questions: what is stored

The page describes a view onto stored data and stores nothing of its own, except one thing per
browser tab.

| Part | Owner | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| Session, user and org state | The flow, on the server | Only blocks, plus the fields named in that scope's `client.expose`, which the signed-in user's page reads | The server's store | One session record per session; one user record per user and organization; one org record per organization (`state-and-scopes.md:25` figure description) |
| Items | The session | The page gets only items whose visibility has `client: true` (item 34) | The server's store, with the session | One log per session |
| A view's answer | Computed per call by one block on the server; nothing is stored | The caller, at the view's scope; a user or org view needs no session (`goal.md` `a:no-session`) | Not stored. The client keeps the last answer in memory and shares one read per view and input within a client (`view.ts:11-12`, `useView.ts:7-8`) | One live read per view and input in a client |
| `clientData` in a snapshot | The flow's `client.expose` list | The caller | Not stored; copied from state on each read (`route-utils.ts:395-413`) | One per read |
| The client and its stream state | The page (a browser tab or script) | That tab | In memory only: the client, the accumulated items, the dedup window. Nothing survives a reload; the page reads the session again (`overview.md:333-334`; `react.md:138`) | One client per user and transport per provider (`useClient.ts:3-11`); one socket per client (`overview.md:336`) |
| Registered renderers | The app's `FlowProvider` | The page | In the React tree; not stored or sent | One merged registry per provider (`FlowContext.ts:66-98`) |

Unresolved, do not state: how long a session's items last on a store that does not persist
(Reference: persistence), and whether `fsd.sessions.state` with no `clientData` list returns all
exposed names (the filter is optional in the engine, `route-utils.ts:371-373`, which returns all
exposed names when no filter is given; state it only if a test is cited by pass 5).

## Cold-read questions (answers for pass 2's key)

1. Three things a page can do: call an action (`flow.send` / `useAction` / `sendAction`), follow a
   session's stream (`sent.stream`, `fsd.sessions.stream`, `useSession`), and read what the server
   exposes (`sessions.state` and `useClientData`, or a view with `useView`). Items 7-31.
2. A field in session state is not on the page: it is not in the scope's `client.expose`, so the
   server never copies it into `clientData`; also a patch to an unexposed key is dropped
   (items 21-25, 33).
3. An item type with no renderer: a small JSON block with the item's `type` (and `component` key
   and `status`); add a renderer under that type in `FlowProvider`'s `renderers`, keyed by
   `item.component` for `component` and `container` items (items 38-41, 43).
4. Not using React: import `createClient` from `@flow-state-dev/client` (items 1-2, 53).

## Left out for lack of an observable surface

- The page plan's sources name `configuration/client` "to Reference"; its tables are cited above
  as Reference rows, not restated.
- `ui` components (K-40) were not read; the page plan links them. Nothing from
  `@flow-state-dev/ui` is stated on this sheet.
- `useHarnessLines`, `FlowNavigator`, `useVoice`, `workforce` hooks: outside this page's job.

## Revise round 1 notes

- Item 25 and 33: the `state_change` item for an unexposed key does arrive in the browser's
  stream with its raw delta; the react hook ignores any key not in the exposed snapshot when
  merging (`packages/react/src/internal/mergeStateChangeIntoSnapshot.ts:5-14`,
  `packages/engine/src/streaming/client-filter.ts:34-40`). The page says only that the field is
  never readable through `useClientData`; it does not claim the change is dropped from the stream.
- Moved to Reference (page keeps a link): `FlowProvider` props and `baseUrl=""`, `useAction`
  `result: true`, `useSession` `live: true`, `ItemsRenderer` fallback fields and silent types,
  `renderers` prop shape and `false`, item visibility list, resource `client` gate, `userId`
  resolution, request-stream resume by sequence number, `fetcher`, `useClientData` schemas.

## Revise round 2 notes

- Item 36: with sign-in on, the server ignores the page's `userId` and identifies the caller from
  credentials (`client.ts:57-61`; `config-client.md` field table). Without sign-in `userId` is used,
  so the page says "with sign-in on", not "never trusted".
- Item 62: the credentials bullet names `fetcher` on `FlowProvider` or `createClient`
  (`config-client.md:86-102`; item 49).
- Item 39: built-ins confirmed as message, reasoning, status, error, tool_output, suspension.
- The page defines a `component` item before the renderer map (item 41).

## Revise round 3 notes

- Item 36: the page no longer says "sign-in on"; it says "when the server checks who is calling"
  and links the Client reference for how. Same fact: the server ignores the page's `userId` and uses
  the request's credentials (`client.ts:57-61`; `config-client.md` field table).
- Items 21-22: `expose` is per scope (session, user, org). The page's sentence names session state,
  the only scope its example shows; State and scopes covers the others.
