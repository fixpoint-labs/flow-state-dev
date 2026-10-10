# @flow-state-dev/workforce

## 0.4.0

### Minor Changes

- cfef958: Any worker files tasks for its delegates that take one, not only a coordinator: `delegates:` joins the worker contract (`workerConfigSchema()`), so a worker flow that hand-declares the contract must accept it too, the built-in `agent` flow carries the task tools, the `addTask_tasks`-style actions and the four delegate actions, an app's own worker flow carries them with `defineSessionBoard({ installation, flowKind })`, and a worker none of whose delegates takes a task, a coordinator included, gets no task tools and its actions answer `no_delegation_board` (FIX-1802).
- b9de77e: A `best-fit` coordinator with a `description:` is now one of its own choices, so a post the evaluator picks it for runs the coordinator's own turn; a new `minConfidence:` key (0 to 1, `best-fit` only) sends a delegate pick below it, or one with no reported confidence, to the fallback or the coordinator's turn; the routing record's new `fit` field says why best fit handed a post on; and the coordinator's own turn now reads each delegate's answer under that delegate's name, with each post its routing handed on marked as handled (FIX-1833).
- 80f6e25: `createSeatHireCapability` gives a seat `brokenSeats` and `rehire` tools, and takes `askBefore` to make `hire` or `fire` wait for a person's approval (`rehire` always waits) and `refuseRosterAdmin` to keep those tools off the seats it hires, so a chief of staff can change the roster with a human in the loop (FIX-1719).
- 12bf045: A coordinator conversation keeps its own task board, worked through Orchestration's task tools on the coordinator's turn and as `addTask_tasks`-style actions, for the conversation's delegates that take tasks; each task runs in a new task session of the user's, found with `findWorkerSession({ worker, taskId, filingSessionId })`, and the conversation hears once how it ended (FIX-1794).
- a600325: `fsdev gen` no longer depends on `@flow-state-dev/workforce`. It runs the generator a dependency of the app exports on a `./fsdev-gen` subpath (typed as `FsdevGenerator`), and `@flow-state-dev/workforce` now exports its generator there, so a Workforce app runs `fsdev gen` as before. `GenResult` reports `generator`, `entries`, `paths` and `summary` in place of the Workforce discovery lists, and `--root` defaults to the generator's own folder (FIX-1771).
- 7da156e: Organization ids are now validated as well-formed, non-blank Unicode everywhere (resolver, `runAction`, dispatch, BullMQ jobs, schedules, `fsdev run --org`) and seat addresses escape any such id, while route segments are decoded exactly once on every host (`parseFlowRoute` now takes decoded segments, built from a raw URL by the new `decodePathSegments`), so escaped seat ids resolve on Next and Vercel and stored rows or queued jobs with a lone-surrogate org id are now refused (FIX-1757).
- 98fa8da: `hiredSeatOwnerPin` now refuses a missing or empty organization id with the same error `registerHiredSeat` throws, instead of returning a pin with an empty `orgId` (FIX-1572).
- a3bfbc2: The seat, mailbox and membership inventory collections (`defineSeatInventoryCollection`, `defineMailboxInventoryCollection`, `defineMembershipIndexCollection`) declare a browser read. A session on any flow that installs one can list its rows through the collection-state route, for that session's own organization only, with the row's named fields (`id`, `kind` for a seat; `id`, `kind`, `members`, `openedAt` for a mailbox; `seatId`, `mailboxId` for a membership) and nothing else. Every member of an organization can now list its registered seats, mailboxes and memberships from the browser (FIX-1502).
- d10b1ba: A mailbox `post` now keeps the line as one `mailbox-post` component item on the mailbox's session (`MAILBOX_POST_COMPONENT`), so a page can render the transcript from the session's items. The post resolves only once that item is stored, and fails if the write does. New posts no longer land in `state.transcript`; `read` returns the lines already there first, then the posted ones inside the session's history window (50 requests by default). A mailbox kind of your own keeps and reads its lines the same way with `emitMailboxPostLine` and `readMailboxPostLines`. A message sent to an `agent` seat's `run` is now kept as the caller's turn in that seat's conversation (FIX-1585).
- b808784: Channels are now mailboxes everywhere (`MAILBOX.md` under `teams/<team>/mailboxes/`, the `mailbox` kind, `mailbox-post` items, the `post-to-mailbox` tool, the `mailboxes` discovery domain, and every export, such as `mailboxFlow`), and the old names are not read, so an old file is reported by name and a store written before this release does not open: start from an empty store (FIX-1748).
- 02019e2: Seats declared under `org/workers/<name>/` now load as org seats, with the folder name as their id, and `parseDeclaredSeatId` reads any declared seat's id back into its team (if any) and name (FIX-1719).
- 7d4c413: Resource collections can be declared owner-private with `ownerPrivate: { param }`, and `ownerSegment(userId)` builds the owner key segment. Key segments beginning `~` are reserved for owner-private collections in every app, and flow registration refuses a single resource whose key has one. `defineResourceCollection` and flow registration no longer refuse collection patterns on Workforce's account, and `@flow-state-dev/core` no longer exports `assertRosterCollectionIsNotDeep`. Workforce's private roster collection is now owner-private; its refusal messages name the owner-private collection instead of the roster (FIX-1549).
- 58e92e1: A project can record its git remote (`repository`, set with `createProject` or the new `setRepository`) and keep members-only files in the new `project-files` collection, read with `readProjectFiles` (FIX-1762).
- 0471725: `projectWorkspace({ board })` is a run source for a workspace host: a coding run on a project's mailbox board works in a branch of the project's repository with the project's files beside it, or on the project's files alone when it has no repository. It refuses a run whose owner is not a member, or whose workstream no project holds. The block that asks it holds `projectWorkspaceCapability` (FIX-1762).
- c2cb231: Projects can be private or shared, and each workstream in a project has one owner (FIX-1793).

  - `createProject` takes `visibility`: `"shared"` (the default) keeps the project in the organization, where everyone reads it; `"private"` keeps it in the creator's own user scope, where nobody else lists or reads it and it shows only in the organization it was made in. A private project names no other members (`private-has-members`) and lists no workstreams by mailbox id (`private-has-workstreams`). The answer carries the project's `visibility`.
  - A project's address is its visibility and its id, `{ visibility, id }`. `setRepository` and `readProjectFiles` now take `{ project: { visibility, id } }` in place of `projectId`. The private rows and files are `definePrivateProjectsCollection()` and `definePrivateProjectFilesCollection()`, at `projects/*` and `project-files/**` in user scope.
  - `defineWorkstreamBlocks({ installation, leadFlows })` adds `openWorkstream` and `updateWorkstream`. Opening one writes the caller's own entry at `workstreams/<project>/<~owner>/<workstream>` and starts the lead's workstream session, owned by the caller, on a lead from their roster. On a shared project only its members may open one. Everyone who reads the project reads every entry (title, lead, status, due date, objectives, latest report, `writtenBy`); only the owner can change theirs, whichever flow writes. A status is a short label in the owner's own words (at most `WORKSTREAM_STATUS_MAX_LENGTH` characters, `"on-track"` when opened); one label has a meaning, `"done"` (`DONE_STATUS`): a done workstream stays listed, is never stale and is never the next due date. `updateWorkstream` writes the caller's own entry, or the one its `owner` names, which the store refuses for anyone but that owner. `updateWorkstreamTool` lets a lead update the workstream its session leads.
  - A worker flow lets its workers lead a workstream by declaring `workstreamOpenedEntry()` under `internal.actions[WORKSTREAM_OPENED_ENTRY]`. The built-in `agent` flow declares it.
  - `findWorkerSession` and `ensureWorkerSession` take a `workstreamId` criterion: `{ project: { visibility, id }, id }`. They return the one session the caller's entry for that workstream names, and nothing while it names none; `ensureWorkerSession` never starts a workstream's session, since `openWorkstream` does. A worker session naming a workstream is created only for the caller's own entry, with the lead that entry names.
  - `readProject` returns a project's row, every workstream's entry and its progress, from two reads. `projectProgress(entries, now)` works progress out the same way anywhere: how many workstreams carry each status label present, objectives met of total, the next due date, and entries unchanged for `STALE_AFTER_MS` (seven days).
  - `projectWorkspace()` finds a run's project from the workstream its session leads, at the project's visibility, and refuses a run whose owner isn't the workstream's (`not-the-owner`). Its `board` option is now optional; a mailbox board still finds its project through its claim.
  - `sharedResource(pattern, shape, options)` takes the rest of a collection's declaration, a user scope included, and `withWrittenBy(ctx, data)` stamps `writtenBy` for a writer that needs its own write.

