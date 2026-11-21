# @flow-state-dev/contracts

## 0.5.0

### Minor Changes

- 04812f3: A server block can read the running user's pending asks across every session in one call, `sessions.userSuspensions({ flowKinds })`, and a view that reads it wakes only when a suspension changes (FIX-2770).

  - **engine (breaking for custom stores):** `SuspensionStore` has a new required method, `listPendingForUser(query)`: one query that joins each suspension to its request and applies the user, tenant, organization, flow, pending status, expiry and waits-on-a-person checks inside it, returning rows built with `projectUserSuspension`. A custom suspension store gets a type error until it implements it; run `createPendingUserSuspensionsConformanceTests` from `@flow-state-dev/engine/testing` against it. `createInMemorySuspensionStore({ requests })` and `createFilesystemSuspensionStore(rootDir, { requests })` take the request store they join to; built without it, the method throws a `FlowStateConfigError`. `createInMemoryStores` and `createFilesystemStores` pass it for you.
  - **core:** the request host's `sessions` gains `userSuspensions({ flowKinds, after? })`: the principal's pending suspensions on 0 to 50 named flow kinds (more throws `FlowStateConfigError`), oldest first, 200 a page, with `more` and a `next` cursor `{ createdAt, requestId, suspensionId }` to pass back as `after`. Each row carries the ids, flow, session, kind, card shape, title, message, allowed actions, schema, render and times, never the run's `stepInput`, `resumeData` or `data`. A user or session view may call it; an org view may not.
  - **contracts / client:** a new change kind, `"suspension"`, published on a user's topic when a suspension waiting on them is written or deleted (never for a wait gate or an outside event's stop). A client that switches over every `ChangeKind` gets a new case.
  - **core:** `suspensionShape`, `SuspensionShape` and `USER_SUSPENSION_REASONS` (every stored reason that waits on a person) are exported from `@flow-state-dev/core/types`, beside `isUserSuspension`, along with `projectUserSuspension` and the row and query types a store builds. `@flow-state-dev/react` still exports `suspensionShape`, `SuspensionShape`, `SchemaField` and `SuspensionValueKind`, the same functions and types it had.
  - **contracts:** the card shape and schema analysis (`suspensionShape`, `analyzeResumeSchema`) and `USER_SUSPENSION_REASONS` live on the `@flow-state-dev/contracts/types/suspension` subpath, which core and react re-export from.

  Docs: packages/core/README.md (request host section: `sessions.userSuspensions`), packages/engine/README.md (the store method an adapter implements), apps/docs/docs/api/client.md (the `suspension` notice kind)

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

- a27cf26: A task board open for one conversation no longer re-reads when a task is filed in another conversation of the same user (FIX-2750).

  - **contracts:** `WireNotice` gains an optional `partition`: on a `board` notice for a row added to a partitioned ledger, an opaque key for the partition the row went into. `ViewHearing` gains an optional `partitions`, the keys of the partitions a view's run read. `hearsNotice` skips a `board` notice whose `partition` the answer didn't read. A notice with no `partition`, or an answer that lists none, hears every board notice, as before.
  - **engine:** the push socket and the view route send a partition only as an HMAC-SHA256 key under the router's push secret, over the tenant and the partition. A key names no session and can't be matched by hashing guessed ids. Every process behind one address must share the push secret (`FSD_PUSH_SECRET`, or `serve({ pushSecret })`), which tickets already require. A host with no push names no partition in its answers. When the push secret changes while a socket is open (`secret: () => string`), the socket sends a `resync` on its topics before the first key made under the new secret, so every open view reads again.
  - **orchestration:** a partitioned task ledger (`partitionBy`) names its partition on each row-added notice and on each board read, so a conversation board hears only its own conversation's new rows.
  - **client:** a `partition` on a socket frame that isn't a string is dropped; the notice is kept.
  - **store-postgres:** the Postgres bus carries a notice's partition across processes, and drops it with the ids when the payload is too large.

  Docs: apps/docs/docs/api/client.md (the `onChange` notice can carry `partition` on a `board` notice: an opaque key to compare, never a session id)

