# @flow-state-dev/client

## 0.6.0

### Minor Changes

- 04812f3: A server block can read the running user's pending asks across every session in one call, `sessions.userSuspensions({ flowKinds })`, and a view that reads it wakes only when a suspension changes (FIX-2770).

  - **engine (breaking for custom stores):** `SuspensionStore` has a new required method, `listPendingForUser(query)`: one query that joins each suspension to its request and applies the user, tenant, organization, flow, pending status, expiry and waits-on-a-person checks inside it, returning rows built with `projectUserSuspension`. A custom suspension store gets a type error until it implements it; run `createPendingUserSuspensionsConformanceTests` from `@flow-state-dev/engine/testing` against it. `createInMemorySuspensionStore({ requests })` and `createFilesystemSuspensionStore(rootDir, { requests })` take the request store they join to; built without it, the method throws a `FlowStateConfigError`. `createInMemoryStores` and `createFilesystemStores` pass it for you.
  - **core:** the request host's `sessions` gains `userSuspensions({ flowKinds, after? })`: the principal's pending suspensions on 0 to 50 named flow kinds (more throws `FlowStateConfigError`), oldest first, 200 a page, with `more` and a `next` cursor `{ createdAt, requestId, suspensionId }` to pass back as `after`. Each row carries the ids, flow, session, kind, card shape, title, message, allowed actions, schema, render and times, never the run's `stepInput`, `resumeData` or `data`. A user or session view may call it; an org view may not.
  - **contracts / client:** a new change kind, `"suspension"`, published on a user's topic when a suspension waiting on them is written or deleted (never for a wait gate or an outside event's stop). A client that switches over every `ChangeKind` gets a new case.
  - **core:** `suspensionShape`, `SuspensionShape` and `USER_SUSPENSION_REASONS` (every stored reason that waits on a person) are exported from `@flow-state-dev/core/types`, beside `isUserSuspension`, along with `projectUserSuspension` and the row and query types a store builds. `@flow-state-dev/react` still exports `suspensionShape`, `SuspensionShape`, `SchemaField` and `SuspensionValueKind`, the same functions and types it had.
  - **contracts:** the card shape and schema analysis (`suspensionShape`, `analyzeResumeSchema`) and `USER_SUSPENSION_REASONS` live on the `@flow-state-dev/contracts/types/suspension` subpath, which core and react re-export from.

  Docs: packages/core/README.md (request host section: `sessions.userSuspensions`), packages/engine/README.md (the store method an adapter implements), apps/docs/docs/api/client.md (the `suspension` notice kind)

- 801aa5e: A stop answered from a React screen is answered whatever started its run, a task board's or a webhook's included (FIX-2450).

  - **react:** `useApproval`, `useSuspensionForm`, `useSuspensions` and `session.answerSuspension` answer a user's stop (`ctx.suspendForUser`, or a raw `user_approval` / `user_input`) through the client's `answer`, and a developer's own custom-reason `ctx.suspend` through `resume`. Before, they always called `resume`, which answers 404 for a task's or a webhook's run.
  - **react:** `session.resumeSuspension` is renamed to `session.answerSuspension`. The old name is removed. To migrate, rename your calls and pass `session.answerSuspension` to `<SuspensionResolverProvider resolve>`.
  - **react:** `resumedBy` is gone from the arguments of `answerSuspension`, `SuspensionResolver` and `resolveSuspension`. The server sets who answered; the field was ignored. Remove it from your calls.
  - **client:** `request.answer(body, { stream: true })` returns the answer route's SSE `Response`, as `resume` and `continue` do. `resumedBy` is gone from `ResumeSuspensionBody`; it has been ignored since 0.3.0. Remove it from your calls.
  - **devtool:** the suspension panel answers a user's stop through `answer`, so it approves a task's stop.

  Docs: packages/react/README.md (`session.answerSuspension` replaces `session.resumeSuspension` in the session example, the `SuspensionResolverProvider` snippet and `useSuspensions`; a note that a user's stop goes through `answer` and a custom-reason `ctx.suspend` through `resume`; the old name is removed, with no alias), packages/client/README.md (`answer` and `resume` rows: which stop each answers, `answer(body, { stream: true })`, no `resumedBy`), apps/docs/docs/api/client.md (same as the client README), apps/docs/docs/api/react.md (same as the React README), apps/docs/docs/client/react.md (`answerSuspension` in the inline-card streaming section), apps/docs/guides/human-in-the-loop.md (the two HTTP routes, `answer` for a user's stop, no `resumedBy` in the body), apps/docs/docs/advanced/durable-execution.md (`answerSuspension` where it names the React call)