- 16bb676: A worker no longer gets `runBoard` and a private board's task tools from a skill it holds, because skills can no longer declare `agents:`; a worker skill that still does is reported in `skillErrors` when the tree is read (FIX-1814).
- 9427a4d: `createSeatHireBlocks` adds `brokenSeats` and `rehire` to list and repair stored seats whose kind is gone, and `fire` now removes the seat's own inventory row too (FIX-1621).
- d10b1ba: A mailbox whose `MAILBOX.md` declares `routing:` with a `fallback:` member now sends each post from a person to one member, picked by `routeByPurpose(seats, { model })` passed as `defineMailboxFlow({ route })`, and that member's reply is posted into the mailbox as its line, with the mailbox's last 20 lines in view (the `routed` and `recent` fields on the notify input) (FIX-1610).

  A seat of the built-in `agent` kind now needs a `seatId` setting when it is minted, which `hireWorkforce` writes on every seat: one minted straight off the kind without it is refused at the mint, naming the key. On any other kind, the `post-to-mailbox` tool refuses a seat without one before the model is offered the tool (FIX-1610).

- 8ebab39: A worker given a task can split it: its task session files pieces for its own delegates, its task waits on them and completes from their outputs, or fails naming the pieces that failed for good. A chain of split tasks is at most five boards deep, and one top task has at most 100 tasks under it, finished ones included; `hireWorkforce(installation, { taskChainLimit })` sets an app's own limit. A filing past either is answered `total_task_cap_exceeded`. Cancelling a split task cancels its open pieces, down the chain. A worker flow's `work` entry now holds its session's reply line, so a piece's notice waits for the turn that filed it (FIX-1802).
- 6f5a697: A task's session stays open until the task is done and after: a worker parks on a question with `parkOnQuestion`, the conversation answers with `answerTask_tasks`, and a follow-up filed with `followUpOf` runs in the same session (FIX-1817).
- 30aa133: A task can now be handed to the worker its assignee names, including one hired after the host started (FIX-1778).

  - core: a task dispatcher's `flowKind` may be a function of the task (`TaskFlowTarget`), resolved once per hand-over; an empty answer refuses it `flow-not-found`. A task entry may declare `from` to take tasks from more than one ledger; such an entry runs queued unless it sets its own concurrency. A function `flowKind` requires `session: "per-task"`.
  - orchestration: `taskLedgers({ name, resolve })` builds that `from`, resolving each dispatch's ledger by id and refusing an unknown one before any row is read. A board's `defaultWorker` may now be a task dispatcher, handing a task over under its own assignee. Tasks record `createdBy` (the user whose request added them, server-only), which a hand-over passes to a per-task target as `filedBy`.
  - workforce: `createWorkerLookup({ instanceAt, declared })` says which worker a name means for the running caller, from the live registry; its `flowKind` plugs into a board's fallback and `filingCheck` into a mailbox's new `checkAssignee` option, which refuses `fileTask` for a name no worker holds. `mailboxTaskLists(ids)` lets a worker take tasks from mailbox lists, and the `agent` kind's new `taskLists` option gives it a `work` task entry over them.