- e505adf: Structured content is one item kind, `data`, emitted with `ctx.emit.data(dataType, value, { key? })` (FIX-2738). The `component` item kind is removed, with no alias: a "component" is now a `dataType` with a renderer registered for it.

  **Breaking.**

  - **core / engine:** `ctx.emit.component` is removed. `ctx.emit.data(dataType, value, options?)` emits `{ type: "data", dataType, value, key? }`. Options are `key` (keyed snapshot: id `item_data_keyed:<key>`, one entry per request and key, `value` replaced), `itemVisibility`, `agentName` and `transient` (default `false`, persisted). Migrate `ctx.emit.component(name, data, opts)` to `ctx.emit.data(name, data, opts)`.
  - **contracts / core:** `ComponentItem` is removed from the `OutputItem` union; `DataItem` replaces it. With no `itemVisibility` a data item reaches the client and never model history (`{ client: true, history: false }`); `itemVisibility` overrides both. With `history: true`, a turn's history replays it as one assistant line, `[dataType] <value as JSON>`. A reader filters `item.type === "data"` and `item.dataType`, and reads `item.value` (not `item.data`).
  - **react:** `RendererRegistry.data` holds item renderers, keyed by `dataType`. A data item with no renderer there renders nothing, never the JSON fallback, so it stays invisible in the UI and readable by code. `renderers.component` no longer draws items: it holds only the renderers a `suspension` item names with `render.component`. Move `renderers={{ component: { x: X } }}` to `renderers={{ data: { x: X } }}`; `X` receives `{ item: DataItem }`. Keyed data items dedup per request and key, and a container renderer manages the data items it owns. `useContainerItems` reads a container's `state` from its latest data item whose `dataType` is the container's `component`; `componentsByKey` is renamed `dataByKey`, with no alias.
  - **testing:** `testItems(items).components()` is removed; use `testItems(items).data(dataType?)`.
  - **orchestration:** `task-change`, `task-board-meta`, `task-board-recorder-failure` and `goal-seek-loop-termination` are data items. The constants are renamed, with no alias: `TASK_CHANGE_DATA_TYPE`, `TASK_BOARD_META_DATA_TYPE`, `TASK_BOARD_RECORDER_FAILURE_DATA_TYPE`, `GOAL_SEEK_LOOP_TERMINATION_DATA_TYPE`. The recorder-failure and termination records reach no client.
  - **workforce:** `coordinator-route` and `workforce:received` are data items; `RECEIVED_MESSAGE_COMPONENT` is renamed `RECEIVED_MESSAGE_DATA_TYPE`, with no alias. An app renderer for either moves to `renderers.data` and reads `item.value`.
  - **patterns:** debate's `debate-turn`, `debate-turn-pending`, `debate-decision` and `debate-verdict`, event actors' `rb-entry`, routed specialists' `routedSpecialists` snapshot and the response auditor's `audit-annotation` are data items. An app renderer for one moves to `renderers.data` and reads `item.value`.
  - **ui registry:** the generative `link-card` and `info-card` tools emit data items, and their renderers register under `renderers.data`.
  - **devtool / shift-manager:** draw data items; the devtool's component item view is gone.

  **Stored sessions.** A request stored before this can hold `component` items. The request store reads each one back as a data item (`component` → `dataType`, `data` → `value`, same status and key), in a record and in a replayed or resumed stream, so every reader sees data items. A keyed item's id reads back as `item_data_keyed:<key>`, so a resumed request's next snapshot of that key replaces it. This applies on every entry that runs flows (`createFlowState`, `createFlowApiRouter`, `runAction`, `fsdev run`, `dev` and `chat`); host code reading a store directly, past those entries, sees the stored shape. Nothing is rewritten in the store.

  Docs: apps/docs/docs/streaming/emitting-items.md (one item kind for structured content: `ctx.emit.data`, `value`, keyed snapshots, default visibility, drawing through `renderers.data`; remove every `ctx.emit.component` section), apps/docs/docs/streaming/overview.md and apps/docs/docs/configuration/blocks.md (emitter tables), apps/docs/docs/client/react.md, apps/docs/docs/api/react.md and packages/react/README.md (`renderers.data`, `renderers.component` for suspensions only, `useContainerItems` `dataByKey`), packages/core/README.md (emitters), apps/docs/docs/orchestration/task-board.md, apps/docs/docs/orchestration/task-substrate.md, apps/docs/docs/sequencers/wait-for-condition.md and packages/orchestration/README.md (task records are data items, renamed constants), apps/docs/docs/patterns/plan-and-execute.md, apps/docs/docs/patterns/response-auditor.md, apps/docs/docs/patterns/event-actors.md and packages/patterns/README.md (pattern records are data items, renderers go under `data`), apps/docs/docs/ui/flow-aware-components.md and packages/ui/README.md (generative cards and the chat registry use the `data` slot), apps/docs/docs/workforce/coordinators.md, packages/workforce/README.md and packages/shift-manager/README.md (routing records and received messages are data items, renamed constant), apps/docs/docs/api/testing.md, apps/docs/docs/testing/testing-flows.md, apps/docs/docs/testing/overview.md and packages/testing/README.md (`testItems().data()`, `components()` removed).