- ffbe992: An app can follow and drive its users' worker sessions through package hooks and calls, with no stream, subscription or flow address of its own (FIX-2757).

  - **client:** a session feed's snapshot has `historyLoaded`, `true` once the history read has landed, so an empty session can be told from one still being read. `request(id).stream({ reconnect: true })` keeps following until the request ends: a failed connection opens again after the client's backoff (1 s, doubling, at most 30 s), resuming after the last event, without reporting it; five empty answers in a row (a request that already ended) or a 401, 403 or 404 still end it with `onError`, and `close()` ends it, a reconnect waiting on its backoff included. A user or org collection's handle has `listAll()`, every entry page after page, stopping with `CollectionReadStoppedError` on a repeated cursor or past 1,000 pages.
  - **react:** `useSessionFeed(sessionId, { itemTypes, client })` follows one session live (its items once the history lands, `[]` for an empty session even while its stream is still connecting; its unfinished runs and connection state, `loadEarlier`, and `followResponse` for a streamed send). `useRequestStream` takes `reconnect: true`, handed to the client's stream above, a `client` of the host's own, and asks for no flow while `enabled: false`. `useResource` takes `client` and `pollIntervalMs` at user and org scope.
  - **workforce:** the workforce client opens a new session with a worker (`startSession(worker, { fields })`, writing the app's session fields at open), sends to it (`send`, or `send(..., { stream: true })` for the streamed `Response`), each on the instance of its flow that owns the session, stops its running turns (`stopTurns`, resolving to the ids it stopped) and runs a failed turn again (`retryTurn`). `operatorGitHub({ operator, token })` and `operatorGitHubToken()` give a single-user host GitHub routines on the operator's own token, for the operator alone.
  - **harness-manager:** each coding board row names `runFlow`, the flow its run's session runs on, so a screen reads that run's own stream without looking the session up.
  - **workspace:** `sessionRepositorySource({ field, repositories, check })` is the run source for a host whose sessions each work in one repository a session field names; `listedRepository` maps a path or `file://` remote to the listed repository it is. `setupCommandFrom(value, setting)` reads a setup command from a setting, beside `checkCommandsFrom`.
  - **store-sqlite:** `sqliteScheduleIndex({ filename })` is a schedule index on a SQLite file of its own.

  Docs: packages/client/README.md (the session feed snapshot's `historyLoaded`; `request(id).stream`'s `reconnect`; a collection handle's `listAll`), packages/react/README.md (`useSessionFeed`; `useRequestStream`'s `reconnect` and `client`; `useResource`'s `client` and `pollIntervalMs`), packages/workforce/README.md (the client's `startSession`, `send`, `stopTurns`, `retryTurn`; `operatorGitHub`), packages/harness-manager/README.md (the coding board row's `runFlow`), packages/workspace/README.md (`sessionRepositorySource`, `listedRepository`, `setupCommandFrom`), packages/store-sqlite/README.md (`sqliteScheduleIndex`)

- ec99b11: A file attached to a message is uploaded once and travels by reference. Its bytes stay out of session reads and survive a restart wherever the sessions do (FIX-824).

  - **engine:** `POST /api/flows/blobs` takes one file as the raw request body. `POST /api/flows/<flow>/blobs` does the same under that flow's own sign-in: use it when a flow sets `authentication.resolvePrincipal`, so the file is held for the user its sends resolve. The `content-type` header is the file's type, and the `filename` query parameter is its name. It answers 201 `{ attachment }`, a `FileContent` whose `data` is a reference (`fsd-blob:<id>`), not the bytes. It refuses an unsupported type (415 `attachment_type_refused`), a file over the limit (413 `attachment_too_large`), an empty body (400 `attachment_empty`) and an app with nowhere to keep files (501 `attachments_not_configured`).
  - **engine:** an action request takes `attachments: FileContent[]` beside `input`. Each listed file moves from its uploader to the session the message is sent into. A file that is not the caller's or is gone answers 404 `attachment_not_found`, a file another session already holds answers 409 `attachment_already_sent`, and attachments with no session id answer 400 `attachments_need_session`. A refused send hands its files back to their uploader, except a file another send into the same session still relies on or was admitted with.
  - **engine:** `GET /api/flows/blobs/:blobId` returns the file's bytes to a caller who can read the session that holds it. Anyone else, and a file no session holds yet, gets 404 `attachment_not_found`. Deleting a session deletes its files. A file no message claims is deleted after 24 hours.
  - **engine:** files are kept where the sessions are. When the active profile's stores persist (SQLite, Postgres), files go to `.fsdev/blobs/<profile>` under the working directory. `filesystemStores({ rootDir })` keeps them under `<rootDir>/blobs`. Memory stores keep them in memory. A profile's `blobs` slot overrides this; `localBlobStores({ rootDir })` is a store adapter that keeps files on local disk. A database backup does not include the file bytes, so back up the blob folder too.
  - **vercel:** a function's disk does not last between requests, so an upload to a blob store that keeps files on the local disk is refused with 501 `attachments_unavailable`. Configure a hosted `blobs` slot to accept attachments there.
  - **client:** `client.upload({ data, mediaType?, filename? })` uploads one file and resolves to its `FileContent` reference. `client.flow(address).upload(...)` uploads through that flow's route. Send that reference, not the bytes.
  - **contracts / core:** a new `./attachments` subpath (`@flow-state-dev/core/attachments`) carries `ATTACHMENT_LIMITS` (10 images and 5 documents per message, 20 MB per file), the accepted types (PNG, JPEG, WebP, GIF, PDF), and `toBlobRef` / `parseBlobRef` / `isBlobId` for the reference form.

  Docs: packages/engine/README.md (the upload and read routes, `attachments` beside `input` and its refusals, where files are kept by default, the `blobs` slot and `localBlobStores` with `LocalBlobStoreOptions`, the backup note), packages/client/README.md (`client.upload` and `client.flow(address).upload`), packages/vercel/README.md (the 501 for a local blob store), packages/core/README.md (the `./attachments` subpath and its limits), packages/contracts/README.md (the limits set), apps/docs/docs/persistence/overview.md (a new section "Attachments: where the bytes live": the default, the durability rule, a serverless deploy needs a hosted adapter, a database backup misses the bytes on disk; drop the line that calls `blobs` forward-compatible), apps/docs/docs/configuration/runtime.md (the `blobs` slot row and the "forward-compatible" paragraph: `blobs` now resolves a blob store)

- 8e111c9: A message's files reach the model, and the conversation shows them on the person's line (FIX-2517).

  - **client:** `flow(address).send(action, input, { sessionId, attachments })` sends the message's files beside the input. Each is the `FileContent` that `upload` returned, in the order attached. The flow's input schema never sees them.
  - **react:** `useSession().sendAction(action, input, { userMessage, attachments })` sends them the same way. The line the view shows at once holds the files after the text, as the server's copy will.
  - **engine:** an action with `userMessage` takes files. The user line it writes holds a `file` part per file after the text, as references, so a reload shows them. An action without `userMessage` refuses files with 400 `attachments_not_accepted`. A message over the limits answers 400 `attachment_limit` (with the `index` of the file that went over and the `limit`), a type off the list answers 400 `attachment_type_refused`, and a file named as another type than it was uploaded as answers 400 `attachment_invalid`. Nothing is claimed or run on a refusal.
  - **engine:** a generator with `history` gets the files as image parts (PDFs as file parts) with the bytes inline, on the person's turn. Later turns still carry earlier files: counting back from the newest message, up to 10 images and 5 documents, the same limits as one message. An older file is named on its turn as `[image: shot.png, not re-sent]`. A file that can no longer be read is named as `no longer available` instead of failing the call. Re-sent files are billed as input on every call; prompt caching (on by default) keeps that cost down.
  - **engine:** retrying a turn (`POST …/requests/:id/retry`) carries its files: the retried line, its record and the model get the same references.
  - **core:** `ModelResolver.prepareMessages(messages)`, optional: a generator passes the messages of every model call through it. The engine's run sets it to read the person's files at the call, so a run's records (a generator's trace, a tool loop's prelude) hold references and never the bytes. A custom model resolver needs nothing new.
  - **core:** `ctx.request.attachments` lists the request's files as references, for a block that hands files on itself. Empty when the message carried none. A generator whose `user` slot repeats the person's words no longer sends the turn twice when that turn carries files.
  - **contracts / core:** `attachmentLimitRefusal(files)` in `@flow-state-dev/core/attachments` checks one message against the limits set, the same check the server makes, so a composer can refuse before send.
  - **bullmq:** a queued job carries the request's files to its worker.

  Docs: a new guide page, "A user turn can carry files": sending files from the client and React, what the model receives, the history rule (newest files up to one message's limits, older ones named), the limits and the named refusals, `ctx.request.attachments`. packages/client/README.md (`attachments` on `send`), packages/react/README.md (`attachments` on `sendAction`), packages/engine/README.md (the user line's file parts and the refusals), packages/core/README.md (`ctx.request.attachments`, `attachmentLimitRefusal`), packages/contracts/README.md (`attachmentLimitRefusal`).

- e3ca793: User and org collections are read by entry with no session, and a client writes an entry only through the flow the collection names (FIX-2624).

  - **core:** `defineResourceCollection` takes `runBy` and `canWrite`, with the same rules as a single resource: an org collection on `runBy: "default"` with no `canWrite` refuses to start. A collection's `canWrite({ key, prev, next, userId, orgId })` gets the entry's storage key, no `prev` on a create and no `next` on a delete. Also refused at definition: `runBy` without `client: { state: { read: true } }`, and `runBy: "default"` with `writable: false` or an eviction policy.
  - **engine:** `GET /api/flows/resources/:scope/:pattern/entries` lists the caller's entries (`{ items: [{ topic, storageKey, value, version }], nextCursor }`, with `limit`, `cursor` and `topicPrefix`), and `GET .../entries/:entry` reads one (`null` when absent). The default write flow's `set` takes an `entry` for a collection, and its new `delete` deletes one, each at the version the client read, behind the owner rule of an owner-keyed collection and the collection's `canWrite`. Each entry write publishes the entry's change on its user or org topic. A collection's address is its pattern; reading it at `GET /resources/:scope/:key` answers 400.
  - **client:** `client.resource(collection)` returns `list()`, `entry(key)` (with `read()`, `set()`, `update()` and `delete()`) and `send(action, input)`. A single resource's handle gets `send` too: a named action of the resource's own `runBy` flow, with no session.
  - **react (breaking):** `useResource(def, { session })` replaces `useResource(session, ref)`; the old form is gone, with no alias. Migrate `useResource(session, "soul")` to `useResource(soul, { session })`. It returns `{ value, stale }` instead of `{ clientData, fetchContent }`: a user or org resource or collection is read with no session and kept current on its scope's change notices, with `set` and `update` (a collection's take an entry, and it has `delete`). For a session resource's content, use `useResourceContent`.
  - **workforce:** the workers collection is written through the roster flow (`runBy: { flow: "workforce-roster" }`). `createWorkforceClient`'s `hire`, `fork`, `edit`, `reset` and `fire` no longer find or make a roster session, and the organization a worker's conversation is derived under comes from the roster flow's identity read. The client it's built over needs `resource` (any `createClient` client has it).

  Docs: apps/docs/docs/resources/client-access.md (listing and reading a collection's entries by scope; the two entries routes in the endpoint table; the reshaped `useResource`), apps/docs/docs/resources/client-writes.md (collection entries: `set` and `delete`, the collection `canWrite` check), apps/docs/docs/client/react.md (`useResource(def, { session })` and its result), apps/docs/docs/client/overview.md (`client.resource` on a collection, `send`), packages/core/README.md, packages/client/README.md, packages/react/README.md (`useResource`), packages/workforce/README.md (roster writes)

- 8dfcb2e: Every request names its session, from the first write of its record (FIX-2907). The engine no longer makes up a session for a run that names none.

  - **Breaking: a send needs a session id.** `client.flow(f).send(action, input, { sessionId })` and `useAction`'s `execute(input, sessionId)` require it, and so does `runAction` (`sessionId`) and a custom transport's `host.dispatch` envelope. An HTTP send with none is refused `400 { error: "session-required" }` before anything is written, and the route stays registered; `runAction`, `createExecutionContext` and `host.dispatch` throw `SessionRequiredError` (from `@flow-state-dev/engine/host`). Pass the conversation's id (`client.flow(f).createSession()`), or, for a one-shot send, `oneOffSessionId()` from `@flow-state-dev/core/helpers`: the same one-off run as before, folded under "One-off runs" in the navigator.
  - **No behaviour change for runs with no conversation.** A webhook binding that names no session, a `per-fire` schedule fire and an MCP `tools/call` with no session directive still run in a fresh one-off session; the webhook route, the scheduled endpoint and the MCP adapter now make its id before they dispatch, so the request record and its gates name it. A one-off webhook session is born with `metadata.source: "webhook"` like a named one.
  - **Requests recorded with no session before this release** stay readable and stoppable (a stop settles a parked one `aborted`). Running one again is refused by name: a resume, continuation, retry or wake answers `legacy-sessionless-request` (`409` over HTTP), and a queued BullMQ job with no session is settled failed under `LegacySessionlessRequestError` and not retried.
  - `ConcurrencyKeyContext.sessionId` is now always set.

  Docs: apps/docs/docs/client/overview.md (`send` takes a session id and how to get one; drop the "no session" sentences), apps/docs/docs/fundamentals/state-and-scopes.md (the "sent without a session id" line under the create check: such a send is refused), apps/docs/docs/server/connection-resilience.md (the snapshot's `sessionId` is absent only on a request recorded before sessions were required), apps/docs/docs/server/mcp.md and apps/docs/docs/server/scheduled.md (a one-off run gets a fresh session made for it, no behaviour change), packages/client/README.md and packages/react/README.md (`sessionId` on `send` and `execute`)

- c7ce9ff: A flow's `reads` are removed; views replace them (FIX-2623).

  - **core, breaking:** `defineFlow` refuses a `reads` key with an error naming views, rather than defining the flow and serving nothing. `ReadConfig` and `ReadEntry` are removed from `@flow-state-dev/core` and `@flow-state-dev/core/types`, with no alias. Declare each read as a session view instead: `views: { name: defineView({ scope: "session", block }) }` (the block declares its `outputSchema`).
  - **engine, breaking:** the read route, `POST /api/flows/:flowKind/:sessionId/reads/:readName`, is gone, and so is `runRead` from `@flow-state-dev/engine/internal`. A session view answers at `POST /api/flows/:flowKind/:sessionId/views/:viewName` with `{ output, topics }`.
  - **client, breaking:** `client.flow(kind).read(name, input, { sessionId })` is removed. Call `client.view(viewRef(flow, name), input, { sessionId })`, or `useView` in React, which also keep the answer current from the topics it names.
  - **orchestration, breaking:** `taskToolReads` is removed from `@flow-state-dev/orchestration/internal`. A board's task list is `taskToolViews(collectionId, resolve)`, watched through `taskListViewRef(flow, board)`.
  - **workforce:** the coordinator, the agent worker flow and `defineSessionBoard` serve the conversation's task list as the session view `listTasks_tasks` only; `defineSessionBoard(...).reads` is gone (spread `views` instead).

  Docs: packages/core/README.md and packages/engine/README.md (reads, `ReadConfig`, the read route and `runRead` leave), packages/client/README.md (`flow(kind).read` leaves; `client.view`), packages/orchestration/README.md (`taskToolReads` leaves), packages/workforce/README.md (`defineSessionBoard`'s `reads` leaves), packages/harness-manager/README.md (the run-changes section: `POST .../reads/changes` becomes the `harnessRunChangesView` session view), apps/docs pages on flow reads (retire; point at Views).

- b43424c: A change notice names what changed, so a screen can re-read only those rows (FIX-2625).

  - **contracts / client:** `WireNotice` gains `ids?: string[]`: the ids of what changed, never its data. Absent means read everything. A `board` notice names the tasks whose rows changed, a collection entry's `resource` notice names the entry's storage key (only when its path may be named: never an owner-private row or a user-scope entry), a `run` notice on a parent session's topic names the child session (on a user's own topic it names nothing, since that topic spans the user's orgs), and a `request` notice names the request. `items`, `state` and `resync` name nothing. `client.live` and `client.subscribe` pass them through; notices of one topic and kind waiting on a read union their ids, up to 100, past which a notice names none.
  - **engine:** `createFlowState({ noticeIds: { org: false } })` (also on `createFlowApiRouter`) turns ids off for a topic scope, for an app where even the timing of an org's changes is sensitive. No notice of that scope reaches a browser with ids, and a resource notice reaches a scope-wide subscription with no path, so every resource watcher in that scope reads everything on any resource change. On by default. A key other than `session`, `user` or `org`, or a non-boolean value, is refused at startup.
  - **store-postgres:** the Postgres bus carries ids across processes; a notice too large for `NOTIFY` drops its ids before it is widened to its scope.
  - **orchestration:** a task board's change notice names the task.

  A client from before this change ignores `ids` and reads everything, as before.

  Docs: apps/docs/guides/realtime.md (ids on a notice; turning them off per scope with `noticeIds`), apps/docs/docs/api/client.md (`WireNotice.ids`), apps/docs/docs/persistence/overview.md (what the Postgres bus carries), packages/client/README.md (`WireNotice.ids`), packages/engine/README.md (`noticeIds`), packages/core/README.md (notice ids)

- 1a2eaf3: Keep a screen current on change notices with one call, `client.live`, the live read (FIX-2551). Every watch in the framework now runs on it, so every live screen behaves the same way.

  - **client:** `client.live(topics, { read, onValue, hear, paths, onStale, onError, pollIntervalMs, readNow })` reads now and again on each notice under `topics` that `hear` (which notices) and `paths` (which resource paths, as roots or roots per scope) let through. One read runs at a time with at most one waiting, however many notices land; a waiting read is handed the notice that woke it, or `null` for several different ones. A value is reported only when it changed, compared by value. A read that fails tries again on its own, 1 s doubling to 30 s, and `onStale(true)` says the screen is stale until a read lands (`onStale(false)`). Where push can miss a change it reads on a timer, every 3 s by default (`pollIntervalMs: null` for none). With `topicsFromResult: true`, `read` returns `{ value, topics }` and the live read re-subscribes when that set of topics changes, then reads once more. Returns `{ refresh(), close() }`. New types: `LiveRead`, `LiveReadOptions`, `LiveReadWithTopicsOptions`, `LiveResult`, `LivePaths`.
  - **react:** a `useSubscription` read that throws, and a live panel's read that fails (`Roster`, `BoardColumns`, `BoardList`, `useSessionList`), now try again on their own, 1 s doubling to 30 s. Before, they waited for the next change, which while push is up may never come. `useSubscription`'s signature is unchanged.
  - **workforce:** `watchRoster` runs on `client.live`: a failed read is tried again on its own, with no change needed. `WorkforceClientSource` now picks `live` from the client instead of `subscribe`; a full client from `createClient` already has it. If you pass a slice of your own, add `live`.
  - **shift-manager:** the snapshot's lapsed read tries again on the client's backoff (1 s, doubling to 30 s), where it used its own (2 s, doubling).

  Docs: apps/docs/guides/realtime.md (keeping a screen current is `client.live`; how `hear` and `paths` decide which notices read, the retry and `onStale`, the 3 s timer, and topics from the last result), packages/client/README.md (a `client.live` row and example beside `subscribe`), apps/docs/docs/api/client.md (same as the client README), apps/docs/docs/client/react.md and apps/docs/docs/api/react.md (where they describe `useSubscription`: it runs on the live read, and a read that throws tries again on its own), packages/workforce/README.md (`watchRoster` retries a failed read; `WorkforceClientSource` needs `live`). No new page.

- 3ef3979: **Breaking:** the client's root carries only what an app reads (FIX-2449). `ExecuteActionRequestBody` and `QueryValue`, which nothing outside the client reads, are no longer exported, and `clientPackageMarker` is removed, with no deprecated aliases. `ChildSessionStatus` and `ChildSessionSummary` are unchanged, now declared once in contracts (`@flow-state-dev/contracts/types/child-session`) and re-exported. `CollectionResourceHandle` stays on the root: React's collection hooks return it.

  Docs: packages/client/README.md (add `CollectionResourceHandle`: the item `useResourceCollectionList` and the collection hooks return, `{ topic, clientData, fetchContent() }`)

- f9daf5a: A flow and its sessions can say what they are, so a flow list reads by who and what instead of by hashed ids (FIX-2875).

  - **core / engine / client:** `defineFlow({ description })` goes out on the flow list as `FlowListEntry.description`. `session.label: ({ id, state }) => string | undefined` names a session on every read of it, as `SessionSummary.label`. It sees only the state the session shows (readonly and exposed fields). A label that throws leaves that session unlabelled, and the server warns once for that flow kind.
  - **react:** `FlowNavigator` reads a session's title, then its `label`, then a shortened id (derived ids such as `dsx_…` shorten too). In every app that uses `FlowNavigator`, a collection flow with one copy whose id is the flow's kind draws one level; a single copy with a different id keeps its own line. Sessions run with no session id of their own (`ephemeral_…`) fold into one closed "One-off runs (N)" line, together with every run they started. An empty session list shows the flow's description, which is also the flow line's tooltip.
  - **devtool:** each session line has a copy button for its id.
  - **workforce:** every worker flow labels a session by its worker's name (a standard worker's `name:`, else the worker id), plus the task id for a task's session. The `agent` worker flow and service flows have descriptions; so do harness manager's `coder` and `harnesses` flows and the Claude Code kit's flow.

  Docs: apps/docs (flow definition: `description`, `session.label`; the DevTool's flow tree)

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
- c82adfa: **Breaking:** one word for a stored thing, _resource_, and _Status_ for a lifecycle (FIX-2479). Exported names that said _row_ or _collection item_ for a resource, or _row_ for a task, are renamed, with no aliases. Stored field names, storage keys and HTTP paths do not change: a worktree record keeps its `state` field, now typed `WorktreeStatus`.

  ### Renamed exports

  | Package                            | Old                                                      | New                                                                                        |
  | ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
  | `core` (`/internal`)               | `WaitRow`                                                | `TaskAddress`                                                                              |
  | `core` (`/harness`)                | `planRowsPrefix`                                         | `planResourcesPrefix`                                                                      |
  | `core` (`/harness`)                | `readPlanTarget(...)` result field `rowsPrefix`          | `resourcesPrefix`                                                                          |
  | `core`                             | `SessionCreateCheckInput.readCollectionItem(ref, topic)` | `readCollectionResource(ref, topic)`                                                       |
  | `engine`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `engine`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `engine`                           | `ResourceIndexBuildState`                                | `ResourceIndexBuildStatus`                                                                 |
  | `workspace`                        | `WorktreeRow`                                            | `WorktreeResourceState`                                                                    |
  | `workspace`                        | `worktreeRowSchema`                                      | `worktreeResourceStateSchema`                                                              |
  | `workspace`                        | `WorktreeState`                                          | `WorktreeStatus`                                                                           |
  | `workspace`                        | `worktreeStateSchema`                                    | `worktreeStatusSchema`                                                                     |
  | `scheduled`                        | `ScheduleIndexRow`                                       | `ScheduleIndexEntry` (one schedule's entry in the schedule index)                          |
  | `client`                           | `CollectionItemHandle`                                   | `CollectionResourceHandle`                                                                 |
  | `client`                           | `CollectionItemState`                                    | `CollectionResourceState`                                                                  |
  | `client`                           | `CreateCollectionItemOptions`                            | `CreateCollectionResourceOptions`                                                          |
  | `client`                           | `ListCollectionItemsOptions`                             | `ListCollectionResourcesOptions`                                                           |
  | `client`                           | `DebugCollectionItem`                                    | `DebugCollectionResource`                                                                  |
  | `client`                           | `DebugCollectionItemsResponse`                           | `DebugCollectionResourcesResponse` (its `items` wire field is unchanged)                   |
  | `client`                           | `ListDebugCollectionItemsOptions`                        | `ListDebugCollectionResourcesOptions`                                                      |
  | `client`                           | `client.resources.listCollectionItems`                   | `listCollectionResources`                                                                  |
  | `client`                           | `client.resources.createCollectionItem`                  | `createCollectionResource`                                                                 |
  | `client`                           | `client.resources.getCollectionItemState`                | `getCollectionResourceState`                                                               |
  | `client`                           | `client.resources.getCollectionItemContent`              | `getCollectionResourceContent`                                                             |
  | `client`                           | `client.resources.deleteCollectionItem`                  | `deleteCollectionResource`                                                                 |
  | `client`                           | `client.sessions.debug.listCollectionItems`              | `listCollectionResources` (the debug route's URL is unchanged)                             |
  | `client`                           | `client.sessions.debug.fetchCollectionItemContent`       | `fetchCollectionResourceContent`                                                           |
  | `client`                           | `SessionConnectionState`                                 | `SessionConnectionStatus`                                                                  |
  | `react`                            | `useResourceCollectionItem`                              | `useCollectionResource` (its result's `item` field is unchanged)                           |
  | `react`                            | `UseResourceCollectionItemResult`                        | `UseCollectionResourceResult`                                                              |
  | `react` (`/workforce`)             | `PanelRowSource`, `PanelItemSource`                      | unchanged names; they now pick `listCollectionResources` and `getCollectionResourceState`  |
  | `orchestration` (`/tasks`)         | `rowHoldSchema`                                          | `ownHoldSchema` (a task's own hold: a question, a confirm or an external wait)             |
  | `orchestration` (`/tasks`)         | `RowHold`                                                | `OwnHold`                                                                                  |
  | `orchestration` (`/inbox`)         | `RowHoldSource`                                          | `OwnHoldSource` (its `kind` is `"task"`, was `"row"`)                                      |
  | `orchestration` (`/inbox`)         | `InboxRow`                                               | `InboxTaskInput`                                                                           |
  | `orchestration` (`/inbox`)         | `RefileRow`                                              | `RefiledTask`                                                                              |
  | `orchestration` (`/inbox`)         | `taskRowView(row, holds?)`                               | `taskView(task, holds?)`                                                                   |
  | `orchestration` (`/inbox`)         | `TaskRowView`                                            | `TaskView`                                                                                 |
  | `orchestration` (`/inbox`)         | `TaskViewRow`                                            | `TaskViewInput`                                                                            |
  | `orchestration` (`/inbox`)         | `TaskRowState`                                           | `TaskViewStatus`                                                                           |
  | `orchestration` (`/inbox/check`)   | `RowTruth`                                               | `TaskTruth` (its `rowHolds` field is `ownHolds`)                                           |
  | `orchestration` (`/inbox/check`)   | `rowTruthOf`                                             | `taskTruthOf`                                                                              |
  | `orchestration` (`/internal`)      | `isRowHold`, `openRowHolds`                              | `isOwnHold`, `openOwnHolds`                                                                |
  | `orchestration` (`/internal`)      | `rowsInSession`                                          | `tasksInSession`                                                                           |
  | `engine` (`/internal`)             | `OwnerRunRefusal` value `"no_row"`                       | `"no_resource"`                                                                            |
  | `harness-manager`                  | `HarnessReadinessRow`                                    | `HarnessReadinessView`                                                                     |
  | `harness-manager`                  | `harnessReadinessRowSchema`                              | `harnessReadinessViewSchema`                                                               |
  | `harness-manager`                  | `HarnessUsageRow`                                        | `HarnessUsageView`                                                                         |
  | `harness-manager`                  | `HarnessUsageWindowRow`                                  | `HarnessUsageWindowView`                                                                   |
  | `harness-manager` (and `/browser`) | `PullRequestRecordRow`                                   | `PullRequestRecordResourceState`                                                           |
  | `harness-manager` (and `/browser`) | `PullRequestWaitRow`                                     | `PullRequestWaitInput`                                                                     |
  | `harness-manager`                  | `PlaceState`                                             | `PlaceStatus` (a run record's place keeps its `state` field, now typed `PlaceStatus`)      |
  | `harness-manager`                  | `placeStateSchema`                                       | `placeStatusSchema`                                                                        |
  | `harness-manager`                  | `readRunRow`                                             | `readRunRecord`                                                                            |
  | `workforce`                        | `WorkerRow`                                              | `WorkerResourceState` (the worker's configuration, as stored)                              |
  | `workforce`                        | `workerRowSchema`                                        | `workerResourceStateSchema`                                                                |
  | `workforce`                        | `parseWorkerRow(value)`                                  | `parseWorkerResourceState(value)`, answering `{ worker }` (was `{ row }`) or `{ problem }` |
  | `workforce`                        | `StandardWorkerRow`                                      | `StandardWorkerResourceState`                                                              |
  | `workforce`                        | `standardWorkerRowSchema`                                | `standardWorkerResourceStateSchema`                                                        |
  | `workforce`                        | `ProjectRow`                                             | `ProjectResourceState`                                                                     |
  | `workforce`                        | `projectRowSchema`                                       | `projectResourceStateSchema`                                                               |
  | `workforce`                        | `WorkerInventoryRow`                                     | `WorkerInventoryResourceState`                                                             |
  | `workforce`                        | `workerInventoryRowSchema`                               | `workerInventoryResourceStateSchema`                                                       |
  | `workforce`                        | `SubscriptionRow`                                        | `SubscriptionResourceState`                                                                |
  | `workforce`                        | `subscriptionRowSchema`                                  | `subscriptionResourceStateSchema`                                                          |
  | `workforce` (and `/browser`)       | `WorkerMessageRow`                                       | `WorkerMessageResourceState`                                                               |
  | `workforce` (and `/browser`)       | `workerMessageRowSchema`                                 | `workerMessageResourceStateSchema`                                                         |
  | `workforce`                        | `WorkerUsageRow`                                         | `WorkerUsageView` (one worker's line in the `workerUsage` query's answer)                  |
  | `workforce`                        | `ReportRow`                                              | `ReportResourceState`                                                                      |

  ### For client developers: values and messages an app branches on or matches

  Code that branches on one of these values, or matches one of these messages, changes when it upgrades. In each message only the noun changes; the rest of the sentence is the same.

  | What                                                                                            | Old                                                                             | New                                                                                                                  |
  | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | A task's own hold (`Task.holds[].source.kind`, and the Inbox's `InboxHold.source.kind`)         | `"row"`                                                                         | `"task"`. A hold stored as `"row"` still reads as `"task"` and can still be answered; `"row"` is never written again |
  | Dispatch refusal (`DispatchOutcome.refused`)                                                    | `"external-dispatcher"`                                                         | `"external-flow-runner"`                                                                                             |
  | Owner-private refusal                                                                           | starts "A row of an owner-private …"                                            | "A resource in an owner-private collection is readable only by the user it belongs to."                              |
  | Owner-writes refusal                                                                            | starts "A row of an owner-writes …"                                             | "A resource in an owner-writes collection is written only by the user it belongs to."                                |
  | Startup overlap error                                                                           | `Collection pattern "<P>" can reach the rows of owner-<mode> collection "<Q>".` | `Collection pattern "<P>" can reach the resources of owner-<mode> collection "<Q>".`                                 |
  | Owner-segment refusal ("That segment is reserved for the user an owner-private collection's …") | "… row belongs to, …"                                                           | "… resource belongs to, …"                                                                                           |

  Every other error and refusal message that said _row_ follows one rule: _task_ where the row was a task (dispatch, the task board, the ledger), _resource_ elsewhere, and _collection resources_ for _collection items_. In this release that covers the task board's, the task entry's, the ledger's and the task collection's errors in `orchestration` (and the `listTasks` tool's description a model reads), the Inbox check's drift lines, the dispatcher's and `defineFlow`'s task-entry errors, the faceted and owner-writes collection errors in `core`, the parent-task, owner-run and cross-board errors in `engine`, the schedule-index warning in `scheduled`, the harness manager's superseded-attempt, run-record, worktree-resource, phase-mismatch and foreign-run errors and the scripted coder's steps and commit message in `harness-manager`, the worker inventory's, the shadowed-reference, the hire and roster-loader document, the project-read tool's description and the project-link errors in `workforce`, and the DevTool's "Failed to fetch collection resources" (was "…collection items").

  Docs: every published page and package README that still names a renamed export or value, by page, with the names it uses. Pages: `docs/glossary.md` ("A task is a row", "A project is one row", "One row, in user or org scope", "A resource row") and `docs/resources/collections.md` (the collections pages say _resource_; collections.md also quotes the owner-private and owner-writes refusals and the overlap error, and names `CollectionItemHandle`); `docs/workforce/projects.md` (quotes the owner-writes refusal; `getCollectionItemContent`); `docs/orchestration/task-substrate.md` (the hold marker `"row"` is `"task"`, and its refusal tables' `external-dispatcher` is `external-flow-runner`); `docs/advanced/concurrency-policies.md`, `docs/server/background-work.md` and `guides/keeping-a-flow-running.md` (`external-dispatcher`); `docs/tools/coding-agents.md` (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`); `docs/fundamentals/state-and-scopes.md` (`readCollectionItem`); `docs/api/client.md` (`CollectionItemState` and the client methods `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`); `docs/client/overview.md` (`listCollectionItems`, `getCollectionItemState`); `docs/client/react.md` (`CollectionItemHandle`, `useResourceCollectionItem`); `docs/resources/client-access.md` (`createCollectionItem`, `getCollectionItemContent`, `deleteCollectionItem`, `useResourceCollectionItem`); `docs/workforce/delegating-work.md`, `docs/workforce/inventory.md` and `docs/workforce/ui.md` (`listCollectionItems`); `guides/writing-ui-stories.md` (`resources.listCollectionItems`, `getCollectionItemState`, and the story fixtures `loadingRowsSource` and `failingRowsSource`, now `loadingResourcesSource` and `failingResourcesSource`); `docs/workforce/messaging-workers.md` (`workerMessageRowSchema`); `docs/orchestration/harness-manager.md` (its readiness section: `HarnessReadinessRow`, `harnessReadinessRowSchema`); `docs/orchestration/task-board.md` (`taskRowView`); `docs/server/schedule-index.md` and `guides/scheduled-dynamic.md` (`ScheduleIndexRow`). READMEs, each with the old names it still uses (the tables above give the new ones): packages/core/README.md (`planRowsPrefix`, `readPlanTarget`'s `rowsPrefix`, `useResourceCollectionItem`, `external-dispatcher`, and a quote of the owner-writes refusal); packages/claude-code/README.md and packages/cursor/README.md (`readPlanTarget`'s `rowsPrefix`); packages/client/README.md (`CollectionItemState`, `listCollectionItems`, `createCollectionItem`, `getCollectionItemState`, `getCollectionItemContent`, `deleteCollectionItem`, `SessionConnectionState`); packages/react/README.md (`CollectionItemHandle`, `resources.listCollectionItems`, `resources.getCollectionItemState`, `useResourceCollectionItem`); packages/orchestration/README.md (`taskRowView`, `rowsInSession`); packages/harness-manager/README.md (`openRowHolds`, `HarnessReadinessRow`, `harnessReadinessRowSchema`, `HarnessUsageRow`, `readRunRow`); packages/workforce/README.md (`listCollectionItems`, `taskRowView`, `workerRowSchema`, `parseWorkerRow`, `WorkerInventoryRow`, `workerInventoryRowSchema`, `subscriptionRowSchema`, `WorkerMessageRow`, `workerMessageRowSchema`, `WorkerUsageRow`, and a quote of the owner-writes refusal); packages/engine/README.md (`no_row`). packages/workspace/README.md (a worktree record is `WorktreeResourceState`, its `state` field typed `WorktreeStatus`, parsed with `worktreeStatusSchema`).

- aa45e92: A user or org resource is read by scope and key with no session, and a client writes it only through the flow it names (FIX-2624).

  - **core:** `defineResource` takes `runBy` and `canWrite`. `runBy: "default"` lets a client write the resource through the framework's default write flow, which checks the schema, the owner and `canWrite({ prev, next, userId, orgId })`, and writes at the version the client read. `runBy: { flow }` names a flow of your app that writes it instead. With no `runBy`, a client can't write the resource; server flows still write it from their actions. User or org scope only, and with a `client` config.
  - **core:** an org resource with `runBy: "default"` and no `canWrite` is a definition error: your app refuses to start until you declare who may write it, even everyone (`canWrite: () => true`). A user resource needs no rule: it is its owner's. Also refused at definition: `runBy` on a session resource, with `flowIsolation: true` or with no `client` config, `runBy: "default"` with a computed `client.data`, `writable: false`, or (any `runBy`) a `client` config that projects no state, and `canWrite` without `runBy: "default"`.
  - **engine:** three routes. `GET /api/flows/resources/:scope/:key` reads the caller's copy (`{ value, version }`) with no session and no request, projected exactly as the session snapshot projects it: a resource with no `expose`, `exclude` or `data` (content-only) returns no `value`. `POST /api/flows/resources/:scope/:key/actions/:action` writes through the resource's `runBy` flow, in a session the server keeps per writer; it records a request like any action. `GET /api/flows/:flow/identity` answers the user and org the server acts as under that flow's sign-in. Each resolves the caller through the declaring flows' own sign-in (a send to `runBy: { flow }` through that flow's, as a direct call to its action would), never the body, query or headers. Until a caller is signed in by every flow that declares the key, and admitted by one declaring instance's pin, every answer is the `404` an unknown key gets. If the declaring flows' sign-in resolves one request to different users or orgs, the read or write is refused (`500 resolver_disagreement`). A key two flows declare with different sign-ins or client settings is refused per request, naming both. Write sessions are the server's: no route or transport takes one from a client (session create included), the default write flow answers as an unknown flow, and no listing shows a write's session or request.
  - **bullmq:** the job processor runs default writes too. A worker started through `createFlowState({ worker: bullmqWorker(...) })` is given the host's `resolvePrincipal` itself (on `FlowStateRuntime`); one built directly with `createFlowWorker` takes `resolvePrincipal` in its deps, the same host-level resolver your web host is given, so the worker decides whether two flows that declare one resource agree exactly as the host does. Default: the development resolver.
  - **client:** `client.resource(def)` returns a handle with `read()`, `state()`, `set(value, { version })` and `update(updater)`. `update` reads, applies your updater and writes at that version; when another write landed first it reads again and re-applies, three times at most, then rejects with `ResourceWriteError` (`code: "stale_version"`). `client.flow(kind).identity()` returns `{ userId, orgId }`.

  - **core (definition error):** `runBy` of either kind on a single resource whose `client` config projects no state (neither `expose`, `exclude` nor `data`, for example `client: {}`) now throws at definition. With no state projection a client reads none of the resource's state, so it has nothing to write back. To fix it, list the fields the client reads and writes: `client: { expose: ["pinned"] }` (or `exclude: [...]`). A resource with no `runBy` and no state projection (content-only) is not served by the direct read: it answers as an unknown key.

  Docs: apps/docs/docs/resources/client-access.md (reading a user or org resource by scope with `client.resource`; the three routes in the endpoint table), new apps/docs/docs/resources/client-writes.md after `client-access` in the Resources sidebar (`runBy`, the default write flow and its checks, `canWrite` and the org-resource startup error, versions and `update`'s retry), apps/docs/docs/client/overview.md (`client.resource`, `flow().identity()`), packages/core/README.md (`runBy`, `canWrite`), packages/engine/README.md (the three routes), packages/client/README.md (`client.resource`, `identity()`, `ResourceWriteError`), packages/bullmq/README.md (the worker deps' `resolvePrincipal`)

- ec1fdf9: Watch a view from a screen, with no topics to name (FIX-2623).

  - **client:** `viewRef<typeof myView>(flow, name)` names a view for the client, typed by the view through a type import, so the view's block never reaches the browser bundle. `client.view(ref, input?, { sessionId? })` runs it once and resolves to `{ value, topics, keys? }`: the answer, typed as `ViewOutput` of the view, the change topics of what its run read, and a keyed view's row keys in order. Pass `sessionId` for a session view; a user or org view takes none. Types `ViewRef`, `ViewResult`, `ViewCallOptions`, `ViewValueOf` and `ViewInputOf`.
  - **react:** `useView(ref, input?, { sessionId?, enabled?, pollIntervalMs? })` returns `{ value, stale }`. `value` is `undefined` until the first answer. The hook listens to the topics each answer names and reads again on a change; it reads again on its own after a failure, and `stale` is `true` until a read lands. Every component watching the same view with the same input and session shares one read. A keyed view's rows that didn't change keep their object identity across answers.
  - **engine:** a keyed view's answer carries `keys`, the rows' keys in order.

  Docs: packages/client/README.md (`viewRef`, `client.view` and its answer, `ViewResult`, `ViewValueOf`, `ViewInputOf`), packages/react/README.md (`useView`, `{ value, stale }`, shared reads, keyed rows keeping identity), the new apps/docs "Views" page (watching a view from React and from the client), apps/docs/docs/api/client.md and apps/docs/docs/api/react.md (the same, as reference).

- 1970b12: A keyed view can answer for just the rows a change touched, and a collection read re-reads just the entries that changed (FIX-2625).

  - **core:** in a view's run, `ctx.view.changed` is the notice that woke its watcher: its topic, kind and `ids`. It is set only when the notice named ids and the view declares a `key`. Return `ctx.view.partial(rows, { removed })` to answer for just those rows. A view that never calls it answers whole, as before. `partial` throws on a run with no change, or in a view with no `key`. A partial answer never reorders rows: answer whole wherever a change could move a row. A partial answer that brings a row the screen doesn't hold makes the screen read the view whole, since only a whole run says where it goes. New types: `ViewChange`, `ViewRunContext`.
  - **engine:** the view routes take `changed` in the body. A partial answer comes back as `{ output, topics, keys, partial: { removed } }`.
  - **client:** `client.view(ref, input, { changed })` sends the notice, and `ViewResult.partial` marks a partial answer. `watchView` (and so `useView`) asks a keyed view for just the rows a notice names, and places the answer by key over the rows it holds. In development and tests, it compares each partial answer with a whole run, logs the view's name when they differ, and shows the whole run.
  - **react:** `useResource` on a user or org collection re-reads just the entries a notice names, when it shows them all. A new entry, a notice with no ids, or an org with ids turned off still reads the collection.
  - **orchestration:** the board's task-list view (`taskToolViews`) answers a board notice with just the named tasks' rows and the rest of their follow-up chains.

  Docs: the Views page FIX-2623 adds at release (answering for the rows that changed: `ctx.view.changed`, `ctx.view.partial`, the never-reorder rule, the development check), apps/docs/guides/realtime.md (what a screen re-reads on a notice with ids), packages/core/README.md (`ctx.view`), packages/client/README.md (`client.view`'s `changed`, `ViewResult.partial`), packages/react/README.md (`useResource` re-reads named entries)

- 23bac7e: A view's watcher reads again only on a change to what the view read, and a task board's view re-reads only the tasks a change named (FIX-2625).

  - **engine:** a view's answer adds `hears`: for each of its topics, the kinds of change that may touch what its run read and, for a resource, the storage roots a change's path must fall under. A write to another resource of the same scope, or a run's own bookkeeping, no longer wakes it. A user-scope collection entry's change notice now names its collection's root (the static prefix of its pattern), never the entry's key, so a screen of another user resource can skip it.
  - **core:** new type `ViewHearing`, the shape of each `hears` entry: a topic, its `kinds`, and for a resource its `paths`.
  - **client:** `ViewResult.hears` carries it (`ViewHearing[]`), and `watchView` (and so `useView`) reads again only on a notice it admits, through the same path rule `client.live` uses. An answer from a server that sends no `hears` reads on every notice under its topics, as before.
  - **react:** a session collection list (`useResourceCollection`, `useResourceCollectionList`) reads once for one change. It holds each change signal (a named change, its count moving) for 50 ms and reads once after the last, and at least every 250 ms while signals keep coming. A list now shows a change up to 50 ms later than before.
  - **orchestration:** a view that reads a task board through its task collection hears the board's own notices, which name the tasks that changed, and no longer hears its ledger's notices on the user topic, which can't. Every write to a task ledger publishes the board notice.

  Docs: the Views page (what a view's watcher reads again on), apps/docs/guides/realtime.md (a user-scope entry's notice names its collection's root; a board view hears its board's notices), packages/core/README.md (`ViewHearing`, the shape of a view answer's `hears`), packages/client/README.md (`ViewResult.hears`)

### Patch Changes

- a27cf26: A task board open for one conversation no longer re-reads when a task is filed in another conversation of the same user (FIX-2750).

  - **contracts:** `WireNotice` gains an optional `partition`: on a `board` notice for a row added to a partitioned ledger, an opaque key for the partition the row went into. `ViewHearing` gains an optional `partitions`, the keys of the partitions a view's run read. `hearsNotice` skips a `board` notice whose `partition` the answer didn't read. A notice with no `partition`, or an answer that lists none, hears every board notice, as before.
  - **engine:** the push socket and the view route send a partition only as an HMAC-SHA256 key under the router's push secret, over the tenant and the partition. A key names no session and can't be matched by hashing guessed ids. Every process behind one address must share the push secret (`FSD_PUSH_SECRET`, or `serve({ pushSecret })`), which tickets already require. A host with no push names no partition in its answers. When the push secret changes while a socket is open (`secret: () => string`), the socket sends a `resync` on its topics before the first key made under the new secret, so every open view reads again.
  - **orchestration:** a partitioned task ledger (`partitionBy`) names its partition on each row-added notice and on each board read, so a conversation board hears only its own conversation's new rows.
  - **client:** a `partition` on a socket frame that isn't a string is dropped; the notice is kept.
  - **store-postgres:** the Postgres bus carries a notice's partition across processes, and drops it with the ids when the payload is too large.

  Docs: apps/docs/docs/api/client.md (the `onChange` notice can carry `partition` on a `board` notice: an opaque key to compare, never a session id)

- 3973e1f: An idle view stops re-reading on changes that can't touch what it shows (FIX-2695).

  - **client:** `client.live` with `topicsFromResult` now applies a result's `hears` (a view's answer, from `client.view`): a notice under the answer's topics that its hearings don't admit reads nothing. `LiveResult` gains an optional `hears`. Before, only `useView` applied it; a screen that passed `client.view`'s answer to `client.live` re-read on every notice under the topics, including each chunk of a reply streaming in the session.
  - **client:** when a live read's answer names new topics, it subscribes them before it lets go of the old ones, so a client whose only subscription is that live read keeps its socket instead of closing it and opening another.
  - **engine:** a view that reads a session's state hears only that session's `state` notices. A reply streaming in the session (`items`, `request`) and a request stamping the session record (`run`) no longer wake it. A view that reads the session itself (its items, metadata, window or journal, or another session through the request host) still hears every kind but `resource` and `board`.
  - **engine:** `publishScopeChange` is exported from `@flow-state-dev/engine/host`, for a host that writes a scope's state outside a run.
  - **fsdev:** `fsdev run --seed-session` on an existing session publishes a `state` notice on that session, so a live view that read its state reads again.

  Docs: none for users beyond the client reference's `client.live` entry (`hears` on a `topicsFromResult` result), if it lists `LiveResult`'s fields.

- 6407fbf: An action's answer is read with one call, by the request's id, however long its session is (FIX-2455).

  - **client:** `request.result({ pollMs?, timeoutMs?, signal? })` on every request handle polls the request by its id, as `wait()` does, with its stored result, and returns the read that found it settled. It resolves `{ status, output?, outputNotRecorded?, error? }` for every way a request settles: branch on `status`. A failure resolves `failed` with its `error`, and a stop for a user resolves `suspended`. It rejects only past `timeoutMs`, on a transport error, or when `signal` aborts. New types: `RequestResult` and `WaitOptions`. `wait()` takes `signal` too. Stopping either wait never stops the run. `steerRunningTurn` reads the steer's answer by id, so a steer behind 20 newer requests no longer reads as not taken.
  - **react:** `useAction({ action, result: true })`: `execute` resolves to `request.result()`'s shape, `loading` holds until the request settles, and an unmount stops the wait without stopping the run. Without the option, `execute` resolves on acceptance, as before.
  - **react (breaking):** `useReadFence` and `ReadFence` are no longer exported from `@flow-state-dev/react`. They moved to `@flow-state-dev/react/internal`, a subpath for the framework's own packages, with no alias. Apps should not import it.
  - **orchestration:** the Inbox client's board actions and row answers read the board's answer by request id. A session holding more than 2,000 requests no longer rejects an answer the board gave.
  - **workforce:** the Workforce client's roster and project actions (`hire`, `fork`, `edit`, `fire`, the standing rules and the work project) read their answer by request id, so a roster session longer than 100 requests no longer reads a finished action as unread.
  - **shift-manager:** actions, sent lines, interrupts and answered asks wait through the client's one wait and read their answer by request id.

  Docs: packages/client/README.md (a `result()` row in the request handle table, with its resolved shape and the rule that it resolves for every ending; `wait`'s `signal`; the _Sending an action_ example reads `const { status, output, error } = await sent.result()` instead of listing the session's requests), packages/react/README.md (`useAction`'s `result: true` option: what `execute` resolves to and how long `loading` holds; drop `useReadFence`), packages/engine/README.md (the status endpoint's `include_result_output` is what `result()` reads), apps/docs/docs/client/overview.md (_Sending an action_ and the _Requests_ table: `result()`), apps/docs/docs/fundamentals/actions.md (_From the client SDK_: read the answer with `sent.result()`), apps/docs/docs/api/client.md (`result` and `wait`'s `signal`), apps/docs/docs/client/react.md and apps/docs/docs/api/react.md (`useAction`'s `result` option), apps/docs/docs/fundamentals/flows.md (_Reads_: one line pointing at the `useSubscription` recipe in `client/react.md`), the package-roots page FIX-2448 adds, apps/docs/docs/api/package-roots.md (react's row gains `react/internal`: our packages' entry, not for apps)

- 995e1a8: A request's stream that ends before the request does is picked up again instead of leaving the view hanging (FIX-2675).

  - **client:** `request(id).stream()` resumes after the last event it delivered when the server ends the stream with no terminal `request.*` status (the server cuts off a reader that falls 4 MiB behind). It reconnects at once after a connection that delivered events, backs off (1 s, doubling) after one that delivered nothing, and gives up with `onError` after five such connections in a row. An error answer such as a 404 or 409 is reported with `onError` and not retried, and a local `close()` stops it.
  - **react:** when the inline stream of a turn `useSession` sent ends with no terminal status, the hook follows the request on `request(id).stream()` from the last event it applied, so the turn finishes with every item once rather than staying "streaming" until `isStuck`. A turn the caller stopped is not picked up again.

  Docs: apps/docs streaming / resume page (request streams resume themselves after an early end; `createSSEClientFromResponse` callers resume with `request(id).stream({ startingAfter })` from `onClose`), packages/client and packages/react READMEs if they describe stream ends.

- 8127ab6: A send the server never answers now fails instead of hanging (FIX-2866). `flow().send` waits up to 30 seconds for the server's answer to start; past that it aborts the request and rejects with a `ClientHttpError` of status 0, "The server didn't answer the send within 30 seconds." A message box on `useDraftSend` then gives Send back, keeps its text and shows the failure, so the person can retry. Set the limit with `createClient({ sendTimeoutMs })`; `0` waits for ever. Only the wait for the answer to start is timed: a streamed send that has started is never cut off.

  Docs: packages/client/README.md and apps/docs/docs/api/client.md (the `createClient` options: `sendTimeoutMs`, and the status-0 refusal a send can reject with)

- 18adad9: A session's request list says whether the server runs each request again when the caller retries it (FIX-2853).

  - **engine:** each entry of `GET /sessions/:sessionId/requests` carries `retryable`, the retry route's own rule with the host's `publicReentrySources`: the same answer a session's turns carry. A request a notification started is `false`, so a screen offers no Retry that the server would refuse.
  - **client:** `SessionRequestSummary.retryable?: boolean`, so `useSession`'s `latestRequest` carries it. Absent from a server that predates it; read absent as not retryable.

  Docs: apps/docs/docs/api/client.md (the `SessionRequestSummary` fields)

- Updated dependencies [091a1dd]
- Updated dependencies [04812f3]
- Updated dependencies [61efa05]
- Updated dependencies [ec99b11]
- Updated dependencies [4b4a7d4]
- Updated dependencies [8e111c9]
- Updated dependencies [d30f516]
- Updated dependencies [f888e69]
- Updated dependencies [2cb6326]
- Updated dependencies [2876f11]
- Updated dependencies [a27cf26]
- Updated dependencies [aa28006]
- Updated dependencies [e3ca793]
- Updated dependencies [7a2bb7e]
- Updated dependencies [ad80d4e]
- Updated dependencies [9d8f2be]
- Updated dependencies [0b56b1c]
- Updated dependencies [e505adf]
- Updated dependencies [98b888d]
- Updated dependencies [5b2bd16]
- Updated dependencies [fe85f56]
- Updated dependencies [8dfcb2e]
- Updated dependencies [091078d]
- Updated dependencies [a06ad2d]
- Updated dependencies [ec679dd]
- Updated dependencies [4394069]
- Updated dependencies [c7ce9ff]
- Updated dependencies [95d9686]
- Updated dependencies [1600ca1]
- Updated dependencies [6b360fa]
- Updated dependencies [3973e1f]
- Updated dependencies [41dcd7e]
- Updated dependencies [e238e18]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [3ef3979]
- Updated dependencies [3ef3979]
- Updated dependencies [ae106d2]
- Updated dependencies [030eb14]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
- Updated dependencies [da9484b]
- Updated dependencies [546603f]
- Updated dependencies [4a6643c]
- Updated dependencies [246f0ba]
- Updated dependencies [4698256]
- Updated dependencies [0454257]
- Updated dependencies [85ca2a3]
- Updated dependencies [714e98f]
- Updated dependencies [91184e2]
- Updated dependencies [1e58902]
- Updated dependencies [81c145c]
- Updated dependencies [13e3970]
- Updated dependencies [97c85bc]
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/core@0.6.0
  - @flow-state-dev/contracts@0.5.0

## 0.5.0

### Minor Changes

- a1386ea: A list of sessions stays current, and each row says whether its session needs you (FIX-2411).

  - **engine:** every write to a session or a request, except items and state field deltas, also publishes a `run` change notice on the owner's user topic, so a screen subscribed to `topic.user()` hears a session it doesn't list yet: created in another tab, by a script, or by `fsdev run`. `GET /sessions?include=status` adds `requestStatus` to each row: the status of the session's latest request, where one still running or stopped wins over a later one that ended, and, for a stopped one, `requestWaitsForUser`: whether it waits for the user or on other work. `include` takes a comma-separated list, so `include=dispatch-runs,status` combines both.
  - **client:** `sessions.list({ include })` takes `"status"`, or an array of includes. `SessionSummary` gains optional `requestStatus` and `requestWaitsForUser`.
  - **react:** new `useSessionList({ flowKind | flowId, includeDispatchRuns?, includeStatus?, enabled?, client? })` reads a flow's sessions with their state, again on a `run` notice on the user's topic and when the page becomes visible. `FlowNavigator` reads its open leaves through it, so its session rows are live when the client passes `subscribe` (a narrowed client without it reads once per opening, as before), and each row draws a state mark (running, waiting on you, waiting on other work, interrupted, failed, incomplete) and how long ago it changed. `sessionLabel`, `sessionRowState` and `sessionAge` are exported for a host that draws its own rows.

- 844a4f9: Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

  - **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` is removed. It never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it. Migration: replace `fsd.stream({ onResourceChanged, onScopeStateChanged, ... })` with `fsd.subscribe([topic.user(), topic.org()], { onChange: () => reread() })`, and read what you show in `onChange`. A notice carries no rows, so the read is what tells you what changed.
  - **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
  - **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
  - **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
  - **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [f1e6315]
- Updated dependencies [bc65135]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/core@0.5.0
  - @flow-state-dev/contracts@0.4.0

## 0.4.0

### Minor Changes

- 147d923: `@flow-state-dev/client` exports `sessionFeed(client, sessionId)`: one session followed without React, starting from its newest items (`readSessionTail`), with its items, its unfinished runs, and a connection `state` (`connecting`, `live`, `reconnecting`, `lapsed`, `stopped`) that recovers on its own after a dropped connection. `followResponse(response)` keeps a send's answer as it is written. `useSession` now follows sessions through the same code, with no change to what it shows (FIX-2374).

### Patch Changes

- b9e6dd0: Stopping an `interrupted` request that no gate holds now ends it `aborted`: `POST …/abort` answers 204 instead of 409, and the request leaves `requests.interrupted()`. `@flow-state-dev/client` exports `interruptedBySession(requests, { actions })`, which groups what `requests.interrupted()` returned by session, oldest first, keeping only the named actions (FIX-2377).
- 29579d4: `sessionFeed` can reach a long session's older history. Its snapshot carries `hasEarlier`, true while the session holds items before the first one shown, and `feed.loadEarlier()` adds the page before them, with no gap or duplicate, while live items keep arriving. Draw a _Load earlier_ button from it (FIX-2505).
- 0554e0b: `@flow-state-dev/client` exports `readSessionTail`, `readSessionEarlier` and `refreshSessionWindow`: read a long session from its newest end, add earlier items on request, and read the window again, so a conversation past a few hundred items still shows its newest reply (FIX-2408).
- Updated dependencies [e0daf6e]
- Updated dependencies [151309c]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/contracts@0.3.0
  - @flow-state-dev/core@0.4.0

## 0.3.0

### Minor Changes

- 92b2b70: A conversation longer than its history window can keep what it said before the window (FIX-1613). `utility.historySummary({ summarize })` returns a `capability` for the generator that answers and a `fold` step to run before it: the fold writes the turns about to leave the window into a running summary, the capability hands that summary to the model and starts the generator's history after it. A capability preset may now declare `history` (a query added to that generator's history reads; generators only). The engine records `historyStart` on a request when earlier turns are out of view, exposes `ctx.session.window`, `ctx.session.items.turns()` and `history({ afterRequestId })`, and the client's request summary carries `historyStart`. Workforce's `defineAgentWorkerFlow` takes `beforeAnswer`, a block run before the worker answers.
- 5d31955: A flow can declare `reads`: blocks an app runs on a session to look at something the flow computes, stored nowhere. The engine serves them at `POST /:flowKind/:sessionId/reads/:readName`, answering `200 { output }` with no request record and no concurrency slot; any write a read's block tries is refused with `read_only`, and another user's session answers 404 as the action route does. The client calls one with `flow(kind).read(name, input, { sessionId })`. Orchestration adds `taskToolReads(collectionId, resolve)`, the `listTasks_<suffix>` listing as a read, and Workforce's coordinator and agent-worker flows now serve `listTasks_tasks` as a read, so an app polling a conversation's task board no longer stores a request per poll. The action of the same name is unchanged (FIX-2286).
- e2c190e: A running coding turn can take a message mid-turn (FIX-2254). Core declares the optional harness hook `onSteerable(steer | null, ctx)` (`HarnessSteer`, `HarnessSteerHook`): a harness whose run can take a line calls it with a `steer` that answers `"delivered"` or `"refused"`, and with `null` when the turn is over. `cursorAgent({ onSteerable })` offers Cursor's own run steering on local runs, through the `env` process too. The harness manager hands down `onSteerable` as an optional fifth feed; passed through, a message sent to the task while a step runs goes straight into that step, with no stop, extra step or new attempt. A line the run refuses is taken by the next step, as before.

  `autoResume: false` on an action (core's `ActionCore`, honoured by the engine) keeps a request on it from becoming its session's auto-resume target (`latestRequestId`), so a control sent beside a running request, such as that line, doesn't stop a reloading client from reattaching to the running one.

  Any app can steer a harness turn run in a session: `harnessSteering()` in core keeps each session's offer and builds the `steer` action (`{ taken, live }`), and the client's `sendHarnessLine` and `steerRunningTurn` send a typed line into the running turn, falling back to the next turn when it isn't taken.

- f6461ea: One client. `createClient({ userId, baseUrl?, apiPath?, fetcher? })` builds the only client: `flow(address)` sends actions (typed with `flow<typeof myFlow>(…)`), starts sessions and returns request handles; `sessions`, `resources`, `requests.interrupted()`, `stream` and `transcribe` hang off the client. A request handle has `status`, `wait`, `abort`, `continue`, `retry`, `resume` and `stream`, and `continue`/`resume` carry the run on under the same id. `fetcher` is the one transport every call and stream goes through, so the engine's `createInProcessFetch` reaches a host in the same process with no web server. Removed: `createTypedClient`, `createSessionClient`, `createResourceClient`, `createRecoveryClient`, `createSSEClient`, `createSessionSSEClient`, `createUserSSEClient`, the standalone `transcribe`, `flowKind` on `createClient`, and the `*Stream` method twins (pass `{ stream: true }` instead). `sessions.list` with no `userId` now lists the client's own user's sessions. Every failure is a `ClientHttpError`; `status: 0` means the client refused before sending (FIX-2162).
- 97894aa: A flow can check every new session's initial state with `session.createCheck`, refuse caller-seeded fields with `session.serverOwned`, and fix a field for a session's life by declaring it `.readonly()` in its session `stateSchema`; `listSessions({ state })` and the list route's `state.<field>` filter select sessions by a readonly field. On a flow that binds its sessions this way (a readonly field or a create check), an initial state that fails the `stateSchema` is refused on every path that creates a session; other flows keep it as sent. A dispatcher's `session: { key, state }` and a task dispatcher's `state` create the child session with that state. `ensureSessionRecord` now takes the create request beside the record it builds (FIX-1788).
- cd180d7: Stopping a paused request now ends it `aborted` and records its gate with the new `stopped` suspension status, a turn paused on an ask cancels the asked task instead of waiting for it, and a durable host now runs the durability sweeper even without `durabilityRetention`, so a paused request past its `expiresAt` expires and an ask past its deadline times out, while pruning still waits for a retention policy (FIX-1816).
- d97031f: The suspension reasons that wait for a user are now `"user_approval"` and `"user_input"`, renamed from `"human_approval"` and `"human_input"`. Nothing reads the old values: `SuspensionReason` still accepts any string, so a `ctx.suspend` or a `useSuspensions({ reasons })` filter that still passes an old value compiles but is treated as a custom reason: it is not a user's stop, gets no Inbox item, and an old `"human_input"` stop defaults to approve/reject instead of submit. Search your code for both old strings and replace them. Stored suspensions with the old reasons are not migrated (FIX-2151).
- 49d2aca: A stop that waits for a user holds its task and ends exactly once (FIX-2129).

  - **`ctx.suspendForUser({ kind, prompt, deadline? })`** (`core`): stop the request for an `approval`, a `review` or an `input`. It returns the answer, or `{ cancelled: true }` when the task was cancelled while it waited. At its deadline an approval reads as a no (`deadline: true`) and a review or an input throws `SuspensionTimeoutError`, which the block may catch. With no `deadline`, the host's `userDeadlineMs` applies, else none: the stop waits until it is answered, stopped or cancelled. The model's tool is `suspendForUser`; the task's open stop is listed on `Task.holds`.
  - **The answer route** (`engine`): `POST /api/flows/:flowKind/requests/:requestId/answer` answers a user's stop in any run, a task board's included, after the resume path's ownership checks; a request handle's `answer` (`client`) calls it. Who answered is the signed-in caller.
  - **`userDeadlineMs`** (`createFlowState`, `engine`): the host's deadline for a user's stop, unset by default.
  - **Cancel one stop:** `RequestHost.resumeWait({ suspension: { requestId, suspensionId }, outcome: { cancelled: true } })`.
  - `contracts` exports `isUserSuspension` and `suspendForUserKindOf`, and `SuspensionStatus` gains `"cancelled"`.

  A raw `ctx.suspend` with `user_approval` or `user_input` now gets the same mark, cancel and stop as `suspendForUser`. A raw `user_input` stop past its `timeoutMs` now resumes its block with `SuspensionTimeoutError` instead of staying parked, and a cancelled one throws `SuspensionRejectedError` with `cancelled: true`. A filing by a cancelled task is refused (`TaskFilingRefusedError`, rule `parent_cancelled`). Shift Manager answers every ask through the answer route.

### Patch Changes

- 585b75b: `POST /api/flows/users/:userId/check-interrupted` and `createRecoveryClient().checkInterrupted({ staleThresholdMs })` now use the larger of the caller's `staleThresholdMs` and the server's `staleSweepThresholdMs`, so a smaller, zero, or negative value sweeps as if it were left out and a request that is still heartbeating is never marked `interrupted` (to sweep sooner, lower `staleSweepThresholdMs` on the server) (FIX-1571).
- 49852d9: `abortRequest` now rejects with a `ClientHttpError` carrying the route's `status` (for example 409 when the request had already finished, 403 when it isn't yours), instead of a plain `Error`. The message is unchanged, so code that reads it keeps working (FIX-1664).
- 698e06b: New `apiPath` option on every client constructor and on `FlowProvider` names where the server mounts the flow API (default `/api/flows`), so the client and React hooks can reach a Node server started with a custom `basePath`. Requests go to `baseUrl` + `apiPath` + route; with `apiPath` unset, every URL is unchanged. The `@flow-state-dev/node` README documents pairing `basePath` with `apiPath` (FIX-1677).
- 60d1bf4: Request routes answer a caller from another organization with the same 404 an unused request id gets, so a request's existence no longer shows across organizations (FIX-2194). The resume route records the signed-in caller as who resumed a suspension (the request's owner when the app doesn't authenticate) and ignores a `resumedBy` in the body; `ResumeSuspensionBody.resumedBy` is deprecated (FIX-2195).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- 65ddb90: Each request's record now stores its action result (`output` as JSON, and/or `error`) with its final status, `listSessionRequests` returns it (the output with `includeResultOutput`), the DevTool task row reads it instead of reconstructing it from traces, and a run a completion hook failed after the action answered now reports that answer as `output` (including `fsdev run`'s result, where it was `null`) (FIX-1661).
- 60c8192: `getItems()`, `RequestRecord.items` and item subscriptions return `RuntimeItem`, which is `OutputItem` plus trace rows: `block_trace`, `router_decision`, `state_snapshot` and `generator_step` (FIX-2054). Only types change. Runtime behaviour is the same.

  These signatures return or pass `RuntimeItem`, which can break code that expects `OutputItem`:

  - `ResponseEmitterHandle.getItems()` and the `subscribeToItems` listener and filter (core).
  - `ResponseEmitter.getItems()`, `RequestRecord.items` and `RequestStore.persistItems` (engine).
  - The `testItems` selectors that don't filter by type: `all()`, `sideChain()`, `main()`, `byAgent()` and `byVisibility()` (testing). They return trace rows when given them.

  To upgrade, type arrays and callbacks that receive these values as `RuntimeItem`, imported from `@flow-state-dev/core`. Where code needs an `OutputItem`, filter out the trace rows with a type guard:

  ```ts
  import type { RuntimeItem } from "@flow-state-dev/core";
  import type { OutputItem } from "@flow-state-dev/core/items";

  const TRACE = new Set([
    "block_trace",
    "router_decision",
    "state_snapshot",
    "generator_step",
  ]);
  const isOutputItem = (item: RuntimeItem): item is OutputItem =>
    !TRACE.has(item.type);

  const visible = emitter.getItems().filter(isOutputItem);
  ```

  `.waitForCondition` predicates and `wakeOn` filters keep their `OutputItem` types. These signatures accept `RuntimeItem` as well as `OutputItem`: `resolveItemVisibility` and `collapseToCanonicalLog` (contracts, re-exported by core), `testItems` (testing), and the filter that `onTaskChangeFor` returns (orchestration). Existing callers need no change.

  `RequestStreamStore` and `createRequestStreamStore` (client) take the row type as a parameter, defaulting to `OutputItem`, so existing stores are unchanged. A store seeded with trace rows is created as `createRequestStreamStore<RuntimeItem>()`, and its `getSorted()`, `getRaw()`, `getById()` and `getOwnedBy()` return `RuntimeItem`.

- b7c523b: Add `createSessionSSEClient(options)`, a client for the whole-session stream. It reconnects with backoff, handing back the last server time it heard, and stops without retrying when the server refuses the session (401, 403, or a 409 for a session that must be migrated first) or has no such route (FIX-1609).

  `createRequestStreamStore` takes an optional `keyOf`, the key each item is held under (default: its id). A store that holds more than one request's items keys by request and item id, since two requests can keep the same id.

  `SessionStateSnapshotResponse` has an optional `at`, and `createSessionSSEClient`'s `since` accepts it. It also has an optional `sessionCreatedAt`, and `createSessionSSEClient` takes it as `sessionCreatedAt` and names that session on every connection: once the id holds another session, the server answers 404 and the client stops. `compareItemOrder` breaks a tie on time and index by request id, then item id, where it used to return 0.

  `createSessionSSEClient` takes `onReconnecting`, called before each reconnect with how many tries there have been since the stream last delivered an event: 1 after an ordinary close, 2 or more once a try has failed.

- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [617aeab]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [65ad58a]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [fa7b22e]
- Updated dependencies [d1a4cab]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b7c523b]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/contracts@0.2.0

## 0.2.0

### Minor Changes

- 6b8bfe4: Sessions a dispatcher ran work in are listable on their flow: `GET /sessions` takes `include=dispatch-runs` (off by default), `listSessions` takes `include`, `FlowNavigator` takes `includeDispatchRuns` and draws a run one level under the session that started it, the DevTool shows runs in the rail and inside a session's block tree on demand in place of its Children tab, and `requestHost.livenessOf` now also answers for a dispatch run under the caller's own principal, tenant, organization and flow instance rather than only for one beneath the asking session (FIX-1440).

  The dispatch-run liveness arm compares the caller's organization against the active-request entry as well as the session record. Both comparisons are required: they read separately stamped rows, and a caller whose organization was not forwarded to the read matched only entries carrying no organization at all.

- b48158a: Organization identity is now required on every request (FIX-1442).

  A session, request, dispatched child and scheduled job each carry an
  organization, and the server checks it on reads and execution alongside the
  user. It comes from a configured `resolvePrincipal`, or — when an app
  configures no resolver — from the new reserved `DEFAULT_ORG_ID` exported by
  `@flow-state-dev/core`. A caller-supplied `orgId` is never authoritative.

  **What you need to change**

  - A resolver must return a verified `orgId`. Returning none, a blank one, or
    `DEFAULT_ORG_ID` is refused with 401. A machine transport may return
    `{ orgId }` alone and let `defaultUserId` name its system user.
  - Direct `runAction` calls must pass `orgId` — your verified organization, or
    `DEFAULT_ORG_ID` for single-organization development.
  - `authentication.requireOrg` and a block's `requireOrg` are removed.
    Organization is unconditional, so the declaration had nothing left to say;
    a config that still carries either is rejected at definition time rather
    than ignored.
  - Client and React session APIs no longer take an `orgId` — the server owns
    it. `SessionDetail.orgId` is now required on the way back.
  - `openChannels` no longer takes an `orgId`; the server binds the channel.
  - A queued BullMQ job that carries no organization now fails terminally
    instead of being retried: a worker runs below principal resolution, so no
    later attempt could supply one. Subscribers receive an error terminal rather
    than waiting for a job that never completes.

  **The schedule index stores the organization.** `schedule_index` gains a
  nullable `org_id` column in both the SQLite and PostgreSQL adapters, so the
  organization a schedule fires into survives a round trip through the database.
  The column is added for you on the next schema init — there is no manual DDL
  step. Existing rows read back with no organization and are quarantined rather
  than dispatched, so a schedule written before this upgrade does not fire until
  it is attributed; rewriting it stamps the organization of the execution that
  writes it.

  **Upgrading a store with existing data.** Records written before this carry no
  organization. They are preserved and refused (`409 migration-required`) rather
  than guessed at, and listings and scheduler scans skip them. Attribute them
  offline first — the procedure, including dynamic schedules, index rebuild and
  the reserved-id collision check, is in the persistence guide under "Which
  organization a record belongs to".

### Patch Changes

- 795b550: The debug resource snapshot now reports each resource's `writable` and `llmWritable` settings where they are declared, and the DevTool marks a resource read-only when `writable` is `false` (FIX-1481).
- 4833ff8: `FlowNavigator` browses your flow kinds and their sessions, reading each kind's depth from its declared `cardinality` and fetching sessions only when a leaf opens, and `sessionQueryFor` turns a flow address into the right session-listing filter (FIX-1477).
- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/contracts@0.1.2

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/contracts@0.1.1
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- b3e6e22: Initial release (FIX-1187).
- fda9b15: Background work is declared with a task-board dispatcher seat and read back as child sessions: a session's children are listed at `GET /sessions/:sessionId/children` through `listChildSessions()` and `useSession`'s `childSessions` / `childSessionsStale`, session-scoped resources shared with them use `sharedToLineage`, and the two `createFlowState` options are `dispatchDrainTimeoutMs` and `maxChildSessionListLimit`; the Workstream surface they replace is removed, `ctx.requestHost.startDetached` and `dispatch: { mode: "detached" }` with it (FIX-1308). From `@flow-state-dev/orchestration/task-board` that removes the detached-mode helpers (`assertDetachedBoardSupported`, `detachedTaskPredicate`, `coordinateKey`, `coordinateLabel`, `workstreamRoutingSeed`, `WorkerCoordinate`, `TaskWorkerDispatch`, `TaskWorkerSlot`, `TaskWorkerSlotRegistry`, `TaskWorkerEntry`, `isTaskWorkerEntry`) and `board.detachedWorkers`; a seat is a block or a `dispatcher({ type: "task" })`, and `resolveWorkerSlots` now returns the bare blocks plus the `HandOffSeat`s (`name`, `label`, `dispatch`) in one walk from the hand-off module. A `{ worker, dispatch }` or `{ block, session }` seat is refused by name at construction. The DevTool's Children panel pairs a child with its task from the dispatch key a `per-task` or `per-worker` seat derives (a `{ key }` policy pairs nothing) and shows the entry it was dispatched for.

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/contracts@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-07 — Lazy collection state, query interface, resource manifest (FIX-427) [BREAKING]

Client surface updated to match the new paginated list, single-item state, and manifest endpoints. Collection snapshots no longer carry an eager `items` map.

### 2026-05-06 — `clientData` privacy fix + rename (FIX-505) [BREAKING]

`FlowClient.state.getSessionState` / `getUserState` / `getOrgState` are removed — they were typed against the privacy-broken response. `getSnapshot` remains; read `clientData.<scope>` from it.

### 2026-04-30 — Connection resilience (FIX-476)

Client SSE parser detects `: ping` comment frames and fires a new `onHeartbeat` callback alongside regular events.

### 2026-04-28 — Interrupted-request recovery

New `createRecoveryClient` with `checkInterrupted` and `retry` methods.

### 2026-04-26 — Org scope rename (FIX-428) [BREAKING]

Client API renamed `project` → `org` across snapshot fields, scope helpers, and recovery routes.