- ae72c9d: `hireWorkforce` now takes your worker flows as `workerFlows` (renamed from `kinds`), checks each one against the worker contract before any worker runs, can keep a flow for declared workers, and ships `workerFlowProblems`, `sharedResource` and `writeShared` (FIX-1789).
- ecca6d0: A worker on the built-in `agent` kind with no `tools:` line can now call the tools of the capability presets its file picks under `capabilities:`, where before it got only their context. Write `tools: []` to keep the old reach; a worker that writes a `tools:` line is unchanged. For a worker with no line, the hired seat's `config.tools` is now absent rather than `[]`, and the worker is refused at startup if two presets it picks list different tools under one name (FIX-1459).
- b092e17: Every hired seat now carries its own id as the `seatId` setting (for a runtime-hired seat, its roster id, the one a mailbox's `members:` lists), a `WORKER.md` that sets `seatId:` is refused by name, and a worker kind whose settings schema is hand-written rather than built from `workerConfigSchema()` must admit `seatId` or it refuses at boot naming the key (FIX-1589).
- 9d636c0: A coordinator worker hands each post to delegates from its user's own roster: `defineCoordinatorFlow` routes by judgment or best fit, each conversation keeps its own delegates (changed with `addDelegate`, `removeDelegate` and `setFallback`, read with `listDelegates`), and a flow declares `delegatedPostEntry` so its workers can be delegates; the built-in `agent` flow does. A coordinator's judgment is the agent's own turn, built from the `agent` options you give `defineCoordinatorFlow`, so its workers' `model`, `tools` and `skills` read as an `agent` worker's do. `createWorkerInstallation` now refuses a standard worker whose `delegates:` names a worker that isn't standard. An app finds the session a delegate was given for a conversation with `findWorkerSession({ worker, filingSessionId })`, using the `filingSessionId` that `listDelegates` returns; a lookup naming only `{ worker }` never returns one. `COORDINATOR_KIND`, `COORDINATOR_ROUTE` and `COORDINATOR_JUDGMENT` are on the `./browser` entry (FIX-1791).
- e3c1927: A coordinator can route by `round-robin` (the next delegate in list order) and `everyone` (each delegate that can be reached), and `rounds:` from 1 to 3 is now accepted: a delegate's answer goes back out that many times. Under `best-fit` and `round-robin` each answer is routed again as it lands, never to its own author; under `everyone` each delegate gets the other delegates' answers when the round closes; under `judgment` the coordinator's turn runs once per closed round, and its hand-offs go out in the next round. A round closes when each delegate in it has answered or failed, or at its deadline, which `defineCoordinatorFlow({ roundDeadlineMs })` sets (five minutes by default). The routing record's `by` adds `round-robin` and `everyone`. `delegatedPostEntry` now tells the coordinator when it has no answer for a post whose answer can go back out, and `delegatedPostSchema` carries that post's optional `deadlineAt`. A delegate flow that sets the new `delegatedPostOnFinished` as its request `onFinished` also reports a cancelled run; the built-in `agent` flow does. A round whose delegate says nothing closes on the conversation's next wake after its deadline. A conversation keeps at most 50 rounds open; a post that would open one more is delivered without a round, and its routing record's new optional `note` says why. `roundDeadlineMs` must be a positive whole number of milliseconds (FIX-1791).
- b255c6b: Every worker runs on one shared copy of the flow it names. `hireWorkforce(installation)` returns one copy of each worker flow and the roster flow (`workforce-roster`, with `hire`, `fork`, `edit` and `fire`), and mints nothing per worker and pins nothing. A worker flow declares `session: installation.session()` and loads its worker each turn; `workerFlow(...)` builds a flow in its own file on its installation, and `installation.resourceVisibility` narrows each turn's model to its worker's document grants. The built-in `agent` on an installation keeps each worker's skills apart, refuses a turn whose input names a worker, and signs its mailbox posts as the turn's worker. The mailbox wake and the task lookup open each session naming its worker, for standard workers only. Removed: `createSeatHireCapability`, `createSeatHireBlocks`, `registerHiredSeat`, `reloadHiredSeats`, the hired-roster collections and keys, `seatAddress`/`splitSeatAddress`, and `listedSeatRows` (FIX-1788).
- e9f9316: A worker can now hold packages, folders of a `PACKAGE.md` and a `blocks/` folder found in its own `packages/` folder or taken by name from its team's or the org's through `packages:`: the built-in `agent` kind adds their instructions to its prompt and, when the worker writes no `tools:` line, their blocks to its tools, with `readWorkforce` returning them on each record, `hireWorkforce` taking the generated `packageBlocks`, and a custom kind receiving them under `seatPackages` (FIX-1459).
- 00a9347: Projects get talk templates: declare a room's seats and charter once, with `defineProjectsCollection({ talk })` or a `MAILBOX.md` marked `mintFor: projects`, and every project's room wakes those seats on each post and keeps their answers (FIX-1718).
- 1bde68a: Projects: an organization's `projects` collection (`defineProjectsCollection`), and `defineProjectBlocks` for writing rows. `createProject` creates a row owned by the calling session's owner, with its members and the workstreams (declared mailboxes, from any team) it groups; a workstream belongs to at most one project, claimed with `create` before the row is written. `setWorkstreams` replaces the list, members only. Each project has one room, stored as `room-lines` rows, that its members reach through their own talk session on the mailbox kind: the mailbox kind gains `join` (and an internal `bind`), and `post`, `read { after }` and `answer` on a session bound to a project read and write the room, members only (`not-a-member` otherwise). On every other session they behave as before. Refusals are `ProjectRefusedError` (FIX-1718).
- a1b122e: A mailbox can no longer declare a board named `lock`, in any case. It would mint an id ending in `.lock`, which no git branch can carry, so a coding run could never work that board. A tree that declares one now fails to load with the board-name rule's wording (FIX-1667).
- c364ebb: Each seat's inventory row now names its **door** (FIX-1690), the action that takes a person's message: the one public action its kind declares with `userMessage` and a `{ message }` input. A kind with none publishes `door: null`. A kind with two also publishes `null`, and the hire warns, naming both. `openInventory` reads the door from the seats you pass it, and `InventorySeat` now requires `actions`: pass `hireWorkforce`'s seats as they are, or `actions: {}` for a seat you build by hand that takes no message. Also exports `seatDoorOf(seat)`.

  Rows written before this read `door: null` until the next boot rewrites them.

- 98b90a6: Workers can be data: `createWorkerInstallation` gives a worker flow a create check that names the session's worker once, `resolveWorker` loads it each turn, `createWorkerHireBlocks` writes the user's roster, and `createWorkforceClient` finds or starts a session with a worker. `writeShared` now names the worker the turn loaded, not a `seatId` setting. `createSkillsLibrary` takes `partitionBy` to keep one catalog per party on one flow copy (FIX-1788).

### Patch Changes

- d10b1ba: The built-in `agent` kind now declares an internal `onMailboxPost` entry, so a mailbox's notify block can dispatch a post to an agent seat and have it answer with the post as its turn (FIX-1590).
- 5ab09d4: A seat on the built-in `agent` kind now hands its model the earlier turns of its own conversation, up to the session's history window (the last 50 turns by default) and never another conversation's, so a follow-up keeps its subject (FIX-1612).
- be1bddf: A worker can ask a colleague and carry on the same turn with the answer (FIX-1816). `addTask` takes `waitForResponse` and `timeoutMs` (five minutes by default, 30 seconds to an hour, refused outside that as `wait_timeout_out_of_range` and never clamped) on a turn whose host can hold an ask: durable execution and a running durability sweeper, which the request host now reports as `RequestHost.hasAskSweeper` (a router answers for its own sweeper, which `DurabilitySweeper.timesOutAsks()` reports). Anywhere else `addTask` is unchanged and adds no tool. An asked task's ending resumes the turn that waits on it, through the same notice every ending sends, and wakes no new turn. The task notice module (`recordEnding`, `owedNotices`, `decideNotice` and the rest) moved from Workforce into `@flow-state-dev/orchestration/tasks`. `isTaskTurn(ctx)` is true on a turn that is itself working a task, and an ask there is refused as `wait_unavailable`. Orchestration's root exports `isTaskTurn`, `TASK_SESSION_TASK_KEY`, `resumeOwedAsks` and `taskToolsForTurn`; the rest of the ask mechanism (`addTaskAndWait`, which refuses a host that can't bound the ask, `canHoldAsk`, `askGateId` and the timeout bounds) is on `@flow-state-dev/orchestration/task-board`.
- 8485a48: A coordinator that routes by best fit now hears a task it filed end in its own turn, as one that routes by judgment does, so it can file a failed task again and tell the person. Round robin and everyone still show the ending as a line only (FIX-1863).
- 397cfa7: Boot warnings and the active-profile line now print once per server process, not on every dev hot reload (FIX-1632).
- 4a367f6: A boot now publishes the inventory row of the hire the roster holds over a row left by an interrupted fire, so a replacement hire that stopped before publishing is listed again after the next restart (FIX-1621).
- 4fae894: A coordinator conversation retries its state writes more times before giving up, so when many delegates answer at once a closed round's answers still go back out instead of being lost (FIX-1840).
- 334c1e3: A best-fit coordinator reads each post with its conversation's recent lines, so a follow-up goes to the delegate whose answer it follows, and the delegate that takes a post is shown those lines for that turn; a delegate flow of your own shows them by setting its generator's `history` to `delegatedPostHistory` (FIX-1828).
- effa822: A coordinator's `handOff` tool now tells the model that a new message is a new post, even when it repeats an earlier ask, so a coordinator no longer declines to hand a repeated ask to the delegate that took it before (FIX-1826).
- 9b4e7b1: `defineCoordinatorFlow` now honours `agent.isolateUserState`: the coordinator flow keys its user-scoped storage by its copy when the judgment turn asks, as the `agent` flow does. Before, the option was accepted and ignored (FIX-1776).

  Shift Manager's DevTeam chief of staff carries the standard memory set (working memory, the rolling digest, `memory/recall`), read-side only unless `DEVTEAM_MEMORY_CAPTURE=1`. It says when it has no memory of something rather than inventing one.

- ef185db: A task notice that reaches a coordinator conversation mid-reply now waits for the replies running when it arrives and any that start within 30 seconds of it, instead of running beside them, while a person's next message still starts at once (FIX-1834).
- 50b5273: The workforce discovery door now leaves out a stored roster row it cannot address, such as one an app's own hire action wrote under the development organization or one whose seat id starts with `~`, instead of dropping the organization's whole seat listing, and `reloadHiredSeats` now files a row stamped for another organization under the organization it was read from in `byOrg` as well as in the flat `problems` (FIX-1541).
- 01b29f0: A hired seat stays with the organization and user that hired it, so another organization or roster peer cannot list, open, or run that seat (FIX-1529).
- 85696dd: The `hire` tool's description and `settings` field now tell a model that a kind may require settings, and a hire the kind's settings schema refuses now says nothing was written and to call `hire` again with the setting (FIX-1758).
- d10b1ba: A mailbox `post` that claims an `author`, including one another flow dispatches, still wakes hearing members. Only a seat's own post, through the `seatPost` action, withholds those wakes (FIX-1715).
- 718e84c: Adds `mergeSeatFlows(flows, seats)`, which refuses a hired seat whose id is already a flow's instead of replacing that flow, and exports `newIncarnation()` and `tagIncarnation()` so a host that writes roster rows itself can stamp its hires (FIX-1719).
- d10b1ba: FIX-1594: `mailboxPostCapability` adds a `post-to-mailbox` tool a seat names in `tools:` to post into a mailbox it belongs to, under its own `seatId`.
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- 536b1f0: `reloadHiredSeats` no longer rejects when a stored roster row cannot be addressed, such as a runtime hire made under the development organization or a seat id starting with `~`. That row is skipped and named in `problems`, and every other organization's seats still reload (FIX-1536).
- 3311cc2: `HIRED_ROSTER_BROWSER_PATTERN` and `HIRED_ROSTER_PRIVATE_PATTERN` are now exported from `@flow-state-dev/workforce` instead of `@flow-state-dev/core/types`, and `@flow-state-dev/core` no longer exports `HIRED_ROSTER_PRIVATE_BRAND`, `markHiredRosterPrivateCollection` or `isHiredRosterPrivateCollection` (FIX-1549).
- 24a0829: `reloadHiredSeats` also returns `byOrg`, one `{ orgId, seats, problems }` per organization passed in, so each organization's skipped seats can be reported to that organization alone (FIX-1477).
- 02120a2: Added `createSeatHireBlocks(options)`, returning the seat-hire sequence's `hire` and `fire` handlers with no model in front of them — the same two handlers `createSeatHireCapability` mounts as catalog tools, for a caller that wants to dispatch `hire` (or `fire`) directly from an action (FIX-1500).
- b823e03: `createSeatHireCapability` adds catalog `hire` and `fire` on the existing mint, and `createWorkforceCapability({ hiredRoster })` lets Discover list those runtime hires (FIX-1525, FIX-1526). Hire refuses to register a seat without an owner pin `{ orgId, userId? }` from the hire row's roster owner (FIX-1529 / F2-PLAN).
- 4f03fae: A seat hired through `createSeatHireCapability` now records the organization that hired it, so a copy of its roster row read under another organization is refused on reload instead of becoming that organization's seat. Rows written before this change still reload in the organization they are stored under (FIX-1542).
- 92a8b49: The session routes now send a session as a client may see it (FIX-1588). `GET /sessions/:id`, the session listing, and the create and metadata-edit responses carry only the `state` fields the flow names in `session.client.expose` or declares readonly (empty when there are none), and no longer include the record's `journal` or stored `resources`. Server-side code that needs the whole record reads the session store. `openMailboxes` callers: pass a `getSession` that reads the session store, since through the session API an open mailbox now reads as empty.
- 2e8f640: A handed-off task now names the run working it: its row carries `run: { sessionId, requestId, attempt }`, written by the run before its worker starts and published as a `run_linked` task change, and a mailbox board's `readBoard` and browser read both return it. `TaskCollectionRef` gains a required `linkRun` verb, so a hand-written collection must implement it (FIX-1668).
- 912ae98: A durable task board's task tools can now run as flow actions (`taskToolActions(board)`, or `boardActions: true` in a `MAILBOX.md`), and the DevTool's Tasks tab opens a task's full record and runs those actions from the row, showing a refusal as a refusal (FIX-1629).
- b36a8a5: A hand-built worker manifest with `tools: undefined` is now treated as having no `tools:` line everywhere (FIX-1459). Before, every turn already granted it its picked presets' tools, but the startup check read it as a written line and skipped the clash refusal, so a preset tool-name clash surfaced mid-turn instead of at hire.
- 78178a9: The mailbox wake and the project workspace now read the bare user id, not the user record's storage key, so a person reaches their own seat and is recognized as a project member (FIX-1790).
- ea0d0bf: Add `wakeMemberSeats(seats, { fallback? })`, a mailbox notify block that wakes each member whose hired seat declares `onMailboxPost`, once per post (FIX-1602).
- 1f2650b: Add a `@flow-state-dev/workforce/browser` subpath that exports the roster keys, `splitSeatAddress` and the mailbox post names without reaching any Node built-in, so client components can import them where the server-only package root would fail to compile (FIX-1605).
- d67de66: A coordinator's `listDelegates` (the action and its turn's tool) now gives each delegate `description`, its worker's own description, and `takes`: `posts`, `tasks`, `both`, or `nothing` when it has been fired or its flow takes neither, read from the flow it runs on. A delegate that takes nothing, or a worker with no description, has a `description` of `null`. The type of `takes` is exported as `DelegateTakes`. A `handOff` refused for a delegate that can't take the post now ends by naming the delegates in the conversation that can, as in `Delegates here that take posts: eng.em.`, or `No delegate here takes posts.` A `hire`, `edit` or turn refused for a skill the installation doesn't register now names the skills it does, as in `Skills it registers: "cite", "summarize".`, or says `It registers no skills.` (FIX-1826).
- Updated dependencies [cd6f7fb]
- Updated dependencies [0b57bc9]
- Updated dependencies [e457697]
- Updated dependencies [be1bddf]
- Updated dependencies [e00a3b0]
- Updated dependencies [58ffc93]
- Updated dependencies [397cfa7]
- Updated dependencies [70cfac9]
- Updated dependencies [53b50f0]
- Updated dependencies [585b75b]
- Updated dependencies [49852d9]
- Updated dependencies [698e06b]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [8dc242e]
- Updated dependencies [7d4158f]
- Updated dependencies [211679a]
- Updated dependencies [5181ddb]
- Updated dependencies [8628a54]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [17444fe]
- Updated dependencies [423a405]
- Updated dependencies [0b37a7f]
- Updated dependencies [ba74f01]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [a7f1c41]
- Updated dependencies [80f6e25]
- Updated dependencies [b808784]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [69a9e29]
- Updated dependencies [12bf045]
- Updated dependencies [db7df1c]
- Updated dependencies [6a3ecf5]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [16bb676]
- Updated dependencies [65ddb90]
- Updated dependencies [9510a03]
- Updated dependencies [385d01e]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [b7c523b]
- Updated dependencies [9ed6b29]
- Updated dependencies [a021cd1]
- Updated dependencies [d994f51]
- Updated dependencies [afb512f]
- Updated dependencies [09e3705]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [edb3d46]
- Updated dependencies [9cd314d]
- Updated dependencies [6f5a697]
- Updated dependencies [2e8f640]
- Updated dependencies [30aa133]
- Updated dependencies [912ae98]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [78178a9]
- Updated dependencies [84cc226]
- Updated dependencies [98b90a6]
- Updated dependencies [57a859d]
- Updated dependencies [707b340]
  - @flow-state-dev/core@0.3.0
  - @flow-state-dev/orchestration@0.4.0
  - @flow-state-dev/client@0.3.0
  - @flow-state-dev/workspace@0.2.0

## 0.3.0

### Minor Changes

- 0f812c9: Skills, seats and channels now answer the agent discovery door and a seat narrows what it sees with its worker file's `discover:` key (FIX-817) — **breaking:** `createWorkforceCapability` no longer accepts `agents` (pass `roster` and `inventory`) or `catalog` (pass it to `defineAgentWorkerFlow({ catalog })` instead), each now a type error naming its replacement.
- 8faf08e: A `CHANNEL.md` can declare `boards:`, durable task ledgers the channel holds, with `fileTask` and `readBoard` actions on the channel and a `channelBoard()` helper for the worker that drains them (FIX-1385).
- 17e9748: Workers can call custom tools written as files. A `blocks/` folder registers a block name for the workers that can see it — the app's own folder for everyone, a team's for that team, a worker's own for that one seat — and a worker's `tools:` resolves a name nearest first. Registering does not grant use: the worker still names the block. `fsdev gen` exports the per-seat map as `seatBlocks`, which `hireWorkforce` now takes.

  Migration: a worker kind that hand-declares the admission contract instead of composing `workerConfigSchema()` must add the new `seatTools` key, or it refuses its roster at startup naming that key (FIX-1416).

- 3e43c96: A flow can now be registered and unregistered after the runtime is built — `FlowState.register(flow)` admits one instance and `FlowState.unregister(id)` releases one address, both running exactly the checks construction runs, and a flow registered this way is served from the next request onward without cancelling one already running (FIX-1475).

  A workforce hired at runtime now survives a restart: `defineHiredRosterCollection()` declares the org-scoped roster at `workforce/roster/*`, `reloadHiredSeats({ stores, orgIds, kinds })` reads a whole one back at boot as `{ seats, problems }` for the caller to register a seat at a time, and `seatAddress(orgId, seatId)` is the address a hired seat answers on (FIX-1475).

  Migration: `meta.flowKeys` now reads the registry rather than the construction options, so it lists the instance ids actually being served. An app whose `flows` record keys differ from its instance ids will read different values there than before.

- 1a3a009: A workforce root spelled with a `..` that steps back through an earlier segment — `/srv/app/current/../workforce`, where `current` is a release symlink — is now refused wherever a reader opens a root; pass the path it resolves to instead (FIX-1375).
- 8291951: `splitResourceModules` turns the generated `resourceModules` map into the two things a flow already takes (FIX-1388).

  ```ts
  const { capabilities, resources } = splitResourceModules(resourceModules);

  const agent = defineAgentWorkerFlow({ uses: capabilities /* ... */ });
  const flowResources = { ...resourcesFromDocs(documents), ...resources };
  ```

  A capability goes to the worker kind's `uses`, where the resources it declares for itself reach the flow; a plain resource or collection merges into the one resource map, under its own ref. Nothing is installed for you — spread both at your own call site. An entry that can be neither is refused, naming its ref.

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

- f7e98d9: A worker file can now name which of its kind's capabilities that seat wants, and which of their presets (FIX-1388).

  ```md
  ---
  description: Fields questions about how the desk is running this week.
  capabilities:
    research: [briefing]
  ---
  ```

  Read by the built-in `agent` kind. Selecting **adds** to what the kind installed; a seat that names nothing carries every installed capability's own defaults, exactly as before. The whole selection is validated when the roster is hired, so a typo is a refusal at boot rather than a failed turn — including a capability the kind does not carry, a preset the capability does not declare, a preset the app turned off at install, a preset on a capability with open config, and a preset whose surface has to exist before a request runs.

  `SeatCapabilitySelection` is exported as the parsed shape of that key.

- 8bfb08c: `fsdev gen` now finds the TypeScript in a workforce tree's `resources/` folders and exports it as a fourth map, `resourceModules` (FIX-1388).

  **Your committed `workforce.gen.ts` goes stale on upgrade**, whether or not your tree has any `resources/` modules: the file gains the fourth map and a line of its header. `fsdev gen --check` stays red until you run `fsdev gen` and commit the result.

  `renderWorkforceCode` takes the discovered modules as a second argument.

- c315362: A workforce tree can declare read-only documents in `references/` beside the writable ones in `resources/`. A reference's body is served from its file on every execution context rather than from a stored row, so editing the file is the edit; `writable`, `llmWritable`, `render` and `flowIsolation` are derived by the folder and refused in frontmatter. A seat reaches the references at or above its place in the tree — the org's, its own team's and its own folder's — with no install-side filter, narrowed further by a `references:` list in its `WORKER.md`. Installing references on a kind without also passing them to `hireWorkforce` as `references` is refused at hire, naming the option: the wall is derived against that catalog, so omitting it would leave every seat reaching every team's references with nothing to say so. `resources/` behaviour is unchanged. `clearShadowedReferences({ references, orgId, content, installedOn })` migrates a tree where a document was written before it moved — `installedOn` names the flow so the stored content is addressed where it actually lives rather than guessed at (FIX-1467).
- 68d836a: A `WORKER.md` can declare `resources:`, the documents that seat may touch — naming one grants read, `rw` grants write — and the app supplies its documents through a new `documents` option on `hireWorkforce` (FIX-1381).

  Migration: `resources` is now read by the hire step rather than passed on as a setting, so a worker kind that declared a `resources` setting of its own must rename that setting before upgrading — it no longer receives an authored value. A seat that declares no `resources:` key keeps the reach it has today.

- caffe1c: A team can say once what all its seats are told: an optional `TEAM.md` at `teams/<teamId>/` carries the team's `description` and, in its body, the instructions every seat on that team is given (FIX-1377).

  Two things a consumer can trip over:

  - **`readWorkforce`'s result grows two fields**, `teams` and `teamErrors`. Treat a non-empty `teamErrors` as fatal alongside `errors` and `skillErrors` — a team file that failed is a whole team's seats running without instructions someone wrote for them.
  - **A hired seat's settings bag can now carry `teamInstructions`.** Every kind that composes `workerConfigSchema()` already declared the key, so nothing new refuses; but a kind that reads its config exhaustively will see a key it did not see before, for seats whose team wrote a `TEAM.md`. It is absent — never empty — for every other seat, so a tree with no `TEAM.md` anywhere behaves exactly as it did.

  A seat's own instructions and its team's stay two separate settings and are never merged. On the built-in `agent` kind both go into the prompt, the team's first and the seat's own last. That order is fixed, and it is a position rather than a ranking: nothing in the prompt path resolves a contradiction between the two.

### Patch Changes

- 68fb69c: `openChannels` accepts an `orgId`, so a channel's session is opened under the org its documents are scoped to (FIX-1412).
- 0508765: `readDeclaredRoster(root)` on `@flow-state-dev/workforce/loader` reads a whole workforce tree in one call — workers, teams, documents and channels — and returns one flattened `problems` list, each entry tagged with the layer that reported it. Problems are collected rather than thrown, so the caller decides what is fatal. It throws on the `root` and nothing else: a path that cannot be read, a path that is a symlink, or one spelled with an interior `..` that steps back through an earlier segment (FIX-1405).
- 4cd4f13: `openInventory` fills the live workforce inventory at boot: one row per hired seat, and one per open channel written by that channel itself from its own session state. `channelInstances({ inventory: true })` builds the built-in channel kind carrying the writer, and `inventoryWriterActions(kind)` puts the same two actions on a hand-rolled channel kind (FIX-1405).
- d49f255: `defineSeatInventoryCollection()`, `defineChannelInventoryCollection()` and `defineMembershipIndexCollection()` declare the org-scoped resource collections for the live workforce inventory, addressed with `membershipKey` and `membershipPrefix` (FIX-1405).
- 0056b97: The hired roster and a channel board's ledger can now be read by a browser, so a UI can draw them without an action in between. Both are organization-scoped, so a read returns only the reading session's own organization's rows. Each publishes an explicit allowlist rather than the stored row: a roster row crosses as its seat id, flow kind and instructions, withholding the settings bag, and a board row crosses as `CHANNEL_BOARD_CLIENT_FIELDS`, withholding the claim, lease, retry ledger, write log and the task's own payloads (FIX-1477).
- Updated dependencies [0f812c9]
- Updated dependencies [b597600]
- Updated dependencies [8faf08e]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [218de72]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/orchestration@0.3.0
  - @flow-state-dev/core@0.2.0

## 0.2.1

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2
  - @flow-state-dev/orchestration@0.2.1

## 0.2.0

### Minor Changes

- 3c15e14: Rename the channel kind factory from `createChannelFlow` to `defineChannelFlow` (FIX-1386).
- 33c8d10: New `hireWorkforce`: turn worker records into one configured flow copy each, with a worker's instructions handed to its flow as an `instructions` setting (FIX-1325).
- 23bc757: Each worker on a roster now holds its own skills, seeded from its own org, team and worker folders instead of one shared bucket — a catalog already seeded under the shared key is re-seeded under the worker's own and its old rows are left behind (FIX-1362).
- 2f74e07: Removed the Agent factory — `defineAgent`, `createAgentRegistry`, `materializeAgent`, `agentBlock`, `AgentCapabilityError` and `AGENT_CAPABILITY_UNRESOLVED` are no longer exported, so declare a worker as a `WORKER.md` record and hire it with `hireWorkforce`, and supply your own `agentRegistry`/`materializeAgent` to `createSkillsLibrary` for any skill that staffs a seat with `agent-ref` (FIX-1344).
- 70f787e: Hiring now hands every worker seat the same settings — its instructions and the skills its folders declared, plus a reserved `teamInstructions` key nothing populates yet — so a custom worker kind must accept them by composing the new `workerConfigSchema()` into its `configSchema`, or it refuses the whole roster at startup (FIX-1367).
- f9a3626: Ship a built-in worker kind, so a worker file that names no `flow:` hires instead of being refused (FIX-1363).

  `defineAgentWorkerFlow()` called with no arguments is that built-in; the same call with a tool catalog, skills or a default model builds the flow you register under `agent` to replace it for every seat. Its settings are `instructions`, `model`, `tools` and a switch for up-front skill matching (off by default). Tool names are resolved against the catalog your app supplies and refused at the hire, by name, when it carries no such key.

  Two behaviour changes on `hireWorkforce`: `kinds` is now optional, and a record with no `flow:` resolves to the built-in rather than refusing. A `flow:` that is present but empty or whitespace-only still refuses — only an absent key means the default — and every other refusal stands unchanged, with the unknown-kind message now listing `agent` among the kinds available.

- af6d6b9: A name anywhere in a workforce tree — team, worker, channel, document, kind or block — may no longer be one Windows reserves for a device (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`), since a tree holding one cannot be checked out on Windows whatever the extension (FIX-1357).
- d46fb72: The `./loader` subpath publishes the walk every workforce-tree reader shares — `openRoot`, `walkTeams`, `classify`, `openStructuralDirectory`, `refusedSymlink`, `unreadable` and `IGNORED_ENTRIES` — so a new convention calls the walk instead of copying it (FIX-1389).

  Two changes existing code can trip over:

  - **A symlinked workforce root is now refused by every reader.** `readWorkforceDirectory` and `readSeatSkills` followed the link and loaded the tree behind it; they now throw `Symlinked workforce directory "<root>" — refused for safety`, which `readChannelsDirectory` and `readResourcesDirectory` already did and all four readers' docs already promised. The refusal holds with a trailing separator or without, and in the published `classify` and `openStructuralDirectory` primitives as much as in the four readers. It does not reach a root named through a `.` segment, and nothing above the root is checked, so a path that passes through a symlink on its way in still reads. If you point a root at a symlink deliberately, pass the path it resolves to instead.
  - **Every `readWorkforceDirectory` failure now carries a `kind`.** `ReadWorkforceDirectoryResult["errors"]` entries gain a required tag — `unreadable-slot`, `worker-load-failed` or `refused-declaration` — matching the other three readers, so a caller can tell the conditions apart without matching on `error.message`. Reading `errors` is unaffected; constructing the type (a mock, a fixture) now needs the tag.

### Patch Changes

- cee0c62: `defineAgentWorkerFlow` accepts three new optional options — `uses` for capabilities every worker carries, `afterAnswer` for a block that runs after the answer, and `isolateUserState` to give each worker its own storage — so an app can compose memory or any other capability into the built-in worker kind (FIX-1364).
- 8270f00: Add channels: a built-in `channel` flow kind, plus `channelInstances` and `openChannels` to register it and open one named session per channel record (FIX-1311).
- efd4981: Channels can be declared in files: `readChannelsDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads each `teams/<id>/channels/<name>/CHANNEL.md` into a `ChannelManifest` that `channelInstances` and `openChannels` already take, collecting per-path failures instead of throwing (FIX-1352).
- d195a90: When `readWorkforceDirectory` reports a worker folder that holds no `WORKER.md`, the error names the route for a worker whose behavior differs: define the flow in your app, pass it to `hireWorkforce` in `kinds`, and name it in that worker's `flow:` (FIX-1342).
- 2b728c2: Custom flow kinds and blocks now register from the file tree: `fsdev gen` walks `workforce/flows/workers/`, `workforce/flows/channels/` and `workforce/blocks/` and writes a committed module exporting the `kinds`, `channelKinds` and `blocks` maps that `hireWorkforce`, `channelInstances` and a task board already take, so adding one no longer needs a startup line (FIX-1357).
- bbecd2d: Read a worker's own `resources/` folder as a third document root (FIX-1368).

  `readResourcesDirectory` now walks `workers/<name>/resources/` under both `org/` and every team,
  alongside the org and team roots it already read. A document there is addressed by the folders above
  it — `teams/<teamId>/workers/<worker>/<name>`, or `workers/<worker>/<name>` for an organization-level
  worker — so two seats can each have a `runbook` without their authors agreeing on a name.

  The org and team roots are unchanged: same documents, same order, same errors. A worker folder's
  documents load whether or not the folder holds a `WORKER.md`, and a `workers/` level or worker folder
  that is symlinked or unreadable is reported under its own path with the existing `unreadable-slot`
  kind. No new error kind.

  A worker's folder is a namespace, not a visibility boundary. To give one seat a document of its own,
  put `flowIsolation: true` in that document's frontmatter: each seat then gets its own rows, and a
  sibling seat asking for the same document reads its own empty copy.

- 119936d: New `@flow-state-dev/workforce/loader` subpath: `readWorkforceDirectory(root)` scans `teams/<id>/workers/<name>/` and returns one neutral manifest per worker, so a workforce can be declared in files instead of wired by hand (FIX-1335). `orchestration` gains `splitFrontmatter` and `parseFrontmatterYaml`, the frontmatter dialect `SKILL.md` and `WORKER.md` share; parsed frontmatter records now have no prototype, so a `__proto__:` key in a hand-written file is carried as an ordinary key instead of silently replacing the record's prototype.
- 7986a48: Documents can be declared in files: `readResourcesDirectory(root)` on the `@flow-state-dev/workforce/loader` subpath reads `org/resources/<name>.md` and `teams/<id>/resources/<name>.md` into one record each, and `resourcesFromDocs(documents)` turns those records into the resource map you spread into `defineFlow({ resources })` (FIX-1354). A resource is a file rather than a folder, and where the file sits decides the document's scope and ref — so `scope`, `ref`, `stateSchema`, `default`, the content sources and a lazy `prefetchMode` are refused by name in frontmatter rather than quietly ignored.
- 8a1173a: New `readSeatSkills(root, { team, worker })` on `@flow-state-dev/workforce/loader`: reads the skills one seat can see — the org's, its own team's, and any sitting beside the worker, which are included without being listed — and returns the same `InitialSkill[]` `initialSkills` takes. A name reaching one seat from more than one of those levels is refused, and its error entry carries every colliding path in `paths`; two teams may each carry the same name. Anything that should have reached the seat and did not lands in `errors`, each entry tagged with a `kind` naming which condition it is, so a caller can tolerate one class and refuse another without reading the message text (FIX-1356).
- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
- Updated dependencies [23bc757]
- Updated dependencies [64b323e]
- Updated dependencies [119936d]
- Updated dependencies [c25ad3e]
- Updated dependencies [8a1173a]
- Updated dependencies [23ac6de]
  - @flow-state-dev/core@0.1.1
  - @flow-state-dev/orchestration@0.2.0

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [bea3a24]
- Updated dependencies [b484d86]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [0443742]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [229da65]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0
  - @flow-state-dev/orchestration@0.1.0