- 5b2bd16: Documents: PDFs, text, Markdown, CSV and code files reach every model and harness (FIX-2520).

  - **contracts / core:** the attachment list takes text-like files (`ATTACHMENT_TEXT_TYPES`: text, Markdown, CSV, JSON, YAML, HTML, XML; source files as `text/plain`) beside images and PDFs. Each counts as a document against the five per message. `attachmentMediaType({ name, type })` types a picked file by its extension for text-like files (a browser types `.ts` as video); `ATTACHMENT_ACCEPT` is the `<input accept>` list for everything the list takes. `attachmentSentAs(mediaType, accepts)` says how a file reaches a target: a text-like file always as text headed `### <filename>` (`formatAttachmentText`), a PDF as a file where the target's `accepts` lists it and as its text elsewhere, an image only as a file. `AttachmentTextTooLargeError` (`code: "pdf_text_too_large"`) names a PDF whose text is over 200 KB.
  - **core:** a generator's model calls send a PDF as a file where the model's provider reads PDFs (Anthropic, OpenAI, Google) and as its extracted text for any other provider; `ModelResolver.prepareMessages` takes an optional `{ accepts }` target. The provider is read from `providerOf`, so a resolver that maps its own model aliases should map `providerOf` too. From `@flow-state-dev/core/harness`: `readHarnessTurnFiles(harness, ctx, accepts, files)` refuses, reads and splits a turn's files into those the harness reads and the text of the rest, and `promptWithTurnText(prompt, turn)` puts that text after the prompt. `HarnessAttachmentBytes` gains `text()`. `refuseUnacceptedAttachments` now passes a PDF or text-like file to a harness that declares `accepts`, since it can take the document's text.
  - **engine:** the upload route checks a document before storing it: a text-like file must be UTF-8 with no NUL bytes and at most 200 KB, refused over it with its size, never cut (413 `attachment_text_too_large`, 415 `attachment_not_text`); a PDF must open and have at most 100 pages (413 `pdf_too_many_pages`, 415 `pdf_unreadable`). A PDF's text is extracted once at upload, page by page, a page with no text layer saying so, and kept in the blob store beside the PDF, claimed and deleted with it. A turn whose target gets a PDF's text fails before the target is called when that text is over 200 KB. New dependency: `unpdf`.
  - **claude-code:** reads PDFs as document blocks; a text-like file goes as text after the prompt.
  - **codex / cursor:** a PDF and a text-like file go as their text after the prompt. A scanned page has no text to hand over, and says so.
  - **ui:** the composer takes every type the list takes by default, types text-like files by name, and refuses a text file over 200 KB, and a PDF the server counts over 100 pages, by name.

  Docs: the documents table in the attachments guide (each type by target: a generator by provider, Claude Code, Codex, Cursor; that a scanned page has no text for Codex, Cursor and a provider that can't read PDFs; text files whole up to 200 KB, refused over it; PDFs to 100 pages; Word, Excel and PowerPoint refused); the limits line for PDFs and text files in packages/contracts/README.md; `readHarnessTurnFiles` and `promptWithTurnText` in packages/core/README.md; a line in packages/claude-code/README.md, packages/codex/README.md and packages/cursor/README.md on documents; the composer's default `accept` in the ui registry docs.

- b43424c: A change notice names what changed, so a screen can re-read only those rows (FIX-2625).

  - **contracts / client:** `WireNotice` gains `ids?: string[]`: the ids of what changed, never its data. Absent means read everything. A `board` notice names the tasks whose rows changed, a collection entry's `resource` notice names the entry's storage key (only when its path may be named: never an owner-private row or a user-scope entry), a `run` notice on a parent session's topic names the child session (on a user's own topic it names nothing, since that topic spans the user's orgs), and a `request` notice names the request. `items`, `state` and `resync` name nothing. `client.live` and `client.subscribe` pass them through; notices of one topic and kind waiting on a read union their ids, up to 100, past which a notice names none.
  - **engine:** `createFlowState({ noticeIds: { org: false } })` (also on `createFlowApiRouter`) turns ids off for a topic scope, for an app where even the timing of an org's changes is sensitive. No notice of that scope reaches a browser with ids, and a resource notice reaches a scope-wide subscription with no path, so every resource watcher in that scope reads everything on any resource change. On by default. A key other than `session`, `user` or `org`, or a non-boolean value, is refused at startup.
  - **store-postgres:** the Postgres bus carries ids across processes; a notice too large for `NOTIFY` drops its ids before it is widened to its scope.
  - **orchestration:** a task board's change notice names the task.

  A client from before this change ignores `ids` and reads everything, as before.

  Docs: apps/docs/guides/realtime.md (ids on a notice; turning them off per scope with `noticeIds`), apps/docs/docs/api/client.md (`WireNotice.ids`), apps/docs/docs/persistence/overview.md (what the Postgres bus carries), packages/client/README.md (`WireNotice.ids`), packages/engine/README.md (`noticeIds`), packages/core/README.md (notice ids)

- ae106d2: Every projects flow built from `defineProjectBlocks` now serves the project setup view and each user's connector keys route, and an app reads the organization and four collections it used to name by hand (FIX-2775).

  - **workforce:** `defineProjectBlocks({ projectCoordinator })` takes the worker each user's project coordinator runs as. Its `views` always carry `projectSetup`, which answers `{ projectCoordinator }`, `null` when the option is absent, read with no session. A browser reads it with `projectSetupView` from `@flow-state-dev/workforce/browser` (`client.view(projectSetupView, {})` or `useView`). Its answer's type is `ProjectSetup`, and the view's definition type is `ProjectSetupView`; both are on the root and on `/browser`.
  - **workforce:** `defineProjectBlocks(...).connectorKeys` is the keys route as an inbound transport adapter: mount it with `createFlowState({ adapters: [projects.connectorKeys] })`. At `CONNECTOR_KEYS_PATH` (`/api/flows/mcp-credentials`, on the root and on `/browser`), `GET` answers each server in `mcpServers` and when the caller set a key for it (`ConnectorKeyStatus[]`, each `{ name, setAt }` with `setAt` `null` when unset; never the key), `POST <path>/<server>` with `{ value }` sets one and `DELETE <path>/<server>` clears it. The caller is the user the projects flow's sign-in verifies; anyone else gets 401 before anything is read. A host that offers no servers serves no route. Keys stay under `mcp-credentials/<server>` in the user's scope. `connectorKeyStatuses(host, cell, servers)`, on the root, reads the same answer on the server from the host's stores for one user's cell, for a host's own start line.
  - **workforce:** `WorkforceClient.organization()` answers the organization the server acts in for the signed-in user, read once per client. A 401 or 403 rejection is a refusal.
  - **workforce:** `@flow-state-dev/workforce/browser` exports `workerInventoryResource`, `projectsResource`, `privateProjectsResource` and `workerMessagesResource`, for `client.resource(def)` or `useResource(def)`, typed by what each collection's browser read publishes.

  Docs: packages/workforce/README.md (`organization()`; the four collection definitions on `/browser`; what `defineProjectBlocks` now serves: the `projectSetup` view with `projectCoordinator`, `ProjectSetup` and `ProjectSetupView`, and the `connectorKeys` route with `CONNECTOR_KEYS_PATH`, `ConnectorKeyStatus`, `connectorKeyStatuses`, its answers and refusals).

  - **workforce:** the connector keys route refuses a set or clear sent from another site (`sec-fetch-site: cross-site`, 403) and a set whose body isn't `application/json` (415), as the engine refuses every other browser write.
  - **contracts:** `isJsonMediaType(contentType)` on `@flow-state-dev/contracts/helpers` says whether a content type's essence is `application/json`; the engine's JSON body rule and the keys route share it.

- de09b77: **Breaking:** 1,107 exports are removed from the roots of the published `@flow-state-dev/*` packages, with no deprecated aliases, so importing one from a package root no longer compiles; some of them are still exported from another entry of the same package (FIX-2562).
- da9484b: `isUserSuspension` and `suspendForUserKindOf` read a stop core 0.2.0 stored under `human_approval` or `human_input` as a user's approval or input, so a stop waiting in your store when you upgrade is answered as a user's stop again. A new use of either reason is refused where it is written, naming `user_approval` or `user_input` (FIX-2454).

  Docs: apps/docs/docs/advanced/durable-execution.md (one line beside the reasons: a stored `human_*` stop reads as a user's; a new one throws)

- 97c85bc: `useResource` can keep a whole user or org collection current and says why a read failed (FIX-2775).

  - **react:** `useResource(def, { all: true })` reads every page of a user or org collection through the client's `listAll()`, not its first 200 entries. A change notice that names entries reads just those and merges them in, a new entry in storage-key order and a deleted one dropped, so an append-only log never re-lists for a new entry; the collection is listed again only on a notice that names no entry, a missed-notice resync, or an entry read that failed. `topicPrefix` (with `all`) keeps only the entries whose storage key starts with it, and hears only the change notices that may touch them. Every user or org result now has `refresh()`, to read again now, and `failure` while `stale`: the same `{ message, httpStatus? }` `useView` gives, the server's own words for a refused read, and a `CollectionReadStoppedError`'s message when a read stopped on a repeated cursor or past the page ceiling.
  - **contracts:** `extractBareTopic(pattern, storageKey)` is exported from `@flow-state-dev/contracts/helpers`, beside `getPatternPrefix`, so a browser package can name a collection entry without core's runtime; `@flow-state-dev/core/types` still exports it.

  Docs: packages/react/README.md (`useResource`'s `all`, `topicPrefix`, `failure` and `refresh()`)

### Patch Changes

- 3973e1f: An idle view stops re-reading on changes that can't touch what it shows (FIX-2695).

  - **client:** `client.live` with `topicsFromResult` now applies a result's `hears` (a view's answer, from `client.view`): a notice under the answer's topics that its hearings don't admit reads nothing. `LiveResult` gains an optional `hears`. Before, only `useView` applied it; a screen that passed `client.view`'s answer to `client.live` re-read on every notice under the topics, including each chunk of a reply streaming in the session.
  - **client:** when a live read's answer names new topics, it subscribes them before it lets go of the old ones, so a client whose only subscription is that live read keeps its socket instead of closing it and opening another.
  - **engine:** a view that reads a session's state hears only that session's `state` notices. A reply streaming in the session (`items`, `request`) and a request stamping the session record (`run`) no longer wake it. A view that reads the session itself (its items, metadata, window or journal, or another session through the request host) still hears every kind but `resource` and `board`.
  - **engine:** `publishScopeChange` is exported from `@flow-state-dev/engine/host`, for a host that writes a scope's state outside a run.
  - **fsdev:** `fsdev run --seed-session` on an existing session publishes a `state` notice on that session, so a live view that read its state reads again.

  Docs: none for users beyond the client reference's `client.live` entry (`hears` on a `topicsFromResult` result), if it lists `LiveResult`'s fields.

- 3ef3979: **Breaking:** the client's root carries only what an app reads (FIX-2449). `ExecuteActionRequestBody` and `QueryValue`, which nothing outside the client reads, are no longer exported, and `clientPackageMarker` is removed, with no deprecated aliases. `ChildSessionStatus` and `ChildSessionSummary` are unchanged, now declared once in contracts (`@flow-state-dev/contracts/types/child-session`) and re-exported. `CollectionResourceHandle` stays on the root: React's collection hooks return it.

  Docs: packages/client/README.md (add `CollectionResourceHandle`: the item `useResourceCollectionList` and the collection hooks return, `{ topic, clientData, fetchContent() }`)

## 0.4.0

### Minor Changes

- bc65135: A live view hears other sessions' changes to the user and org state and the resources it reads (FIX-1506).

  - **engine:** a session, user or org state write, and a write to a resource a client can read, publishes a `state` or `resource` notice on its scope's topic once it lands, from any run, with or without a stream, naming the request that made it. The resource routes publish the session's topic too.
  - **react:** `useSession(id, { live: true })` subscribes its session, user and org topics: a state notice reads state again without the item history, a resource notice makes the resource hooks read again, and a notice from the view's own request is skipped. `Roster` and `BoardColumns` take `live` and read their collection again on another session's change to it.
  - **contracts:** `ChangeKind` gains `"state"` and `"resource"`; a `switch` over it that lists every kind needs the two new cases. `getPatternPrefix` is exported from `@flow-state-dev/contracts/helpers` (still re-exported from `@flow-state-dev/core/types`).

- 844a4f9: Screens can read again when something they show changes, without polling on the Node host (FIX-2428).

  - **client:** `fsd.subscribe(topics, { onChange, pollIntervalMs? })` calls `onChange` with the notice that woke it (`{ topic, kind, origin? }`), or `null` for a connect, a reconnect or a timer tick. Build topics with `topic.session(id)`, `topic.user()` and `topic.org()`, now exported from the client too. On a host with push, one WebSocket per client carries the notices, signed in through the client's fetcher; elsewhere `onChange(null)` runs every `pollIntervalMs`. `FlowCapabilities` gains `push`. **Breaking:** `fsd.stream()` is removed. It never worked (the server answered 501); use `fsd.subscribe()`. `UserStreamOptions`, `UserSSECallbacks` and `UserStreamHandle` are removed with it. Migration: replace `fsd.stream({ onResourceChanged, onScopeStateChanged, ... })` with `fsd.subscribe([topic.user(), topic.org()], { onChange: () => reread() })`, and read what you show in `onChange`. A notice carries no rows, so the read is what tells you what changed.
  - **react:** `useSubscription(topics, read, { pollIntervalMs?, enabled? })` runs a screen's read again on a change, one read in flight and one waiting.
  - **node:** `serve()` serves the change-notice WebSocket at `<basePath>/users/:userId/stream`. New options: `push` (default `true`) and `pushSecret` (default `FSD_PUSH_SECRET`, then a random key), which every process behind one address must share.
  - **engine:** `GET /capabilities` answers `{ userStream: false, push }`. `POST /users/:userId/stream` checks each topic with its scope's read check and answers a short ticket for the granted ones; a refused topic is left out, as a missing session is. `GET /users/:userId/stream` answers 426 instead of 501. `enablePushDelivery(router, { secret? })` turns push on for a host that serves the socket.
  - **contracts / core:** the push wire types (`PushCapability`, `PushMintAnswer`, `PushServerFrame`, `PushClientFrame`, `WireNotice`). **Breaking:** the user-stream event types `UserStreamEvent`, `UserEventBase`, `UserResourceChangedEvent`, `ResourceContentUpdatedEvent`, `ResourceContentCreatedEvent`, `ResourceContentDeletedEvent`, `ScopeStateChangedEvent`, `UserDebugEvent` and `UserPingEvent` are removed; `StreamEvent` is `RequestStreamEvent`.

### Patch Changes

- 531bf32: A task board's change reaches every open view of the board, from whichever session or process settles the task (FIX-2429).

  - **orchestration:** every change to a board built by `getOrCreateTaskCollection` also publishes a `board` change notice on the topic of the session that filed the row (`Task.filer`, else the ledger's legacy filer, else the running session), narrowed to the board's `collectionId`. A screen subscribes `topic.session(conversationId, { resource: "tasks" })` and reads again. Nothing to wire: the `task-change` item is unchanged. The board's `listTasks` action (a client's read, not the model's tool) also answers each row's `updatedAt`, so a client holding a row from two sources keeps the newer.
  - **engine:** the block context carries the seam that publishes a board notice on the running request's bus, under its tenant, with the request as `origin`.
  - **react:** **Breaking for a hand-built client slice:** a live `BoardList`'s `client` takes `subscribe` in place of `sessions.stream`. A client from `createClient` works as before. The list now hears a task that settles in another session or process, never wakes on a reply streaming in the session, and reads every 3 s where push can miss a change. `useSubscription` takes `client`, for an app that builds its own client, and hands `read` an `AbortSignal` that aborts when the subscription ends.
  - **core / contracts:** `ChangeKind` gains `"board"`; `publishBoardChange` and `BOARD_NOTICE_SEAM` (framework-facing) in `@flow-state-dev/core/types`.
  - **shift-manager:** the conversation's task panel and task cards read on board notices; they keep their 3 s timer only while a task is open, and only where push can miss a change.

- 5f569fd: A task's session tells what a person said from what the task was handed (FIX-2574, FIX-2575).

  - **core / engine:** an action's `userMessage` can return `{ text, metadata }`. The echo is still the request's `user` line, and it carries `metadata` for a client to read. A plain string works as before.
  - **orchestration:** a steer from a person (sent from a screen, or a coding review's request for changes) now shows in the task's session as a `user` line with their words alone, not as an assistant line reading "Message from the user: …". A filer's or the board's steer reads as before. **Breaking:** `showTakenSteers` is now async; await it.
  - **workforce:** a task request's opening `user` line (the task as filed, or re-queued with its steers) is marked as the task's brief. Read it with `taskBriefOf(item)` from `@flow-state-dev/workforce/browser` to draw it as a brief, not as the person's line.

## 0.3.0

### Minor Changes

- e0daf6e: Stores profiles take a `bus` slot: a change bus that carries notices that something under a session, user or org changed (`ChangeBus`, `ChangeNotice`, `BusTopic`, `createInMemoryBus`). Every request and session write publishes on its session's topic, through `withChangeBus`, which `resolveStores`, `createFlowState`, `runAction`, BullMQ's job processor and `fsdev run` / `chat` apply. The session stream (`GET /sessions/:id/stream`) now reads when a notice wakes it, at most once a second; on a bus that crosses processes it reads nothing while the session is idle. The in-memory bus, the default and the only one that ships today, keeps the once-a-second read as well, so nothing changes for a deployment that sets no `bus`. A `bus` adapter declares `"bus"` in its capabilities and resolves `{ bus }`. `@flow-state-dev/contracts` (re-exported by core) adds `ChangeKind` and the wire topic constructors `topic.session(id)`, `topic.user()` and `topic.org()` (FIX-2426).

### Patch Changes

- 387bee2: A durable sequencer saves its state at a suspension, and restores it before the resumed step runs. A `patchState` a step makes before `ctx.suspend()` or `ctx.suspendForUser()` is now kept across a restart, and the re-run of that step reads it. Sequencer-state writes the step made before the pause (including `incState` and `pushState`) apply once: when the re-run reaches the pause, the sequencer's state is set back to what was saved there, and writes after it apply as usual. A request that was already parked before this change resumes as it did before (FIX-2444).
- 6c4a3b3: A conversation's line about a task now says which task it is, as data, so an app reads it without parsing the words (FIX-2378).

  - `ctx.emit.message(text, { metadata })` attaches `metadata` to the message item. Clients read it; the model never sees it. `EmitMessageOptions` is exported from core.
  - Orchestration adds `noticeMetadata(notice, task)` and `parseNotice(item)` beside `noticeText`. `parseNotice` returns the task, its ending, title and what came back, and still reads lines stored before this from their words.
  - Workforce marks every task line it emits, and a delegate's answer carries the worker and the task it answered. Read it with `delegateAnswerOf(item)`, from the root or `./browser`.

## 0.2.0

### Minor Changes

- 24afa6e: A question is one kind of task hold (FIX-2317, FIX-2131, FIX-2133). The two ways to stop for the user are named for what stops, and a task's open stops live in one list.

  - **`suspendForUser`** (new) suspends the request and resumes it with the answer: `ctx.suspendForUser({ kind, prompt, deadline? })` in `core`, `suspendForUserOn`, `createSuspendForUserTool`, `SuspendForUser`, `SuspendForUserOptions`, `SuspendForUserContext`, `SuspendForUserCancelled`, and `SuspendForUserKind` / `suspendForUserKindOf` (`contracts`, re-exported by `core`). `kind` is `"approval"`, `"review"` or `"input"`.
  - **`holdTaskForUser({ question })`** holds the task until the user answers, built with `createHoldTaskForUser`. The turn ends; the next turn on the same attempt spends no retry.
  - **`Task.holds`** lists what stops the task being claimed until the user answers. There is no `kind` field on a hold: an entry is told apart by `source.kind` (`"row"` or `"suspension"`) and `ask.kind` (`question`, `confirm`, `approval`, `review`, `input`). `getTask`, `listTasks` and Inbox items list `holds`.

  `createTask({ questions })` files a task that stays `pending` until each question is answered: a plain string is a question, `{ kind: "confirm", prompt, onNo? }` asks for a yes or a no. Answer with `updateTask({ id, answers, message })`. The Inbox client's `answerOne` takes `questionId`. A deadline applies only when the host sets `userDeadlineMs`.

  **Breaking, from the last publish.** The `parked` status is gone, with `counts.parked`, `TaskCollectionRef.awaitReview` / `unpark`, `board.unparkAndDrain`, a board's `onReview`, and `@flow-state-dev/react`'s `BOARD_STATUS_COLUMNS` `parked` column. Ask for a review with `ctx.suspendForUser({ kind: "review", prompt })`. The filer's hold is unchanged: status `held`, `hold()`, `release()`. `keptOpenBy: "suspended"` means the task's own request is suspended. Stores are reset: a stored `parked` row is not read. Also removed with `parked`: `TaskTransitionOptions.refuseWhenParked`, `CheckBoardOptions.excuseParked`, the `"parked-for-review"` termination reason, the `"review_requested"` change kind, the `"parked"` write-decline reason, `unparkAndDrainInputSchema` / `UnparkAndDrainInput`, and the task-board exports `TaskBoardOnReview` and `assertParkExitSupported`. React no longer maps a legacy `awaiting_review` card status. `TaskClaimTicket.turn` is required: every claim advances the row's `turn`, and a ticket from an earlier turn of the same attempt is declined `lost-claim`.

  A row stored with `questions` still reads as `holds` (`withRetiredShapes` from `@flow-state-dev/orchestration/tasks`). Shift Manager and the DevTool read them as holds.

- 617aeab: `MANIFEST_DOMAINS` no longer lists `channels` (FIX-1792): discovery's domains are `workers`, `skills` and `resources`. `channels` and `seats` are unknown domains.
- 211679a: New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`, `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one. Model strings resolve through your existing providers and gateways; models that can only generate are refused before any call. `BlockKind` and the trace's `blockKind` gain `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before and refuses evaluator model strings. Evaluation through Vercel's AI Gateway needs `@ai-sdk/gateway` 4.0.85 or later. `@flow-state-dev/testing` adds `mockEvaluationModel`.
- 839e915: A block output or tool result over the new `maxRecordedValueBytes` router option (default 256 KiB) is now recorded as an `omitted` placeholder with its size and a preview while the run keeps the full value, and a resumed request that would need it fails with `RECORDED_VALUE_OMITTED` (FIX-1772).
- d1a4cab: The discovery domain `seats` is `workers`: `discover({ domain: "workers" })` lists what `seats` did, and `seats` is an unknown domain (FIX-1796).
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

- f8df86f: A flow's request and action observers (`request.onStarted`, `request.onFinished`, `onCompleted`, `onErrored`) now run on their own block path, `observer[<owner>.<hook>]`, instead of the action block's `root`. Before, an observer's trace on the root's id read as the action block running twice, and a session read (or a reload) dropped the messages the action block emitted: with `request.onStarted` under lean traces (production's default), and with `request.onFinished` in both trace modes (FIX-2299). `blockPathObserver(hook)` is exported beside the other block path helpers.
- 65ad58a: A resumed request now hands the next step the real result of an earlier `.asTool()` step, because a recorded value that points at a tool result resolves to that result instead of `undefined` (FIX-1847).
- 3b0161c: With a durability provider configured, a request resumed after a stop, or continued through `/continue`, no longer runs its completed steps again when trace observability is off, as it is by default in production. Without a durability provider, `/continue` behaves as it did before: it skips a completed step only from a full trace, so a request recorded with observability off runs again from the top. The lean record is marked `lean: true`. Each completed block now records a lean `block_trace` (its identity and output) whatever the observability setting, and resume replay reads that record to skip the block. Full capture (inputs, generator prompts, resource loads, failed traces) is still gated by `FSDEV_TRACE_OBSERVABILITY`. With observability off, a request's item log now holds one `block_trace` per completed, non-transient block. An output larger than the recorded-value limit is stored as an omitted placeholder, so a resume that reaches that step fails with `RECORDED_VALUE_OMITTED`, naming the block, rather than skipping it or running it again. With a durability provider, crash recovery (`/continue`) is at-least-once for a block whose completion had not been persisted when the process died: that block runs again. A completed `block_trace` now carries `rescued: true` when a `.rescue()` handler produced the block's output, so `ctx.wasRescued()` returns the same answer after a resume (FIX-2137).
- fa7b22e: A tool call that waited on an approval no longer reads as failed. A later turn's history replays it once, with its result; before, it also replayed the wait as a failed call carrying the approval's question, so the model read it as a failure it had retried. `isSuspensionWait(item)` (from `@flow-state-dev/contracts/items`, re-exported by `@flow-state-dev/core/items`) tells such a wait from a real failure, and the registry's tool card draws it as awaiting approval. Shift Manager draws a waiting call as waiting, and a conversation redraws once its ask is answered on the page, again when the run it resumed stops (FIX-1901).
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

- b7c523b: Add the session stream's event types: `SessionItemEvent`, `SessionRunsChangedEvent`, `SessionPingEvent`, their union `SessionStreamEvent`, and `SessionRun` (FIX-1609).

  Add `compareItemOrder`, the one order items are shown in: `ts`, then `itemIndex`, then `requestId`, then `id`. The session snapshot and a client merging streamed items both sort with it.

- a021cd1: `@flow-state-dev/contracts/helpers` (and `@flow-state-dev/core/helpers`) now export the resource-state version rule every `ResourceStateStore` adapter uses: `assertSetExpectedVersion`, `assertDeleteExpectedVersion` and `resourceStateConflict`, with the `ExpectedVersion`, `VersionedRow` and `VersionConflict` types. A custom store adapter can import them instead of copying the rule. `cloneValue` is now also exported from `@flow-state-dev/contracts/helpers`; its `@flow-state-dev/core/helpers` export is unchanged. No store's behaviour changes (FIX-1277).
- e11764a: `ctx.suspend()` takes an optional `title`, a short heading for the ask, carried onto the suspension record and the `suspension` item; `message` is then the body under it. The Error Reporter's preview now sends a short title with its count and questions as a markdown body (FIX-2030).
- 84cc226: New `isWindowsReservedName(name)` helper on `@flow-state-dev/contracts/helpers`, re-exported from `@flow-state-dev/core/helpers`: `true` for the names Windows reserves for devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) in any letter case. The filesystem store and the workforce tree loader now both read this one list; which names they refuse, and the messages they give, are unchanged (FIX-1428).

## 0.1.2

### Patch Changes

- b597600: An agent can now ask what it can work with: `discoveryTools(createManifestRegistry([...]))` returns one `discover` tool that answers from whatever domains a scope registers a source for, and `resourcesManifestSource()` ships the resources domain. Two enumerators that ignored the `llmReadable` gate are closed with it — `resourceTools().listResources` is **removed** (it had no caller), and `globResources` now lists only resources the agent may read (FIX-817).
- e4c443e: A task board now reports when it saves a task's result and then cannot announce
  it, instead of finishing the run as though nothing went wrong. The failure lands
  on a persisted `task-board-recorder-failure` item and fails the run once every
  other task has drained; on a handed-off task it fails that child run. `onError`
  does not suppress it. Where the board cannot tell whether the write landed —
  permanently so on a task store you supplied, and on rows that predate write
  provenance — it says `undetermined` rather than assuming the write was lost, and
  hands the row back rather than leaving it claimed. `createRecordSuccess` and
  `createRecordError` composed outside a board raise the failure where it happens,
  since nothing downstream would read the report (FIX-963).

## 0.1.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

## 0.0.0

- Initial release. Extracts the item taxonomy, the deterministic
  block-instance-id helpers, and the pure leaf types (`ModelIdentity`,
  `SuspensionReason`, `SuspensionStatus`, `RequestStatus`) out of
  `@flow-state-dev/core` into a zero-dependency shared layer. `core`
  re-exports every moved symbol from its original path, so the move is
  non-breaking for existing consumers.
