# @flow-state-dev/scheduled

## 0.4.1

### Patch Changes

- Updated dependencies [3a21218]
- Updated dependencies [019b156]
- Updated dependencies [81387f7]
- Updated dependencies [fad96df]
- Updated dependencies [9b18dd4]
- Updated dependencies [7ac7f90]
- Updated dependencies [136e348]
- Updated dependencies [16e6852]
- Updated dependencies [6968618]
- Updated dependencies [aec3d83]
- Updated dependencies [c51d3e6]
  - @flow-state-dev/core@0.7.0

## 0.4.0

### Minor Changes

- 61efa05: The app fires its own schedules (FIX-2752). One tick in the engine fires every schedule of every flow, static and dynamic, once per scheduled time. A long-lived server or `fsdev dev` needs no outside cron, several servers on one store tick from one process, and a serverless host adds one route. The five old ways to fire a schedule are removed, with no aliases.

  - **engine:** `createFlowState` takes `scheduler`. Omitted, a built-in local cron ticks each minute in a process that serves the app (`ready()`, `getRouter()`, `serve()`, `fsdev dev`) or works a job queue, never in `fsdev run`, `fsdev chat` or `fsdev block`, and only when a flow declares a static schedule or a schedule index. It ticks only while it holds a lease in `stores.leases`, so one process ticks across servers that share a SQLite or Postgres store; if that process dies, another takes over within three minutes. In production on in-memory or filesystem stores it warns at start: run one server, or use SQLite or Postgres. `scheduler: false` fires nothing; a `SchedulerAdapter` (from `@flow-state-dev/engine/host`, with `ScheduleTicker` and `ScheduleTickReport`) decides when the tick runs. After downtime each schedule fires once, late, for the latest time it missed; earlier missed times are dropped. On Vercel with the local default, startup warns to pass `vercelScheduler()`.
  - **vercel:** `vercelScheduler({ secret? })` is the scheduler for Vercel: pass it as `scheduler` and export its `route` as the `GET` of one route that one Vercel Cron entry calls (`CRON_SECRET` by default; an empty secret refuses every call). Each call fires every due schedule of every flow, each as its own request to the deployment the call reached, and answers 500 when a schedule index fails so the next beat retries. `createGetToPostCronShim` and `createScheduleTickHandler` are removed, with the `@flow-state-dev/vercel/schedules` entry: replace each per-schedule cron entry and route, and each per-flow tick route, with the one route. A once-a-minute beat needs Vercel Pro; a daily beat (Hobby) fires each schedule once a day, late.
  - **bullmq:** `registerStaticSchedules`, `createScheduleDispatchProcessor` and `createBullmqScheduleIndex` are removed, with the `@flow-state-dev/bullmq/schedules` entry. A BullMQ deployment wires nothing for schedules: the local cron runs in its job-queue processes too, elected by the shared store's lease. A static schedule's fire is enqueued like any action, with the queue's retries; a dynamic schedule's fire runs in the process that ticked, since its block can't ride a job, so it has no queue retries and a crash mid-run loses it. Dynamic schedules use the SQLite or Postgres schedule index. The pending rename of `createScheduleDispatchWorker` to `createScheduleDispatchProcessor` in this release ends in this removal.
  - **node:** `serveScheduleTicks` is removed. `serve()` no longer ticks schedule indexes itself; the app's local cron fires static and dynamic schedules alike.
  - **scheduled:** `runScheduleTick`, `startScheduleTick` and `scheduleDispatchRequest` are removed from `@flow-state-dev/scheduled/collection` (the tick is the engine's), and `formatScheduleId` from the package root (it is core's). The pending note that added the first three in this release is superseded by this removal.
  - **core:** `formatScheduleId(orgId, userId, key)` is exported from `@flow-state-dev/core`. `ScheduleDueEntry` names `cron` and `timezone`, so a custom schedule index returns the cron and zone each row already carries.

  Docs: apps/docs/docs/server/scheduled.md (rewritten: the app fires its own schedules; the local cron, the lease, and what one server on in-memory or filesystem stores means; after downtime, once late for the latest missed time; the Vercel route; `scheduler: false`), apps/docs/docs/server/schedule-index.md (drop the "bring a cron" section; the tick claims the index), apps/docs/guides/scheduled-vercel-cron.md (the one-route walkthrough with `vercelScheduler()`, one cron entry, the Pro and Hobby beats), apps/docs/guides/scheduled-dynamic.md (no tick handler; the app's tick claims the index), apps/docs/guides/background-jobs-bullmq.md (drop the schedule wiring), apps/docs/guides/keeping-a-flow-running.md (drop the outside-cron mention), packages/vercel/README.md (`vercelScheduler` replaces the `./schedules` helpers), packages/bullmq/README.md (drop the `./schedules` section and `createBullmqScheduleIndex`), packages/scheduled/README.md (the tick is the engine's; no `runScheduleTick` or `startScheduleTick`), packages/node/README.md (`serve()` no longer ticks indexes itself), packages/engine/README.md (the `scheduler` option, `SchedulerAdapter`, `ScheduleTicker`), packages/core/README.md (`formatScheduleId`; `ScheduleDueEntry`'s `cron` and `timezone`).

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

- 8ccec52: Routines are read as a view, with no session, and paused or deleted through the roster flow; an app's declared routines are seeded on a user's first request to any worker (FIX-2624).

  - The roster flow serves a `routines` view: the user's routines, answered as `{ routines }` in `listRoutines`'s shape, at user scope with no session. It also lists the app's declared routines (`routines.declared`) that aren't stored for the user yet, so they show before they are seeded. `routinesView` from `@flow-state-dev/workforce/browser` is its handle. `listRoutines` stays as an action and as a worker's tool.
  - The schedules (`workforce/schedules/*`) and subscriptions (`workforce/subscriptions/*`) collections now take `runBy: { flow: "workforce-roster" }` and a client read of the user's own entries. A client pauses or deletes a routine by sending `pauseRoutine` or `deleteRoutine` to the collection (`client.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send(...)`), which runs in the user's own write session.
  - An app's declared routines are seeded on the user's first request to any flow of the installation: a worker's turn, as well as a roster request. Each is written once per user; a later request writes nothing. Every worker flow now declares the routine collections through `installation.resources`, which carries them beside the worker collections.
  - `defineScheduleCollection` takes `client` and `runBy`, passed to the collection as `defineResourceCollection` takes them.
  - Shift Manager's Routines reads the view and sends its changes, with no roster session.

  Docs: the Workforce docs have no routines page yet; the release adds one under apps/docs/docs/workforce/ (the `routines` view and its handle, pause and delete as a send to the collection, and the declared routines seeded on a user's first request to any worker), apps/docs/docs/shift-manager/overview.md (Routines needs no roster session), packages/workforce/README.md (`routinesView` in the browser API list), packages/scheduled/README.md (`defineScheduleCollection`'s `client` and `runBy`).

- 546603f: A flow with `schedules` fires them and answers on its dispatch endpoint with nothing in the app beyond `schedules` on the flow (FIX-2753).

  - **engine:** the router mounts the scheduled endpoint itself, on every app, beside the HTTP routes: `POST /api/flows/:flowKind/schedules/*scheduleId/dispatch` and `GET /api/flows/:flowKind/schedules`. A flow registered after the router is built is routed too. A registered flow with no `schedules` answers both routes `404 { "error": "flow_not_found" }`, the same as an unknown flow, before any principal resolver runs; before, the listing route ran the resolver and answered an empty list. `createFlowState` no longer refuses to start a flow with schedules and no adapter. An app adapter that registers one of the two paths is refused at startup by the router's route-collision check. `SCHEDULED_TRANSPORT_SOURCE` is exported from `@flow-state-dev/engine`.
  - **scheduled (breaking):** `createScheduledTransportAdapter`, its `basePath` option, `CreateScheduledTransportAdapterOptions`, `SCHEDULED_TRANSPORT_SOURCE` and `findScheduledRequest` are removed. Delete the `adapters: [createScheduledTransportAdapter()]` line and its import; import `SCHEDULED_TRANSPORT_SOURCE` from `@flow-state-dev/engine`. The schedule routes live under `/api/flows` only: an app that serves the flow API under another prefix (`serve({ basePath })`, a Next.js route elsewhere) still fires its schedules from the local cron, but an outside cron or `vercelScheduler()` sending to that prefix gets a 404, as webhooks do. `FIRED_RECORDS_PATTERN` and `firedRecordCollectionKey` move from `@flow-state-dev/scheduled/collection` to `@flow-state-dev/core/types`. The package keeps schedule collections, the resolver, the `ScheduleIndex` contract, `createBadCronWarner`, `parseNextFireAt` and `./testing`, and no longer depends on the engine.
  - **core:** `FIRED_RECORDS_PATTERN` and `firedRecordCollectionKey` are exported from `@flow-state-dev/core/types`.
  - **workforce:** reads the fired-record helpers from core; no behaviour change.

  The pending note that said `createScheduledTransportAdapter` stops refusing `idempotencyWindowMs` and `idempotencyOptions` is superseded: the factory is gone.

  Docs: apps/docs/docs/server/scheduled.md (drop the mount step; the endpoint is always there, under `/api/flows`; a flow with no schedules answers 404; drop the lines that say the adapter throws on `idempotencyWindowMs` or `idempotencyOptions`), apps/docs/guides/keeping-a-flow-running.md, apps/docs/guides/scheduled-dynamic.md, apps/docs/guides/scheduled-vercel-cron.md and apps/docs/docs/workforce/delegating-work.md (drop the adapter line), apps/docs/docs/advanced/inbound-transports.md (the scheduled endpoint is built in), packages/scheduled/README.md (the collections-and-index package; no endpoint, no `basePath`), packages/engine/README.md (drop the commented adapter line; `SCHEDULED_TRANSPORT_SOURCE`).

- 1e58902: A session subscribed to a GitHub pull request or repository hears it with no webhook: the app polls, once per user and pull request (or repository), at most every five minutes, through the same screens and delivery as push (FIX-2536).

  - **workforce:** polling is configured once, on the installation: `hireWorkforce(installation, { routines: { poll: { index, everyMinutes? } } })`, with a schedule index of its own (not `routines.index`, which is refused: one index ticks one flow), and `poll: true` on `defineSubscriptionServiceFlow` or `githubServiceFlow`. Every event routine write (the routine verbs, the roster's routine actions, the declared routines' seed, and `followPullRequest({ providers, installation })`) then schedules the user's poll. An event routine takes `everyMinutes` (5, 10, 15, 20, 30 or 60; anything else is refused), the seed included. `SubscriptionProvider` gains an optional `poll`; `githubSubscriptionProvider` implements it on the user's own token, with conditional requests, reading a long list back from its last page to the mark; a poll that couldn't read everything says so in each session. A delivery the host lost lands on a later poll, once; one that can't land is given up after three polls. A declared event routine whose entry left `routines.declared` ends at its next poll. A poll forwards what no ordinary subscription of that user heard to that user's coordinator that follows the same pull request or repository `unmatched`. A declared event routine whose `unmatched` setting changed is rewritten at the next seed.
  - **scheduled:** `runScheduleTick` and `startScheduleTick` (from `/collection`) claim a schedule index's due entries and dispatch each; `scheduleDispatchRequest` builds the dispatch call.
  - **core:** `SchedulesConfig` takes `index`, the schedule index a host ticks for the flow.
  - **node:** `serve()` ticks each minute for every flow whose `schedules.index` is set, dispatching through its own app (`CRON_SECRET` is sent as the bearer when set).
  - **vercel:** `createScheduleTickHandler` runs the shared tick; its behaviour is unchanged.

  Docs: packages/workforce/README.md (polling: `routines.poll`, the service flow's `poll`, `everyMinutes`, the provider's `poll`), packages/scheduled/README.md (`runScheduleTick`, `startScheduleTick`), packages/node/README.md (`serve()` ticks schedule indexes), apps/docs/docs/server/scheduled.md (the tick a long-lived host runs), apps/docs/guides/webhooks-github.md (polling when the app has no public URL)

### Patch Changes

- 091a1dd: A schedule can run every fire in one session: `session: "per-schedule"` on a schedule, or on `createResourceCollectionScheduleResolver` for every row it resolves, and the flow's `session.retention` caps that session's history; leaving it out (`"per-fire"`) keeps one one-off run per fire (FIX-2886). The session's id is derived by the framework under the reserved `fsd-schedule.` prefix: only the scheduled dispatch creates it or runs in it, its owner can list and read it, and retry, continue and resume refuse a request in it. A fire in it can't stop for a user or wait: the stop fails the fire and a wait answers `wait_unavailable`, so a schedule whose fires stop or wait keeps `"per-fire"`. Workforce's subscription poll now keeps one session per poll, with a day of history.

  Docs: apps/docs/docs/server/scheduled.md (new section "Where a fire runs", after "Overlap policy"), apps/docs/docs/server/schedule-index.md (the resolver's `session` option), packages/scheduled/README.md (the option in the resolver's table)

- 21d31bc: Routines: one name, list and tool set for everything that fires on its own as a user (FIX-2614). A routine has one trigger: a clock (a schedule that files a task) or an event (a subscription to one thread). Stored schedules and subscriptions don't change.

  - **workforce:** four verbs over both triggers, as roster-flow actions for the user and as a worker's tools through the routines capability: `listRoutines`, `saveRoutine({ name?, trigger: { clock } | { event }, task?, worker?, description? })`, `pauseRoutine({ id, paused })` and `deleteRoutine({ id })`, named by `ROUTINE_VERBS` and `LIST_ROUTINES_ACTION`. A routine's id is `clock:<key>` or `event:<subscription id>`. Each listed routine (`listedRoutineSchema`, `ListedRoutine`, also from `./browser`) says who made it (`madeBy`, `routineMakerSchema` / `RoutineMaker`: the user, a worker, or the app). A paused event routine leaves the thread index; a resume turns it back on from its saved subscription, checking read access, and keeps its task and tenant. The user reaches all their routines; a worker reaches only the ones that act through it (`not_yours`).
  - **workforce:** `createRoutinesCapability(installation)` replaces the factory that returned the subscribe and unsubscribe tools: a worker flow adds routine management with `uses: [routines]`, opt-in (`hireWorkforce` adds it to no worker). Its tools are the four verbs; its providers and schedule index are the ones `hireWorkforce` was given, so they're set once. There is no tools-map form: `routineTools`, from this change's drafts, is not shipped. `hireWorkforce`'s `routines: { index?, providers?, declared? }` (`RoutinesOptions`) replaces the option that took a schedule index. `listedRoutineSchema` and `LIST_ROUTINES_ACTION` replace the schema and the action constant that listed clock routines. The roster actions that saved, listed and deleted a clock routine are gone, with no aliases.
  - **workforce:** `routines.declared` (`DeclaredRoutine[]`): the app's own routines, seeded into each user's collections when their roster flow runs a request (or only an entry's `owner`'s), under `declaredRoutineKey(entryId)` and written only when missing or changed. The user may pause one; save and delete refuse with `declared`. A config change keeps the pause. `hireWorkforce` throws on an entry that would never fire. `everyMinutes` must be one of `ROUTINE_CADENCES` (5, 10, 15, 20, 30, 60); a pushed provider ignores it.
  - **workforce:** `subscribe(ctx, providers, input, target?, write?)` takes an optional server-side `SubscribeTarget` `{ sessionId, flow, worker, taskId?, tenantId? }` and `SubscribeWrite` `{ id?, madeBy? }`. Every subscription write and end (`subscribe`, `unsubscribe`, a task's ending) is now decided on the saved subscription: an end other than a pause is final until a fresh `subscribe`, and the thread index holds a subscription only while it is on, under a slot that names its owner. A task's failure or cancel also ends its paused subscriptions. Delivery re-runs the screens on the saved subscription and takes out an index entry it no longer backs. A delivery to a user's not-yet-open conversation with a worker opens it.
  - **scheduled:** a schedule takes an optional `metadata` record, kept and never read by the resolver, the index or dispatch.
  - **shift-manager:** _Scheduled work_ is now **Routines** (`/routines`; `/schedules` still opens it): clock and event routines in one list, each with its maker, paused, resumed or deleted from its line. An app's routine can only be paused.

  Docs: packages/workforce/README.md (a Routines section before Subscriptions: the four verbs and their inputs and answers, who reaches what, `createRoutinesCapability` and `uses: [routines]`, `routines.declared`; the roster paragraph's schedule actions become the routine verbs and `routines: { index }`; Subscriptions' tools become the routines capability and its "ends" list names `deleteRoutine` and pause; the API table rows for `createRoutinesCapability`, `subscribe(…, target?, write?)` with `SubscribeTarget` / `SubscribeWrite`, and `hireWorkforce`'s `routines`), apps/docs/docs/workforce/delegating-work.md ("Recurring work" becomes "Tasks on a clock" on `saveRoutine` / `listRoutines` / `deleteRoutine` / `pauseRoutine` and `routines: { index }`), apps/docs/docs/shift-manager/overview.md (the _Scheduled work_ row becomes _Routines_, with its new link anchor), packages/shift-manager/README.md (the sidebar list names Routines), a new `workforce/routines.md` page after `messaging-workers` with the subscribe section shrunk to a link, and the published glossary's _Routine_ row. The same PR deletes the FIX-2614 published-pages exemption in docs/contributing/glossary.mjs.

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
- Updated dependencies [41dcd7e]
- Updated dependencies [e238e18]
- Updated dependencies [e9722ee]
- Updated dependencies [c049036]
- Updated dependencies [b43424c]
- Updated dependencies [182fb96]
- Updated dependencies [3ef3979]
- Updated dependencies [030eb14]
- Updated dependencies [f9daf5a]
- Updated dependencies [de09b77]
- Updated dependencies [c82adfa]
- Updated dependencies [aa45e92]
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
- Updated dependencies [1970b12]
- Updated dependencies [c36ffa0]
- Updated dependencies [23bac7e]
- Updated dependencies [1f46aaf]
- Updated dependencies [b5b52b9]
  - @flow-state-dev/core@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [4d3f49e]
- Updated dependencies [a1386ea]
- Updated dependencies [46e4297]
- Updated dependencies [d3eaa00]
- Updated dependencies [f1e6315]
- Updated dependencies [45c158b]
- Updated dependencies [bc65135]
- Updated dependencies [65ee4c5]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/engine@0.5.0
  - @flow-state-dev/core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [e0daf6e]
- Updated dependencies [b9e6dd0]
- Updated dependencies [151309c]
- Updated dependencies [9a355b2]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/engine@0.4.0
  - @flow-state-dev/core@0.4.0

## 0.3.0

### Minor Changes

- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- eb831f8: The scheduled-dispatch endpoint fires each scheduled time at most once across retries, restarts and hosts sharing a SQLite or Postgres store, refuses crons that aren't five fields and unknown time zones, and removes `idempotencyKey`, `idempotencyWindowMs` and `idempotencyOptions`; teams outside the repo rewrite at upgrade, see the migration notes (FIX-2085).
- 02ee032: Remove backward-compatibility paths (FIX-1804, FIX-850): stores read only the current on-disk and table layouts with no migration of older data, `@flow-state-dev/claude-code` drops its package-root entry and deprecated handle aliases, `@flow-state-dev/patterns` drops `legacyWorkerAdapter` and `executableTaskSchema`, and removed options such as `clientData`, `requireOrg`, `presets`, `preset/*` model strings, `prefer` and `fileFilter`/`syncMode` are no longer refused by name.
- 8195995: Schedule index rows are now identified by the storage cell the schedule lives in plus its key, so a person's same-named schedules in two hired seats (or a seat and their app-wide flow) are two rows and turning one off no longer stops the other (FIX-1546). `ScheduleIndexRow` gains a required `cell`, `ScheduleIndex.remove` takes `{ cell, key }` instead of `(userId, key)`, and `CollectionHookContext` gains `cell`, the storage key the instance is persisted under. A custom `ScheduleIndex` must key its storage on `(cell, key)` and store `cell`; the conformance suite covers it. The SQLite and Postgres `schedule_index` tables are re-keyed on `(cell, key)` automatically at schema init, adopting every existing row as its person's own cell; with `skipSchemaInit: true`, apply the upgrade SQL in the schedule index reference. BullMQ scheduler ids are built from the cell and key; an app-wide schedule for an ordinary user id keeps its existing scheduler id.
- 69ba29c: Every flow now keeps a user's data per organization, so `resolveUserStorageKey(userId, orgId, flow)` takes the organization and throws without one, a dynamic schedule's dispatch id is `<orgId>/<userId>/<key>` (built by the new `formatScheduleId`), and the test harness seeds user data in the run's organization (FIX-1790).

### Patch Changes

- f282bcb: A queue adapter can supply a shared lease backend (`WorkerAdapter.leaseBackend`) so a session's `queue` / `reject` concurrency policy holds across every process of a deployment, and every transport answers a refusal that arrives after dispatch the same way it answers one thrown from it (FIX-1634).
- 712dc22: A hired seat now keeps what it saves for a person (shared user-scoped resources and user state) under one user-scope key per organization and person, `<userId>:~org:<orgId>`, so the same person's seat in another organization starts empty and no seat reads the person's app-wide data; data seats saved before upgrading is not read for them until you run the optional offline copy in the persistence docs under "Upgrading: moving hired seats' stored data" (FIX-1538).
- 0503c38: A schedule created with `schedules.create(key, { cron, kind, enabled })` on a `defineScheduleCollection` collection now fires and keeps firing after a reschedule: the resolver reads the row from resource state (`ScheduleResolutionStores` now requires `resourceState`), and a new `stampOrgId` collection option records the creating run's organization on the row, keeps it across updates, and refuses any write that names another organization (FIX-1545).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [15f7c6b]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [920adc3]
- Updated dependencies [283fb2a]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [9f06d39]
- Updated dependencies [452b702]
- Updated dependencies [53b50f0]
- Updated dependencies [e4fb1f1]
- Updated dependencies [538cd1a]
- Updated dependencies [585b75b]
- Updated dependencies [3b5266a]
- Updated dependencies [2ffc03c]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [b75c1ed]
- Updated dependencies [25ac53a]
- Updated dependencies [456fe85]
- Updated dependencies [6453d2c]
- Updated dependencies [62133c4]
- Updated dependencies [f282bcb]
- Updated dependencies [651c87e]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [55c62a6]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [85b2965]
- Updated dependencies [1355483]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [099906a]
- Updated dependencies [ad5df6f]
- Updated dependencies [5902deb]
- Updated dependencies [2ce15c7]
- Updated dependencies [4f2e13e]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [60d1bf4]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [42bfbe6]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [57323b9]
- Updated dependencies [7da156e]
- Updated dependencies [8a55e23]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [430db1b]
- Updated dependencies [21ffcbb]
- Updated dependencies [f9995b1]
- Updated dependencies [5a55080]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [2d2518b]
- Updated dependencies [c57890d]
- Updated dependencies [3cbab3a]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [a64132b]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [0abbcd9]
- Updated dependencies [d9d00a4]
- Updated dependencies [c6b2db9]
- Updated dependencies [839e915]
- Updated dependencies [711ed0e]
- Updated dependencies [72c5b17]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
- Updated dependencies [47a02d0]
- Updated dependencies [e0f10e2]
- Updated dependencies [9083569]
- Updated dependencies [9510a03]
- Updated dependencies [0935a47]
- Updated dependencies [d2f77fc]
- Updated dependencies [0995afe]
- Updated dependencies [adbcf0b]
- Updated dependencies [d9d00a4]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [229de7a]
- Updated dependencies [4ca0e99]
- Updated dependencies [3b0161c]
- Updated dependencies [d86c7db]
- Updated dependencies [385d01e]
- Updated dependencies [fa7b22e]
- Updated dependencies [a4e626b]
- Updated dependencies [d1a4cab]
- Updated dependencies [83cd9c2]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [637b6d5]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [71b0174]
- Updated dependencies [295e96a]
- Updated dependencies [8b8ba8d]
- Updated dependencies [97894aa]
- Updated dependencies [3c2ab06]
- Updated dependencies [334c1e3]
- Updated dependencies [64b3ed7]
- Updated dependencies [92a8b49]
- Updated dependencies [9ed6b29]
- Updated dependencies [9f32967]
- Updated dependencies [b7c523b]
- Updated dependencies [6bf61dc]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [c8c8b38]
- Updated dependencies [1f2dadd]
- Updated dependencies [cd180d7]
- Updated dependencies [6306a75]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [2c43888]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [6e1a819]
- Updated dependencies [0d6278e]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [a26e426]
- Updated dependencies [69ba29c]
- Updated dependencies [d97031f]
- Updated dependencies [f741004]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [ce8f765]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/engine@0.3.0

## 0.2.0

### Minor Changes

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

- Updated dependencies [b597600]
- Updated dependencies [795b550]
- Updated dependencies [6b8bfe4]
- Updated dependencies [3e43c96]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
- Updated dependencies [e4b6576]
  - @flow-state-dev/core@0.2.0
  - @flow-state-dev/engine@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/engine@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/engine@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- afcac3d: A flow declares its `cardinality` — `"singleton"` (the default: `myFlow()` is the one instance, addressed by its kind, and `myFlow({ id: "default" })` now throws) or `"collection"` (several configured copies, each registered under its own required `id`) — every address (the action, stream, resume, retry and continue routes, `fsdev run`, dispatchers, BullMQ jobs, MCP, webhook and schedule dispatch) is the exact instance id with no first-registered fallback, every session and request records its owning `flowId` and is refused when reached through another instance (`FlowInstanceBindingMismatchError`; `409 wrong-instance-session` / `wrong-instance-request` / `migration-required` on the routes), and SQLite and Postgres add a nullable indexed `flow_id` column with no backfill (FIX-1321, FIX-1322).
- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [e2fda9d]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [af40427]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/engine@0.1.0

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-11 — Scheduled actions: schedule index, auto-mirroring (FIX-581)

New `ScheduleIndex` interface for store-backed schedule fan-out. Implementations track `(userId, key, cron, timezone, nextFireAt)` rows and expose `upsert`, `remove`, and atomic `claimDue`. New `defineScheduleCollection` wraps `defineResourceCollection` with the standard schedule state schema and mirrors every create / update / delete into an attached index automatically. Rows with `enabled: false` are removed from the index, so disabling a schedule stops it firing without deleting the record.

### 2026-05-10 — Scheduled actions: declarative cron + dispatch endpoint (FIX-440)

New `@flow-state-dev/scheduled` package shipping `createScheduledTransportAdapter`, `findScheduledRequest`, and `createResourceCollectionScheduleResolver`. Mounts `POST /api/flows/:kind/schedules/:scheduleId/dispatch` and a sibling `GET .../schedules` listing endpoint. Two-phase auth: `host.resolvePrincipal` establishes the gateway principal and each schedule carries an optional `principal` that wins for the action's effective user. Idempotency (per-process LRU keyed on `(scheduleId, nominalFireTime)`, default 60s window). `onOverlap: "skip" | "allow"` (skip is default).
