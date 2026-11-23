# Facts for Workforce (R-25, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and code read to confirm what a call returns. No spec, issue, changeset, `docs/internal`, `CLAUDE.md`, PR or commit text was read. Every surface named here is built, so no fact is a spec's name marked for reconciling.

Tags. **[code]** read from the exported surface or its doc comment, no test pins it. **[test]** a test pins it. **[doc]** the existing user docs state it and the code agrees. **[derived]** worked out from two cited limits, not stated anywhere. **[absence]** true because the code has no such thing; say it only as "does not". Where an existing doc and the code disagree, the code wins and the fact is in "Contradictions found" at the end.

Paths are from the repo root. Abbreviations:

- `wf` = `packages/workforce/src`, `wt` = `packages/workforce/test`
- `kit` = `wf/kit/workforce-kit.ts`, `reg` = `wf/workers/register.ts`, `hb` = `wf/workers/hire-blocks.ts`, `inst` = `wf/workers/installation.ts`, `rv` = `wf/workers/roster-view.ts`, `rf` = `wf/workers/roster-flow.ts`, `wr` = `wf/workers/worker-row.ts`, `keys` = `wf/workers/keys.ts`, `cl` = `wf/workers/client.ts`, `wu` = `wf/workers/worker-usage.ts`
- `cc` = `wf/coordinator/coordinator-config.ts`, `ck` = `wf/coordinator/coordinator-keys.ts`, `cf` = `wf/coordinator/coordinator-flow.ts`, `cr` = `wf/coordinator/coordinator-route.ts`, `crd` = `wf/coordinator/coordinator-rounds.ts`, `bf` = `wf/best-fit.ts`
- `dk` = `wf/delegates/delegate-keys.ts`, `dc` = `wf/delegates/delegate-check.ts`, `dl` = `wf/delegates/delegate-list.ts`, `wd` = `wf/delegates/worker-delegates.ts`
- `wroles` = `wf/worker-roles.ts`, `wconf` = `wf/worker-config.ts`, `hire` = `wf/hire.ts`
- Projects: `pc` = `wf/projects/collections.ts`, `pw` = `wf/projects/project-writes.ts`, `pref` = `wf/projects/project-refusal.ts`, `pr` = `wf/projects/project-read.ts`, `pco` = `wf/projects/project-coordinator.ts`, `ww` = `wf/projects/workstream-writes.ts`, `wcol` = `wf/projects/workstream-collections.ts`, `went` = `wf/projects/workstream-entry.ts`
- Standing rules: `sr/*` = `wf/standing-rules/*`
- Error reporter: `er/*` = `wf/error-reporter/*`
- Docs: `wod` = `apps/docs/docs/workforce/workers-on-disk.md`, `dh` = `.../durable-hire.md`, `co` = `.../coordinators.md`, `pj` = `.../projects.md`, `inv` = `.../inventory.md`, `wud` = `.../worker-usage.md`, `erd` = `.../error-reporter.md`, `srd` = `.../standing-rules.md`, `uid` = `.../ui.md`
- Shift Manager: `sm` = `packages/shift-manager/src`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan asks for these tables: kit and hire options; the roster (standard, edited, forked, hired); refusals and what each names; coordinator routing modes; discovery output; projects and workstreams; inventory; usage. Two lookups: "What happens when a user edits a standard worker?" and "Which worker may hand work to which?".

Rows other pages' depth passes moved here (standing rules, the error reporter, panels, the conversation board, messaging limits, Shift Manager reads) are carried in sections 10 to 14. A page that cannot hold them all splits them off; the sheet does not decide that. The "No table has more than six rows" line in `docs/contributing/user-docs.md` is for narrative pages; a reference table that lists every option cannot meet it.

Do not state: any `FIX-` or `BR-` number in a code comment; the stale comment in `wf/manifest-sources.ts:48-50` that says a hired worker is visible to discovery (see Contradictions).

## Stored parts: the four questions

Answers for every stored part the page names. "Browser" = readable from a session's client.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| A user's own worker (hired, forked, or the copy made by editing a standard worker) | The user who made it, in one organization | Only that user. A browser reads `flow`, `name`, `description`, `forkedFrom` and the settings its flow shows; instructions and the other settings stay on the server | One row at `workforce/workers/<id>`, user scope, per organization, shared across flows (`wf/workers/keys.ts:15`, `wr:12-15`, `wr:66-102`) **[code]** | One per worker id per user per organization. A user in two organizations has a separate roster in each (`wr:12-14`, `dh` "Who can reach a worker") |
| A standard worker | The app's files (`WORKER.md`) | Every user of every organization in the installation. A browser reads `flow`, `description`, `name`, `teamName` and shown settings | Not stored per user: read from the files each time, and projected as `workforce/standard-workers/*` (`keys:25`, `wf/workers/standard-workers.ts:77-100`) **[code]** | One per `WORKER.md` |
| A conversation's delegate list and fallback | The conversation (a session) | The session's user | Server-written session state `delegates` and `fallback`, `null` until first read or changed (`dk:30-33`, `dl:36-41`) **[code]** | One list per conversation, at most 25 records (`dk:28`) |
| Standing rules | The user, for one worker | The user; a browser may read the state and never write it | `standing-rules/<worker>` resource, user scope, one bucket per worker flow copy (`flowIsolation: true`), key is the encoded worker id (`sr/rules-record.ts:45-62`, `:72-75`) **[code]** | One record per worker per user, at most 20 rules in it (`sr/rules-list.ts:20-23`) |
| Worker usage | The user who made the requests | Only that user; the view takes no user argument | `worker-usage/<YYYY-MM-DD>/<worker>`, user scope, not browser-readable (`wu:96-115`, `wu:122-127`) **[code]** | One record per worker per UTC day, one entry per source inside it |
| Inventory | The organization | Every user in the organization; a browser reads it through a session of any flow that declares it | `inventory/workers/<id>`, org scope, shared across flows (`wf/inventory/collections.ts:175-189`) **[code]** | One row per standard worker; rows are never deleted for going missing (`wf/inventory/collections.ts:12-14`) |
| A project | Its creator | Shared: everyone in the organization reads the row; `members` decide who opens workstreams. Private: its owner only | `projects/<id>`: org scope (shared) or the owner's user scope (private), same row shape (`pc:12-24`, `pc:188-219`) **[code]** | One per id per visibility; a private `apollo` and a shared `apollo` are two projects (`pc:19-24`) |
| A project's files | The project | The project's members, read through `readProjectFiles`; no browser read | `project-files/<projectId>/<path>`, org or user scope by visibility (`pc:247-275`) **[code]** | One row per file |
| A workstream entry | The user who opened it | Shared project: everyone in the organization reads it. Private: its owner. Only the owner writes | `workstreams/<projectId>/<~owner>/<workstreamId>`, org or user scope by visibility (`wcol:5-8`, `wcol:36-40`) **[code]** | One per owner per workstream id; two users' `checkout` are two entries |
| A user's key for a project's MCP server | The user | The server only; never the model or a browser | `mcp-credentials/<server>`, user scope (`wf/projects/mcp-credentials.ts:3-9`, `:62-70`) **[code]** | One per server per user |
| Error reports | The organization (one Lab) | The operator; a user sees only their own failures, through the error history | `error-reports/*`, org scope, no browser read (`er/reports.ts:196-201`) **[code]**, `wt/error-reporter.test.ts:717` **[test]** | One per fingerprint (plus held requests and storm reports) |

The worker flow copies hold no per-worker data of their own: one registered copy of a flow serves every worker that names it (`reg:3-9`, `reg:97-103`) **[code]**, `wod` "Hiring the roster" **[doc]**.

## 1. Kit options and hire options

The kit is `workforce` from `@flow-state-dev/workforce/kit`, built with `defineKit` (`kit:177-187`; `wf/../package.json` exports `./kit`). Its folder defaults to `workforce/` beside the app.

### 1.1 `workforce({ ... })` config

Every key is optional and the schema is strict: an unknown key is refused (`kit:136-150`) **[code]**.

| Key | Type | What it does | Cite |
| --- | --- | --- | --- |
| `directory` | string, a path read against the working directory | Where the kit's folder is, instead of `workforce/`. Every kit that owns a folder takes it; a kit that owns none refuses it, and so does a non-string | `wf/../core/src/kit/define-kit.ts:91,140-144,241-246` (`packages/core/src/kit/define-kit.ts`) **[code]** |
| `agent` | the built-in `agent` flow's options, plus `showSettings` | Options for `defineAgentWorkerFlow` (model, tools catalog, `uses`, `afterAnswer`, `beforeAnswer`, `maxSteps`, `isolateUserState`, `skills`, `settings`, ...). Omitted: the defaults, unless `workerFlows` holds an `agent` | `kit:51-55`, `kit:80-81` **[code]** |
| `coordinator` | the coordinator flow's options | `routeModel` (required, see 5.1), `agent`, `roundDeadlineMs`, `routines`. Omitted: no coordinator flow, unless `workerFlows` holds one | `kit:57-58`, `kit:82-83`, `cf:205-241` **[code]** |
| `consult` | `ConsultSessionsOptions` | The model and budget for consulting another of the user's conversations | `kit:84-85` **[code]** |
| `routines` | `RoutinesOptions` | The schedule index, event providers, polling and the app's declared routines | `kit:86-87`, `reg:53-63` **[code]** |
| `github` | GitHub service flow options | Serves GitHub's service flow. Omitted: none | `kit:88-89` **[code]** |
| `internalEvents` | internal service flow options | The topics a session may publish and a routine may follow. Omitted: none | `kit:90-96`, `kit:294-298` **[code]** |
| `generated` | `GeneratedWorkforce` | The module `fsdev gen` renders into `workforce/workforce.gen.ts`, handed over whole. Its keys are `workerFlows`, `blocks`, `resourceModules`, `workerBlocks`, `packageBlocks`; any other key is refused | `kit:60-76`, `kit:123-134` **[code]** |
| `taskChainLimit` | positive integer | The most tasks one top task may have under it, finished ones included. Default 100. A filing past it is refused `total_task_cap_exceeded`. A chain is never more than 5 boards deep, whatever this says | `kit:99-100`, `reg:40-46`, `wf/conversation-board/chain.ts:37-43` **[code]** |
| `messages` | `{ budget?, perTurn? }` | See 1.3 | `kit:101-102` **[code]** |
| `projectCoordinator` | non-empty string | The id of the standard worker each user's project coordinator runs as. It must be a standard worker, on the `coordinator` flow, or the app does not start | `kit:103-104`, `inst:431-441` **[code]** |
| `sessionFields` | record of zod schemas | App fields on every worker session; only the server writes them; every field is visible to the session's browser | `kit:105-114` **[code]** |

Refusals at start, all in `installWorkforce` (`kit:190-281`) **[code]**:

- `generated.workerFlows` and the `workerFlows` slot both hold one name: `workforce: the generated module and \`workerFlows\` both hold "<name>". Keep one.` (`kit:203-206`)
- `agent` configured and a worker flow named `agent` also supplied: `workforce: \`agent\` is configured, and the app's worker flows hold an "agent" flow too. Keep one.` Same for `coordinator` (`kit:208-210`, `kit:218-220`).
- `agent.sessionFields` or `coordinator.sessionFields`: `workforce: \`<key>.sessionFields\` is not read; declare session fields on the kit's \`sessionFields\`.` (`kit:213-217`), `wt/workforce-kit.test.ts:248-253` **[test]**

### 1.2 Slots the kit opens

| Slot | Shape | What an entry is | Cite |
| --- | --- | --- | --- |
| `workerFlows` | keyed | A worker flow beside the built-in `agent`: a flow, `{ flow, standardOnly?, roles?, showSettings?, needsProject? }`, or a `workerFlow(...)` builder. An entry keyed `agent` or `coordinator` replaces the kit's own | `kit:12-16`, `kit:181`, `hire:129-139` **[code]** |
| `uses` | list | Capabilities added to the agent and coordinator flows the kit builds | `kit:17-18`, `kit:182` **[code]** |
| `flows` | keyed | A builder handed the installation that returns flows built on it (an app's projects flow, say). The kit ships none | `kit:19-22`, `kit:159-163`, `kit:277` **[code]** |

The kit also adds two capabilities of its own to the agent and coordinator flows: consulting another conversation (`consultSessions`) and the routine tools. Each is offered only to a worker whose file picks it (`kit:24-26`, `kit:224-230`) **[code]**. It does not add the discovery tool (section 6) and does not write the inventory (section 8): no code in `kit` calls `createWorkforceCapability` or `openInventory` **[absence]**.

What the kit registers: one copy of each worker flow at the flow's name, then `workforce-roster`, plus the GitHub and internal-event service flows when configured, plus whatever the `flows` slot builds (`kit:272-280`, `reg:97-146`) **[code]**.

### 1.3 `messages` (kit key and `hireWorkforce` option)

| Key | Default | Meaning | Cite |
| --- | --- | --- | --- |
| `budget` | 6 | The most worker messages a chain passes with no user turn between them | `wf/messages/message-limits.ts:10-11,18` **[code]** |
| `perTurn` | 3 | The most messages one turn sends | `wf/messages/message-limits.ts:13-14,20` **[code]** |

A value that is not a whole number of at least 1 throws at start: `hireWorkforce: messages.<key> must be a whole number of at least 1; got <value>.` (`wf/messages/message-limits.ts:31-35`) **[code]**. `DEFAULT_MESSAGE_BUDGET` and `DEFAULT_MESSAGES_PER_TURN` are exported (`wf/messages/message-limits.ts:11,14`; re-exported through `wf/messages/index.ts`, `wf/index.ts:166`) **[code]**. `taskChainLimit` below 1 or not whole throws `hireWorkforce: taskChainLimit must be a whole number of at least 1; got <value>.` (`wf/workers/chain-limit.ts:64-67`) **[code]**.

### 1.4 `hireWorkforce(installation, options)`

`options`: `taskChainLimit`, `messages`, `routines`, same as above (`reg:38-64`). Returns one flow copy per worker flow, sorted by flow name, then the roster flow last (`reg:99-103`, `reg:144-145`). The call reads no files and registers nothing itself (`wod` "Hiring the roster") **[doc]**. Under the kit the app never calls it.

It throws, and registers nothing, when (`reg:71-81`, `reg:104-128`) **[code]**:

- a worker flow misses the worker contract (door, configuration, `sharedResource()`); every problem with every flow is named in one error: `hireWorkforce refused <n> worker flow(s) ("a", "b"); nothing was hired:` then one `- ` line per problem (`hire:237-257`);
- a worker flow does not declare `session: installation.session()` (`reg:104-111`);
- a worker flow cannot receive worker messages, or offers the send without the pass that sends it again (`reg:112-121`);
- a standard worker would be refused on its first turn: `hireWorkforce: <n> standard worker problem(s); nothing was registered:` then one `- worker "<id>" — <reason>` line each (`reg:122-128`, `inst:524-530`).
- `routines.poll.index` equals `routines.index`: `hireWorkforce: routines.poll.index is routines.index. Give polling a schedule index of its own: one index ticks one flow.` (`reg:88-90`).

### 1.5 `createWorkerHireBlocks` and the roster actions

The roster flow `workforce-roster` carries five actions: `hire`, `fork`, `edit`, `fire`, `reset`, plus the routine actions (`reg:129-143`, `hb:80-96`) **[code]**. The block form is `createWorkerHireBlocks(installation)` and returns `{ hire, fork, edit, fire, reset }` (`hb:132`, `hb:285`).

| Action | Input (strict: another key is refused) | Output | Cite |
| --- | --- | --- | --- |
| `hire` | `id` (required, 1+ chars, one path segment, not starting with `/` or `~`), `name?`, `flow?` (default `agent`), `description?`, `instructions?`, `skills?` (names), `settings?` (the keys a `WORKER.md` takes besides `flow` and `description`) | `{ id, flow }` | `hb:26-43`, `hb:78`, `hb:177-196` |
| `fork` | `from` (a standard worker, or one of the user's own), `id` (new) | `{ id, flow }` | `hb:45-52`, `hb:198-216` |
| `edit` | `id`, then each of `name` (null clears), `flow`, `description` (null clears), `instructions` (null clears), `skills`, `settings` (replaces the stored settings whole), `settingsPatch` (sets the keys it names, keeps the rest). `settings` with `settingsPatch` is refused | `{ id, flow }` | `hb:54-72`, `hb:218-253` |
| `fire` | `id` | `{ id }` | `hb:74`, `hb:255-266` |
| `reset` | `id` | `{ id }` | `hb:76`, `hb:268-283` |

All five are writes to the caller's own roster. Nothing is registered and nothing restarts: the next turn on any process reads the row (`hb:1-15`) **[code]**, `dh` "Hiring a worker" **[doc]**. Whitespace-only `name` or `instructions` is stored as none (`hb:99-101`). The client form is `createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser`, whose `roster()`, `watchRoster()`, `hire`, `fork`, `edit`, `reset` and `fire` send these actions (`cl:132-200`, `wf/browser.ts:19-26`) **[code]**. `HireWorkerInput` and `EditWorkerInput` are exported types (`cl:98-130`).

`send` returns when the write starts, not when it ends. A write that depends on an earlier one must wait for the earlier request to settle and go on only if it `completed` (`dh` "Hiring a worker") **[doc]**. The client's own `hire`/`edit` calls wait for the result and reject with the failure's message (`cl:508-525`) **[code]**.

`watchRoster(onRoster, { onError? })`: calls `onRoster` once the roster is read, then again each time a hire, fork, edit, fire or reset changes it (reset flips `edited` on the roster entry), from any tab or any worker's turn. Only a change is reported. It follows the roster view; where push can miss a change the client reads every 3 seconds (`wf/../client/src/live/live-read.ts:38`, i.e. `packages/client/src/live/live-read.ts:38`). A failed read goes to `onError` and is retried on its own, 1 second doubling to 30 seconds; the next read that lands is reported even when the roster did not change. Several watchers on one client cost one read per interval. Returns the stop function (`cl:150-160`, `packages/client/src/internal/backoff.ts:10`) **[code]**. `roster()` reads it once.

## 2. Worker flows and roles

A worker runs on a worker flow. One registered copy of each flow serves every worker that names it; a worker is data (a row, or a standard worker from the files), so hiring one registers nothing (`reg:3-9`) **[code]**. The flows: the built-in `agent`, the `coordinator` (when the kit has a `coordinator` key), and any the app registers through `workerFlows` or `generated`.

A worker's flow is the `flow:` of its file or row; absent, `agent`. A present-but-blank `flow:` is refused (`hire:~690-700`, see 4.1) **[code]**.

### 2.1 What a worker flow must have

`hireWorkforce` checks each flow before it registers anything (`hire:237-257`, `wf/worker-flow-contract.ts`, `reg:95-111`, `wod` "Which flows can run workers") **[code/doc]**:

- the standard configuration: `workerConfigSchema()` composed into `configSchema` (`wconf`); a key it declares must accept the value a worker brings and keep it as given;
- exactly one public action that declares `userMessage` and takes `{ message }`, named `respond` (`wf/worker-door.ts:30,57-64`, `wod`);
- `session: installation.session()`, which gives every session a readonly `workerId` checked at create (`reg:104-111`, `keys:37`);
- an `onMessageReceived` internal action built by `messageReceivedEntry`, or the board factory's (`reg:112-121`);
- any resource with `writtenBy` declared through `sharedResource()`;
- the entries of each role it declares (2.2).

A flow passed under a key that is not its own `kind` is refused (`wod` "When a hire is refused") **[doc]**.

### 2.2 Roles

A flow declares what else it does with `roles` on its registration (`workerFlow(build, { roles })`, or `{ flow, roles }` in `workerFlows`). `WORKER_ROLES = ["contributor", "manager", "coordinator"]` (`wroles:74-77`).

| Role | What the flow does | Entries it needs | Built by | Cite |
| --- | --- | --- | --- | --- |
| `contributor` | Takes tasks other workers file for it | task entry `work` | `workerTaskEntry` | `wroles:6-9`, `wroles:171-175` |
| `manager` | Runs a delegation board: files tasks for delegates, hears how each ended | internal entries `dispatch` and `onTaskSettled` | `defineSessionBoard`'s `entries(turn)` | `wroles:10-12`, `wroles:177-181` |
| `coordinator` | Routes each message to delegates | a manager's, plus internal `routeOn`, `roundDeadline`, `changeWorkstreamDelegate` | `defineCoordinatorFlow` | `wroles:12-15`, `wroles:182-190` |

The built-in `agent` declares `contributor` (and `manager` when it has a board); the `coordinator` declares `contributor`, `manager`, `coordinator` (`agent-worker-flow.ts:1554`, `cf:1824`) **[code]**. A flow that declares no role takes no task and files none, so a worker on it cannot be a delegate (`wod`, `dc:101-108`).

The roles are checked both ways. A role is refused when an entry is missing, was not built by the role's factory, or refuses the input its caller sends; a role's piece on a flow that does not declare the role is refused too. Each message names the flow, the role, the entry and the fix (`wroles:246-316`). A role that is not one of the three is refused: `worker flow "<name>" declares "<x>" in \`roles\`, which isn't a role. The roles are "contributor", "manager", "coordinator".` (`wroles:~255-262`) **[code]**. `workerFlowProblems(name, flow, roles)` returns the problems without an app (`wf/index.ts:58`) **[code]**.

### 2.3 Flow marks on a registration

| Field | Effect | Cite |
| --- | --- | --- |
| `standardOnly: true` | Only standard workers may run on this flow; a user's own worker naming it is refused. A worker that names no flow runs on `agent`, and the mark is checked after that | `hire:129-139`, `hire:266-272`, `wod` "Which flows can run workers" |
| `roles` | See 2.2 | `hire:129-139` |
| `showSettings` | The flow's settings a user may see on the roster row. A name that is part of every worker's configuration (`instructions`, `skills`...), a key the hire reads itself, or one the flow does not declare in its `configSchema` is refused | `hire:196-228` |
| `needsProject: true` | A board refuses a task for a worker on this flow that is filed with no project, as `no_project`, before any row or run exists | `hire:120-127`, `wf/conversation-board/board.ts:1290-1306` |

The built-in `agent` declares a fixed set of settings. `defineAgentWorkerFlow({ settings })` adds an app setting (a name the flow already uses is refused); the agent flow never reads it, so it cannot change how a worker runs (`wf/agent-worker-flow.ts:~640-660`, `wod` "Settings a user can see") **[code/doc]**.

## 3. The roster

### 3.1 Roster states (table)

A roster entry (what `rosterView` and `roster()` answer): `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited`, `settings`. There is no status field (`rv:22-32`, `cl:62-96`) **[code]**. The roster view returns the user's own workers first, then the standard workers, each part sorted by id; every page of the standard projection is read (`rv:85-95`, `rv:118`) **[code]**.

| State | What it is | `standard` | `edited` | `forkedFrom` | `teamName` | Cite |
| --- | --- | --- | --- | --- | --- | --- |
| Standard | A `WORKER.md`. Every user has it, set up as the file says | `true` | `false` | `null` | the file's team name | `rv:96-106`, `inst:34-38`, `wod` "Hiring the roster" |
| Edited | A standard worker the user changed: their own copy under the same id. Listed once, as the copy, still standard and on its file's team | `true` | `true` | `null` | the file's | `rv:109-117`, `hb:218-236` |
| Forked | A user's own worker made from another worker's configuration under a new id | `false` | `false` | the source id | `null` | `rv:103`, `hb:198-216`, `hb:108-124` |
| Hired | A user's own worker made from scratch | `false` | `false` | `null` | `null` | `hb:177-196` |

Notes **[code]**:

- A hired worker's id is chosen by the user: one path segment, not starting with `/` or `~`. The naming rules for file workers do not apply (`hb:26`). An id that is a standard worker's is refused (4.1).
- A fork copies configuration: flow, description, instructions, the team instructions the standard worker carried, skill names, settings (`hb:108-124`; `wt/worker-roster.test.ts:120-132` **[test]**). A later change to the files does not reach the fork (`wt/worker-roster.test.ts:120-134` **[test]**). The standard worker is unchanged for everyone (`wt/worker-roster.test.ts:136-141` **[test]**). A fork starts with no conversations (`dh` "Forking a worker" **[doc]**).
- A fork of an edited standard worker starts from the user's copy, without its name (`hb:204-211`, `wt/worker-roster.test.ts:371-380` **[test]**). A fork's `name` is `null`.
- A copy made by editing a standard worker keeps the file's `name:` (`hb:103-108`, `rowFromStandard(..., keepName)`).

### 3.2 Lookup: What happens when a user edits a standard worker?

- The first `edit` of a standard worker's id writes the caller's own copy under the same id: the file's configuration (flow, description, instructions, team instructions, skill names, settings, name) with the fields in the edit replacing it (`hb:218-253`, `hb:11-14`) **[code]**.
- It is the user's own row. The file is never written. Hire, fork and fire refuse a standard worker's id (`hb:11-12`, `hb:143-149`).
- Effect: the copy is read before the file on the roster and on every turn, so it takes effect on the next turn, in every session of that worker, on any process (`hb:12-14`, `wt/worker-roster.test.ts:297-300` **[test]**). Other users' copies and the file are unaffected (`wt/worker-roster.test.ts:297` title **[test]**).
- The worker stays on its file's flow: naming another flow is refused, `"<id>" runs on "<flow>", as its file declares, so its flow can't be changed. Nothing was written.` (`hb:233-236`). A coordinator, standard-only flow and board tasks all reach a standard worker on the file's flow.
- The copy keeps the file's own skills and packages: a name-only edit changes nothing else about the turn (`wt/worker-roster.test.ts:334-357` **[test]**).
- `reset(id)` deletes the copy so the file is read again. It is refused on a worker that is not standard (`"<id>" isn't a standard worker, so there is no default to reset it to. Nothing was written.`) and on one the user has not edited (`You haven't edited "<id>", so it already matches its file. Nothing was written.`) (`hb:268-283`) **[code]**.
- On the roster the entry shows `standard: true`, `edited: true`.
- A fired standard worker does not exist: `fire` refuses it (`"<id>" is a standard worker, which nobody can fire. Fork it to get a worker of your own.`, `hb:143-149`, `hb:261`).
- Restarting `fsdev dev` on a file change is a CLI behaviour, not a roster one; it belongs on the CLI page (`cli.facts.md`, `dev`).

### 3.3 Fire

`fire` deletes the user's own row; it is refused on a standard worker and on an id not on the user's roster (`No worker "<id>" on your roster.`) (`hb:169-175`, `hb:255-266`). The user's past sessions with it stay readable. A new turn in one is refused with the worker named as fired: `Worker "<id>" was fired. This session stays readable; a new turn can't run as it.` (`inst:857-859`) **[code]**, `dh` "Changing or firing a worker" **[doc]**. Every process sees the fire on the next turn.

If an edit moves a worker to another flow, its earlier sessions stop taking messages, naming both flows: `Worker "<id>" now runs on flow "<new>", and this session runs on "<old>". A session stays on the flow it was created on: start a new session to talk to it on "<new>".` (`inst:863-868`) **[code]**.

A user's own worker that stops resolving after it was saved (a tool removed, its flow now `standardOnly`) is not dropped: its next turn is refused naming the problem, and an `edit` fixes it (`inst:869-876`, `wod` "When a hire is refused") **[code/doc]**.

### 3.4 Who owns the roster

Only the owner reaches a worker. Another user cannot list it, open its sessions, message it or create a session with it, and asking for another user's worker gets the answer for one that does not exist (`inst:709-713`, `dh` "Who can reach a worker") **[code/doc]**. A worker acts only for its owner; a message cannot cross users, only workers on the same roster (`dc:40-47`, `inst:709-713`) **[code]**.

### 3.5 Where a worker's id is used

A session names its worker as `state.workerId` when it is created, readonly afterward (`keys:37`, `inst:700-706`). `delegates:` names workers by id. A block inside the worker reads `ctx.flow.config.workerId`; a `WORKER.md` that declares `workerId:` is refused by name (`wconf:175-192`, `wf/manifest.ts:482-496`) **[code]**.

## 4. Refusals and what each names

Every refused write changes nothing. A refused roster action's request ends `failed`, and its error says why (`dh` "When something is refused" **[doc]**; `hb:9`).

### 4.1 Roster writes (`hire`, `fork`, `edit`, `fire`, `reset`)

| What happened | The error | Cite |
| --- | --- | --- |
| `hire`, `fork` onto, or `fire` of a standard worker's id; `edit` of one onto another flow is separate (3.2) | `"<id>" is a standard worker, which nobody can <hire over|replace|fire>. Fork it to get a worker of your own.` | `hb:143-149`, `hb:183`, `hb:204`, `hb:261` |
| `hire` or `fork` under an id already on the roster | `"<id>" is already on your roster. Pick another id. Nothing was written.` | `hb:158-167` |
| `fork` from, `edit` or `fire` of, a worker the user has not got | `No worker "<id>" on your roster.` | `hb:169-175` |
| A stored row that cannot be read | `Worker "<id>" can't be read: <reason>.` | `hb:173` |
| The flow names no registered worker flow | `Worker "<id>" names flow "<flow>", which isn't a worker flow here. Worker flows: "agent", ... Nothing was written.` | `inst:615-620`, `hb:151-156` |
| The flow is `standardOnly` | `Worker "<id>" names flow "<flow>", which this app keeps for declared workers, the ones its WORKER.md files define. A hired worker can't run on it. Nothing was written.` (a worker naming no flow reads `names no flow, so it runs on "agent"`) | `hire:266-272`, `inst:621` |
| A skill nothing registers | `Worker "<id>" names skill "<name>", which this installation doesn't register. Remove it, or register it. Skills it registers: "a", "b". Nothing was written.` (with none registered, `It registers no skills.`) | `inst:561-575`, `wt/worker-roster.test.ts:98-114` **[test]** |
| A tool the flow does not know (built-in `agent`) | `names tool "<name>", which nothing registers for this worker — neither its own \`blocks/\` folder nor the app's tool catalog. Known catalog tools: ... ` | `wf/agent-worker-flow.ts:485-502` |
| A setting the flow's schema refuses | `Worker "<id>" <the flow's own reason>. Nothing was written.` | `hb:151-156`, `inst:621-625` |
| `edit` of a standard worker onto another flow | `"<id>" runs on "<flow>", as its file declares, so its flow can't be changed. Nothing was written.` | `hb:233-236` |
| `edit` with `settings` and `settingsPatch` | `Give settings (replace them whole) or settingsPatch (change the ones named), not both.` | `hb:70-72` |
| `reset` of a worker that is not standard, or one not edited | see 3.2 | `hb:274-279` |
| An id with `/`, or starting with `~`, on `hire`/`fork` | the schema message `a worker id is one path segment and can't start with ~` | `hb:26` |

A worker's configuration is checked when it is written, and again on every turn (`wr:52-58`, `hb:1-10`) **[code]**.

### 4.2 Why a worker is refused at hire or start (standard workers and rows)

For a standard worker every one of these is a startup failure: `hireWorkforce` throws, collects every problem first, and returns nothing, so one run names all of them (`reg:122-128`; `wod` "When a hire is refused" **[doc]**). Each problem line is prefixed `worker "<id>" — `. A user's own worker is checked the same way when hired or edited. A worker is refused when it (`hire:~668-760`, `wod`) **[code/doc]**:

| Cause | What the message says | Cite |
| --- | --- | --- |
| Two workers share an id | `declared twice in this roster; a worker's id is its address and must be unique` | `hire:~650-655` |
| `persona:` declared | `declares \`persona:\`, which is not a setting a worker declares. A worker's instructions are spelled \`instructions:\`...` | `wf/manifest.ts:353-356` |
| `workerSkills:`, `teamInstructions:`, `workerTools:`, `workerPackages:`, `workerId:` declared | each: `declares \`<key>:\`, which is not a setting a worker declares.` with a sentence on where the value comes from | `wf/manifest.ts:261-263,339-342,431-434,469-472,494-496` |
| `instructions:` in the frontmatter and a body | `declares "instructions" in its frontmatter and carries a body — two sources for one setting, and there is no precedence rule. Remove one...` | `hire:~715-725` |
| `flow:` present but empty or whitespace | `declares an empty \`flow:\`, which names no worker flow. Remove the key to hire on the built-in \`agent\` worker flow, or name a worker flow you passed` | `hire:~735-745` |
| `flow:` not a string (`null`, a number) | `declares \`flow:\` as <json>, which names no worker flow. Remove the key...` | `hire:~747-756` |
| `flow:` names a flow not passed | `names flow "<flow>", which is not in the worker flows passed to hireWorkforce. Worker flows passed: "agent", ...` | `hire:196-198` (`missingFlowReason`), `hire:319-327` |
| A standard worker's `delegates:` names a worker that is not standard | `createWorkerInstallation: standard worker "<id>" names "<x>" in \`delegates:\`, which isn't a standard worker. A standard worker's delegates must be standard workers too.` (`delegates: all` is exempt) | `inst:416-427` |
| A settings key its flow never declared, or a required one missing | the flow's own schema message | `wod` **[doc]** |
| An unresolved `packages:`, `references:` or `resources:` entry, a name clash, or a grant collision | named by case | `wod` "When a hire is refused" **[doc]**; each case in `wf/packages-on-disk` pages |
| A user's own worker names a flow kept for standard workers, or names none when `agent` is kept | see 4.1 | `inst:621` |

`readWorkforceFolder` (the kit's reader) throws when anything in the tree failed to load, naming every problem: `the workforce folder did not load:` then `  - <layer> <path>: <message>` per problem (`wf/loader/read-workforce-folder.ts:80-91`). The engine also stops the app on any file in the kit's folder that no reader claimed, naming each (`packages/core/src/kit/define-kit.ts:68-74`) **[code]**. `readWorkforceFolder` is the only loader function exported (`wf/loader/index.ts:17-20`); the lower-level `readWorkforce` is internal and not on the page **[code]**.

A worker file naming `flow: coordinator` with no `coordinator` key in the kit stops the app, and the error names the flow: `... names flow "coordinator", which is not in the worker flows passed to hireWorkforce. Worker flows passed: "agent"...` (`hire:196-198`, `reg:122-128`) **[code]**.

### 4.3 Session create and turn refusals

| When | The refusal | Cite |
| --- | --- | --- |
| A session create with no `workerId` | `A session of flow "<flow>" runs one worker: name it as "workerId" when the session is created.` | `inst:665-670` |
| An unknown id (also another user's) | `No worker "<id>".`, status 404 | `inst:713` |
| A row that cannot be read | `Worker "<id>" can't be used: <problem>.` | `inst:714-716` |
| A session on the wrong flow | `Worker "<id>" runs on flow "<flow>", not "<kind>". Create its session on "<flow>".` | `inst:717-722` |
| A user's own worker on a flow kept for standard workers | `Worker "<id>" <standardOnly reason>.` | `inst:723-725` |
| A create naming a server-owned field (`taskId`, `filingFlow`, `filingWorkerId`, `taskChain`, `taskFlow`, `filingWorkstreamId`, `filingProjectId`) outside a hand-over | `"<key>" is set only when a session's board hands a task over; a caller cannot set it.` (400) | `inst:671-687` |
| A create naming an app session field | `"<key>" is written only by the server, when the session opens or a task is handed over; a caller cannot set it.` (400) | `inst:689-698` |
| A create naming `filingSessionId` | `"filingSessionId" is set only when a conversation opens the session; a caller cannot set it.` (400) | `inst:699-706` |
| A create naming `delegates` on a coordinator | `Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.` (400) | `wf/coordinator/coordinator-state.ts:70-77`, `dk:26-29`, `wt/coordinator-delegates.test.ts:309-318` **[test]** |
| A turn on a session naming no worker | `This session of flow "<flow>" names no worker, so this turn has no worker to run as.` | `inst:834-838` |
| A turn on a flow that is not a worker flow | `Flow "<flow>" isn't a worker flow here, so worker "<id>" can't run on it.` | `inst:852-854` |
| A turn on a fired worker, or a moved one | see 3.3 | `inst:857-868` |
| A turn on a worker whose configuration no longer passes | `Worker "<id>" can't run: <problems joined by "; ">.` | `inst:876-886` |
| A `projectId` create on a flow other than the project coordinator | `Only a session of the project coordinator "<id>" links to a project, not one of "<worker>".` | `inst:750-754` |
| A project coordinator session at an id of the user's own choosing | `A project's coordinator is one session per user per project, at the id derived for it: create it with ensureWorkerSession({ worker, projectId }), with no session id of your own.` | `inst:755-762` |
| A project link naming a project the user cannot read | `You have no private project "<id>".` or `This organization has no project "<id>" you can read.`, status 404 | `inst:773-787` |

Task board refusals that name a worker or a project, from the conversation's board: `no_project` (a task for a worker on a flow with `needsProject` filed with no project: `"<assignee>" works in a project's files, and this conversation has no project for it to work in. Nothing was filed. Set the project of the conversation that files it: call listProjects, then setWorkProject with the one to work in ...`, `wf/conversation-board/board.ts:1290-1306`, `wf/projects/run-project.ts:48-55`) **[code]**; `unknown_assignee` and the rest of the task-board refusals are on the task-board page (`packages/orchestration/src/skills/task-tools-capability.ts:359-366`).

### 4.4 Project and workstream refusals

`ProjectRefusedError` carries a `reason` a caller branches on; its message is `<reason>: <detail>` (`pref:61-70`) **[code]**.

| `reason` | When | Cite |
| --- | --- | --- |
| `not-a-member` | The session's user is not in the project's `members` (change a field, open a workstream) | `pref:7`, `pw:498`, `ww:426-429` |
| `no-such-project` | No row holds the id at that visibility. Another user's private project gets this too | `pref:8-9`, `wf/projects/project-address.ts:111-128` |
| `private-has-members` | A private create names someone besides its owner | `pref:10`, `pw:~345-355` |
| `invalid-project-id` | The id is `unassigned`, empty, or not one path segment | `pref:44`, `pc:297-306` |
| `project-id-held` | Another owner's row holds the id | `pw:~305-310` |
| `invalid-repository` | The repository is a bare path, starts with `-`, or carries a credential. The message never repeats the value | `pref:33-34`, `pw:257` |
| `repository-unusable` | The host's `checkRepository` says no run could check it out | `pref:35-38`, `pw:268` |
| `invalid-mcp-server` | An MCP server is not a bare name (lowercase letters, digits, hyphens) | `pref:49-50` |
| `unknown-mcp-server` | The host does not offer a server of that name | `pref:51-52` |
| `invalid-check` | A check command is not one program and its arguments, run with no shell | `pref:55`, `pw:276` |
| `invalid-workstream-id` | A workstream id is empty or not one path segment | `pref:11-12`, `wcol:~120-125` |
| `no-such-worker` | The lead is not on the caller's roster. Another user's worker gets this too | `pref:13-14`, `ww:432-435` |
| `cannot-lead` | The lead's flow cannot lead, or the worker lists no delegates | `pref:15-16`, `ww:395-405` |
| `lead-doesnt-fit` | The fit check answered that none fits a worker's own pick of lead (only on the tool a worker calls) | `pref:17-19`, `ww:36-48` |
| `lead-differs` | The workstream is open already with another lead: `workstream "<id>" is already open, led by "<lead>". A workstream's lead doesn't change.` | `pref:20`, `ww:368` |
| `no-such-workstream` | The caller has no such workstream | `pref:21`, `ww:841-844` |
| `not-a-workstream-session` | The lead's tool ran on a session that leads no workstream | `pref:22`, `ww:724` |
| `too-many-workstreams` | The owner has 25 open workstreams in the project and the installation names a project coordinator | `pref:30-31`, `ww:445-455`, `dk:28` |
| `other-project` | A write from a conversation linked to one project names another | `pref:32-33`, `pco:96-111` |

A run whose source (`projectWorkspace()`) refuses is refused before any file or clone exists, with a reason: `no-project`, `no-such-workstream`, `no-such-project`, `not-the-owner`, `not-a-member`, `other-project` (`wf/projects/project-workspace.ts:46-58`, `wf/projects/run-project.ts:40-47`) **[code]**. On a conversation's board such a refused run ends the task `errored`, on its first attempt, with the refusal as its error; it is never retried. On a fixed board the row is `cancelled` (`packages/harness-manager/test/claim-board-refused.spec.ts:1-8,41-52,66-78` **[test]**). A task depending on the refused row is cancelled (`:55-64`).

## 5. Coordinators

### 5.1 Kit option `coordinator`, and the file keys

Kit option `coordinator` (`CoordinatorFlowOptions` without `installation`): `routeModel` (string or evaluation model; **required by the type**, no default; it is called only by `best-fit`, and a failed call goes to `fallback` (`fit-check.ts` header, `cf:342` rule 3)), `agent` (the options the built-in agent flow takes, for the coordinator's own turn; `uses` capabilities reach the coordinator's own turn), `roundDeadlineMs` (default 5 minutes; a positive whole number of milliseconds or the flow throws `defineCoordinatorFlow: roundDeadlineMs must be a positive whole number of milliseconds, not <n>.`), `routines` (`true` keeps the four routine verbs as actions) (`cf:205-241`, `cf:395-399`, `ck:177-178`) **[code]**. `routeModel` is shared by every coordinator on the flow (`cf:1080`). A custom `coordinator` flow in `workerFlows` replaces the kit's only when the kit's `coordinator` key is dropped (`kit:218-220`).

A coordinator worker's file keys (`cc:62-85`, `cc:41`):

| Key | Type, default | Meaning |
| --- | --- | --- |
| `delegates` | list of worker ids (at most 25), or `all`; default `[]` | The defaults each conversation starts from. Any worker may list them. A standard worker may name only standard workers (`wconf:195-215`, `inst:397-427`) |
| `routing` | `judgment` (default), `best-fit`, `round-robin`, `everyone` | How a message finds its delegates (5.2) |
| `fallback` | one of `delegates` | Where best fit sends a message it cannot place |
| `minConfidence` | number 0 to 1; no default; only with `best-fit` | The lowest confidence at which a delegate pick is used |
| `editsOwnDelegates` | boolean, default `false` | Whether the model gets `addDelegate`, `removeDelegate`, `setFallback` as tools |
| `rounds` | integer 0 to 3, default 0 | How many times answers go back out (`ck:175`) |
| `inferredWork` | `off`, `observe` (default), `auto` | What the coordinator does with an event nobody asked it about: `off` lands it as a line and runs no model; `observe` runs the turn and every task it files waits on the user's yes in Inbox; `auto` runs it as any other (`cc:24-29`, `ck:136`) |
| `defaults` | sections of the default layer | Authored like `delegates` (`wconf:219-232`) |

Start refusals for a coordinator file: `rounds can be at most 3`; `minConfidence must be a number from 0 to 1`; and across keys, `names "<x>" twice in \`delegates:\``, `names "<x>" as \`fallback:\`, which isn't one of its \`delegates:\``, `sets \`minConfidence:\`, which only \`routing: best-fit\` reads`, joined as `This coordinator <problems>.` (`cc:37-38,77-82,103-121`, `cf:1829-1836`, `wt/coordinator-delegates.test.ts:50-58,80-111` **[test]**). `delegates: all` skips the duplicate and fallback checks (`cc:107-108`).

### 5.2 Routing modes (table)

A coordinator hands each user message to delegates by filing one ordinary task on the conversation's board per pick, in the delegate's ongoing session for this conversation, result to this conversation, one attempt (`cf:44-56`, `wf/conversation-board/board.ts:1368`) **[code]**. Every pick is checked against the user's roster when the message arrives, so a fired delegate is skipped and recorded (`cf:32-36`). The coordinator never routes to itself (`cf:796-798`, `cf:964-968`).

| Mode | Who decides | Model calls per message | What the delegate or delegates are | When answers go back out | Cite |
| --- | --- | --- | --- | --- | --- |
| `judgment` | The coordinator's own turn reads the message, then files tasks with `createTask` (naming the delegate), or answers itself | The coordinator's own turn | Whoever the turn names | When the round closes | `cf:15-24`, `cc:11-14` |
| `best-fit` | One evaluation (the fit check) over the delegates' descriptions; the ladder below | One `routeModel` call, unless the message goes to the delegate still holding the user's last message | The one delegate picked | As each answer lands | `bf:1-30`, `cf:25-31`, `crd` header |
| `round-robin` | The next delegate in list order after the one the user's last message went to; a turn is claimed before it is checked, so two messages at once take two turns | None | One delegate | As each answer lands (never back to its author) | `cf:1260-1316`, `cf:68-76` |
| `everyone` | Every delegate that can be reached | None | Every reachable delegate | When the round closes | `cf:1328-1357` |

Best-fit ladder, in order (`bf:6-30`, `bf:97-133`) **[code]**, `wt/best-fit.test.ts`:

1. **Held.** The delegate still holding the user's last message, if it can be reached, gets this one too, with no model call. Only a user's message moves the hold (`cf:1113-1119`, `cf:1131-1138`).
2. **Evaluated.** One `routeModel` call. Its input is the message plus the conversation's last 10 lines (`wf/coordinator/coordinator-lines.ts:31`, `cf:1087-1089`, text kept to 4,000 characters in all, counted from the newest line back; the line that crosses is cut and ends in `…`, older lines dropped `:20-34,227-239`). The text a delegate is matched on is its note (from `addDelegate`) else its worker's description; a delegate with neither is never offered (`cf:1022-1024`). On a user's message the coordinator itself is also offered, keyed by its own id, when it has a description (`cf:1020-1030`).
   - The call is asked as an evaluation first; when it fails on a model string it is asked once more as a language model (`wf/fit-check.ts:15-21`).
   - `minConfidence`: some evaluation models report a confidence from 0 to 1; a delegate pick below `minConfidence` is not used. A pick with no confidence is not used when `minConfidence` is set; a confidence is never made up. A pick of the coordinator is used at any confidence (`bf:11-13,112-125`, `cc:17-18`).
3. **Fallback.** When the call failed, picked something that is not an option, picked below the floor or with no confidence under a floor, or there was nobody to pick from, `fallback` takes the message if one is set and can be reached.
4. **Coordinator's own turn.** When the pick was the coordinator, or nothing placed it, the message goes to the coordinator's own judgment turn (`cf:1118-1128`, `cf:1244-1249`).
5. **Nobody.** Only when that turn itself fails, the message is unplaced: it is recorded and said in the conversation as `Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <message>.` The crash is still sent to the error reporter (`cf:1183-1214`).

`round-robin` and `everyone`, with no delegate that can be reached, say `Nobody took this message: no delegate in this conversation can be reached.` (round-robin on an answer going back out: `no other delegate in this conversation can be reached`; everyone on an answer going back out: `no delegate that can be reached has another's answer to get`) (`cf:1305-1313`, `cf:1349-1356`, `cf:1227-1241`) **[code]**. That line is a message with no `agentName`; a delegate's answer carries the delegate's worker id; the coordinator's own turn's reply carries an `agentName` starting with `coordinator-judgment` (`COORDINATOR_JUDGMENT`, exported from `@flow-state-dev/workforce/browser`, `wf/browser.ts:92`, `ck:149`) **[code]**.

### 5.3 Rounds

`rounds` is how many times answers go back out, 0 by default, at most 3. Below the limit, best fit and round-robin route each answer again as it lands, never to its author; `everyone` and `judgment` send a round's answers on when the round closes (`cf:68-83`, `ck:175`). A round closes when every delegate in it has answered, failed or been cancelled, or at its deadline (default 5 minutes, `roundDeadlineMs`). A delegate still working at the deadline keeps working, and its answer lands once and goes no further (`wt/coordinator-rounds.test.ts:191-202,483-510` **[test]**). A conversation keeps at most 50 rounds open; a message past that is still delivered, its answers go no further, and its route record carries a `note` (`crd:51`, `wt/coordinator-rounds.test.ts:744-795` **[test]**). A deadline survives a restart on a host that keeps wakes (an engine wake on the conversation's session); a host with no wakes keeps an in-process timer (`cf:84-96`, `wt/coordinator-rounds.test.ts:618-700` **[test]**). The most delegate turns one message can start is delegates x (rounds + 1): 100 with 25 delegates and 3 rounds **[derived]** from `dk:28` and `ck:175`.

### 5.4 Delegates: the list, the actions, the check

The file's `delegates:` seeds each conversation. The conversation copies it the first time its delegates are read or changed. `addDelegate`, `removeDelegate` and `setFallback` change only that copy; the file is never written (`wconf:195-212`, `dl:70-80`, `cf:6-12`) **[code]**.

Actions on any worker whose flow carries the board: `addDelegate` (`worker`, optional `note`), `removeDelegate` (`worker`), `setFallback`, `listDelegates` (`dk:10-14`, `wd:440`). Their output is the conversation's list after the call: `{ delegates, fallback, max: 25, filingSessionId }` (`wd:113-120`). `listDelegates` adds, to each delegate, `description` (the worker's description or `null`) and `takes` (`tasks` or `nothing`), read from the roster at call time (`wd:100-106`, `dc:69-79`). The view `delegates` answers the same, live (`dk:17-18`). The same four are tools; the three that change refuse unless the worker's file set `editsOwnDelegates`: `This worker's delegates are changed by its user, not by this worker: it wasn't set at hire to change its own (editsOwnDelegates). Ask the user, or message whoever filed your task. Nothing was changed.` (`wd:200-205`) **[code]**.

| Refusal | Message | Cite |
| --- | --- | --- |
| `addDelegate` for a worker not on the user's roster | `No worker "<id>" on your roster.` | `dc:97` |
| a row that cannot be read | `Worker "<id>" can't be a delegate: <problem>.` | `dc:98-100` |
| the worker's flow takes no task | `Worker "<id>" runs on flow "<flow>", which takes no task, so it can't be a delegate.` | `dc:102-108` |
| `addDelegate` of one already listed | `"<label>" is already a delegate in this conversation.` | `dl:124` |
| a 26th delegate | `This conversation already has 25 delegates, the most it can hold. Remove one first.` | `dl:127-131` |
| `removeDelegate` of one not listed | `"<label>" isn't a delegate in this conversation.` (checks only the list, so a fired delegate can be removed) | `dl:136`, `wt/coordinator-delegates.test.ts:267-293` **[test]** |
| `setFallback` to one not listed | `"<label>" isn't a delegate in this conversation, so it can't be the fallback.` | `dl:150` |

Another user's worker and a worker that does not exist get the same answer (`dc:40-47`). A fired delegate that was already handed a message still answers it. Removing the fallback clears it, and best fit then hands what it cannot place to the coordinator's own turn (`wt/coordinator-delegates.test.ts:267-293`).

### 5.5 Lookup: Which worker may hand work to which?

A worker hands work to the workers in its conversation's delegate list (`wconf:195-212`). The grant is that list; a task goes to no one else (`wconf:202-206`) **[code]**. A worker can be a delegate when (`dc:40-47`, `dc:95-108`):

1. it is on the **filing user's own roster** now (their own worker, or a standard one); another user's worker is simply not there;
2. its stored row can be read;
3. its flow declares the `contributor` role. The built-in `agent` and `coordinator` flows declare it, so workers on them (another coordinator included) are eligible with no setup (`agent-worker-flow.ts:1554`, `cf:1824`).

More rules **[code]**:

- `delegates: all` means the whole roster, the worker itself included, read on every call, so a worker hired mid-conversation is reachable at once. The 25 cap bounds a written list, not `all`. Only the user's worker file sets `all`: no tool switches a list to it (`wconf:196-211`, `dk:20-25`). The coordinator skips itself when routing and refuses a task filed for itself: `"<id>" is you: answer the message yourself rather than file it for yourself.` (`cf:796-798`).
- A standard worker may name only standard workers in `delegates:`; the app does not start otherwise. `delegates: all` is exempt (`inst:397-427`, `wt/coordinator-delegates.test.ts:42-48` **[test]**).
- A task for a worker not in the conversation's delegates is refused, and the refusal names the worker: `unknown_assignee: "<id>" is not on this board's team. Available: ...`; nothing is stored. A worker that is another user's and one nobody holds get the same answer (`packages/orchestration/src/skills/task-tools-capability.ts:359-366`, `wt/delegates-as-authority.test.ts:17-31,53-65` **[test]**).
- A worker whose flow takes tasks only from a board of its own is not `workerTaskEntry`'s: register it without `contributor`; `listDelegates` then reports `takes: "nothing"`, routing skips it and `createTask` refuses it (`wt/delegate-takes-conversation-tasks.test.ts:81-114` **[test]**).
- A custom flow is a delegate with the `contributor` role plus a `work` task entry built with `workerTaskEntry`; either without the other is refused at start, and each refusal names the flow, the role and the entry (`wroles:171-175`, `wroles:246-316`) **[code]**.
- A flow of the app's own that is a delegate is handed the message only, unless its generator sets `history: routedTaskHistory` (from `@flow-state-dev/workforce`) (`wf/index.ts:71`, `wf/coordinator/routed-brief.ts:~146`, `wt/coordinator-followup-context.test.ts:384-390` **[test]**).
- A task with no `assignee` goes to the conversation's only task-taking delegate; with several it waits unassigned (`wf/delegates/worker-delegates.ts` `soleTaskDelegate`, `board.ts:1296`) **[code]**.
- A delegate may file tasks only for its own worker's delegates, and a task chain is at most 5 boards deep (`wf/conversation-board/chain.ts:37-43`).

### 5.6 What the coordinator's model gets

- The task tools of the conversation's board, named `<tool>_tasks` as actions (`createTask_tasks` and its siblings); they answer `no_delegation_board` while none of the conversation's delegates takes tasks. The tools are on a turn while one of its delegates takes a task. Task tools come from one capability instance (`wf/conversation-board/session-board.ts:6-26`, `cf:~1330-1340`) **[code]**.
- `listDelegates`, and the three change tools when `editsOwnDelegates` is true.
- The routed filing rules: a task filed while routing a message must name an `assignee` (`routed_assignee_required`, `cf:836-841`); a pick that cannot be handed on is refused `not_routed: not handed to <worker>: <reason>. Nothing was filed.` (`cf:856-860`); `held`, `deps` and `followUpOf` are refused `routed_task_starts_now` (`cf:826-834`); a `session` other than `"ongoing"` is refused `routed_session_ongoing` (`cf:820-825`). A routed task has one attempt (an ordinary task has two, `board.ts:179-184,1368`). Its `session`, `resultTo`, `target` cannot be changed afterward (`filing_setting_fixed`, `packages/orchestration/src/skills/task-tools-capability.ts:1698`).
- A routed task's turn is handed `{ message }`, where the message reads `<from>, through <coordinator>: <message>`, plus `Your task: <goal>` on its own line when the coordinator's turn filed it with a goal. Whatever the turn returns (a string or `{ text }`) is the answer; an empty answer lands nothing (`wf/coordinator/routed-brief.ts:75-90`) **[code]**. The delegate's session keeps the user's message and its answer (`cf:38-46`).
- Cancelling a routed task (`updateTask_tasks` with `status: "cancelled"`) ends the delegate's part with no line and its late output does not land; the delegate's turn itself runs on (`wt/coordinator-rounds.test.ts:588-616` **[test]**).

### 5.7 Surface table: slots, items, views

| | |
| --- | --- |
| Slots it opens | None. The coordinator declares no slot of its own (`kit:175-183`) |
| Slots it fills | None |
| `uses` | `coordinator.agent.uses` capabilities reach the coordinator's own turn; the kit adds `consultSessions` and the routine tools (`kit:246-256`) |
| Views | `listTasks_tasks` (the conversation's board), `delegates` (`wf/conversation-board/session-board.ts:20`, `dk:18`) |
| Items | `coordinator-route`, one per routing decision (`ck:146`, `cr:1-5`). A client tells it from a line by that type (`ck:140-146`). A React app registers a renderer under `COORDINATOR_ROUTE` in `FlowProvider`'s `renderers.data`; the renderer gets `{ item: DataItem }` and reads `item.value` (`packages/react/src/registry/block-renderers.ts:53-58,83-85`) |
| Read the records outside a renderer | `fsd.sessions.requests(session.id, { includeItems: true })`; without `includeItems: true` a request carries no `items` |

The route record's fields (`cr:97-123`): `messageRequestId`, `round` (0 for a user's post), `policy` (the conversation's routing), `by` (`judgment`, `held`, `evaluated`, `fallback`, `round-robin`, `everyone`, `unplaced`), `delegates` (each with `worker`, `outcome` `delivered` | `skipped` | `failed`, `reason`), `none` (why nobody was delivered to), `answeredItself` (judgment answered with no delegate tried), `fit` (`reason`: `coordinator`, `below-floor`, `no-confidence`, `failed`, `not-a-choice`, `no-delegates`; plus `choice`, `confidence`, `minConfidence`), `evaluationFailed` (the evaluator's error when the second ask was needed), `note`. The record is visible to the client and not to the model (`cr:116-122`).

### 5.8 Low-level API

An app on the kit builds none of this. `createWorkerInstallation` and `hireWorkforce` are not exported from any public entry (`wf/workers/index.ts:50-61`); only the kit calls them (`kit:246-256`), so the page does not tell an app to call them. Rows for these low-level options are carried only by their signatures; no table here.

## 6. Discovery output

The discovery tool is `discover`, added by `createWorkforceCapability({ roster, inventory, sources? })`, composed into a worker flow's `uses`. The kit does not add it (`wf/workforce-capability.ts:1-30`, `kit` **[absence]**).

| Part | Fact | Cite |
| --- | --- | --- |
| Input | `{ domain?: string \| null, detail?: "thin" \| "full" }`; `domain` default `null` (every domain in scope), `detail` default `thin` | `packages/core/src/manifest/discovery-tools.ts:110-121` |
| Domains | `workers`, `skills`, `resources` (`MANIFEST_DOMAINS`) | `packages/contracts/src/types/manifest.ts:33` |
| Output | `{ domains: [{ domain, entries, problem? }], problem? }`; entries sorted by `id` | `discovery-tools.ts:49-55,79-88,122-153` |
| Entry fields | `id`, `kind`, `purpose`; `contract` only with `detail: "full"`, and only when the entry has one | `discovery-tools.ts:44-49`, `:79-90` |
| A worker's entry | `kind` is `"worker"` (not its flow). `purpose` is the file's `description:`, trimmed; else the worker's instructions (body); else `The worker "<id>". Its file declares no description.`. `contract` (full detail) is `Hired into the "<flow>" worker flow. Hand it work by its id.` | `wf/manifest-sources.ts:104-117`, `:165-180` |
| Which workers | Only workers present in both the declared files and the inventory rows: an inventory row whose file is gone is not listed. Hired and forked workers are not listed | `wf/manifest-sources.ts:157-180` **[code]** |
| Unknown domain | Not a throw: `{ domains: [], problem: 'Unknown domain "<x>". Known domains: workers, skills, resources. Call again with one of those, or omit \`domain\` for everything in scope.' }` | `discovery-tools.ts:127-134` |
| A domain that throws | Reported as `problem` on that domain with no entries; the others still answer. A cancelled request still throws | `discovery-tools.ts:55-88`, header 14-22 |
| A domain with no source | `{ domain, entries: [] }` | `discovery-tools.ts:70-71` |
| Narrowing | A worker's `discover:` list in its file keeps only the domains it names: omitted, every domain the scope carries; `[]`, none. It only subtracts: a domain the app did not install cannot be added. A misspelt domain is refused at start by name | `wf/worker-discovery.ts:1-26`, `wf/worker-discovery.ts:57-63`, `wconf:~625-641` |
| Not on by default | The tool is a control tool, held because the flow composed the capability; the preset `door` can be turned off | `wf/workforce-capability.ts:130-150` |
| The workers domain needs the key | With no inventory key given, the domain has no source and the door carries one domain fewer, not an error | `wf/manifest-sources.ts:196-205`, `wf/workforce-capability.ts:60-66` |

## 7. Projects and workstreams

### 7.1 Where they live and who may do what

- A project's address is its visibility plus its id (`{ visibility: "shared" | "private", id }`). A private and a shared project with one id are two projects. Every read and write after the create takes an address (`pc:19-24`, `pc:75-83`) **[code]**.
- A private address reaches only the caller's own user scope. Another user's private project is refused as if it did not exist (`no-such-project`, `wf/projects/project-address.ts:6-10,111-128`).
- Visibility and `members` are fixed at creation: no action changes either (the writes are `createProject`, `setRepository`, `setMcpServers`, `setChecks`, `setBrief`, `pw:408-520`) **[absence]**. Only `createProject` writes `members`, from its `members` input, and the owner is always included (`pc:106-113`).
- The projects' key patterns and flow names are public: `projects/*`, `project-files/**`, `workstreams/...`, the flow `projects` (`PROJECTS_FLOW`), view names `checkRepository` and `projectSetup`, the connector-keys path `/api/flows/mcp-credentials` (`wf/projects/project-keys.ts:5-35`) **[code]**.

### 7.2 `createProject` fields and defaults

Input (strict) (`pw:64-92`) **[code]**:

| Field | Meaning |
| --- | --- |
| `id` | required; one path segment; never `unassigned`; no `/` or `\`; not `.` or `..` (`pc:297-306`) |
| `title` | required |
| `brief` | what the project is for; stored as `null` when omitted |
| `visibility` | `shared` (default) or `private` |
| `members` | who besides the creator may open workstreams. The creator is always included. A private project may name nobody else (`private-has-members`) |
| `repository` | a git remote; omitted or `null`: no repository. Not a bare path, not starting with `-`, no credential in it |
| `mcpServers` | names the host offers; omitted: none |
| `checks` | commands that check the code; omitted: none |

Output `{ project, visibility, created }`. `created: false` when the same owner re-sends an id it already holds; the row is returned unchanged, and the host's repository check is not asked again (`pw:97-105`, `pw:303-322`). The owner is the session's user, recorded as `ownerUserId` (`pc:101-103`). The id of a shared project is first-come: another owner's row holds it (`project-id-held`). Row defaults: `status: "active"`, `brief: null`, `repository: null`, `mcpServers: []`, `checks: []`; a row stored before a field existed reads as its default (`pc:96-148`). A browser reads every field of the row (`pc:150-168`).

Visible where: a shared project, to everyone in the organization; a private project, to its owner. `listProjects` returns the projects the caller is a member of, shared first then private, each by id, with `visibility`, `id`, `title`, `repository`, `brief` (`pr:129-160`). `readProject({ project })` returns `{ project, visibility, workstreams, progress }`: every workstream's entry, oldest first, and the progress worked out from them: `workstreams` (count), `byStatus`, `objectives { met, total }`, `nextDue`, `stale` (an entry unchanged 7 days: `STALE_AFTER_MS`). Reports (the entries' content) are left out (`pr:1-23`, `pr:49-62`, `went:63`, `wf/browser.ts:97-102`) **[code]**. A shared project's entries are everyone's in the organization (`pr:15-17`).

The host registers the writes with `defineProjectBlocks(options)` on the flow `projects`: `createProject`, `setRepository`, `setMcpServers`, `setChecks`, `setBrief`, `readProject`, `listProjects`, `readProjectFiles` as actions; views `projectSetup` (always) and `checkRepository` (only when the host gives `checkRepository`); and the `connectorKeys` transport adapter. Options: `mcpServers` (names the host offers; absent: none, every name refused `unknown-mcp-server`), `checkRepository`, `projectCoordinator` (`pw:145-170`, `pw:515-580`). `setRepository`, `setMcpServers`, `setChecks`, `setBrief` are members only (`pw:482-499`).

### 7.3 `setBrief`

`setBrief({ project?, brief })`: members only; `brief: null` clears it; with no `project`, the project the conversation is linked to (`pw:184-192`, `pw:480-499`). The write rewrites the row from the state the store hands the updater, retried on conflict (`pw:478-488`). Output `{ project }`. The tools a worker calls (the coordinator catalog): `listProjects`, `createProject`, `setRepository`, `setBrief` (`wf/projects/project-tools.ts:117-187`), `setWorkProject` (`wf/projects/work-project.ts`), and for workstreams `openWorkstream`, `updateWorkstream`, `editWorkstream`, `listLeads` (`ww:262-290`). The `setRepository` tool stops for the user's approval before it writes (`wf/projects/project-tools.ts:94-110`) **[code]**.

### 7.4 `openWorkstream`

Input: `project?` (address; absent: the linked project), `id`, `title`, `lead`, `due?`, `objectives?` (strings) (`ww:~139-160`). Output `{ ..., opened }` (`ww:~165-170`). Preconditions, in order (`ww:405-455`) **[code]**:

1. The id is one path segment (`invalid-workstream-id`).
2. A shared project: the caller is one of its `members` (`not-a-member`); a private project is the owner's.
3. The lead is a worker on the **caller's own roster** (`no-such-worker`), whose flow can lead and that lists delegates (`cannot-lead`); `delegates: all` counts.
4. If the entry exists, its lead is the same (`lead-differs`).
5. With a project coordinator named, the owner has fewer than 25 open (not `done`) workstreams there (`too-many-workstreams`).
6. On the tool a worker calls, a fit check about the chosen lead, only when `leadFit` is set and the worker has a description: `lead-doesnt-fit` only when it answers that none fits. A check that cannot answer lets the open through. Opening again is not checked. The user's own `openWorkstream` action is not checked (`ww:36-48`).

Effects, in order: the entry is created (status `on-track`), then the lead's workstream session is created (the caller's, naming the lead as its worker and the workstream as its `workstreamId`), then the session id is written on the entry. Opening twice leaves one entry and one session: the entry is created with `create`, so of two opens at once one makes it, and the other waits briefly for the session to be named. An open that made the entry but not its session is finished by opening again (`ww:5-27`, `ww:469-520`). With a project coordinator, each open workstream is one delegate record on the owner's coordinator for that project (`ww:28-41`, `pco:1-35`).

### 7.5 Workstream ownership

An entry is `workstreams/<project>/<~owner>/<id>`. The collection declares `ownerWrites` on the owner segment, so the engine refuses a create, update or delete from anyone but the user the key names, whichever flow writes, with nothing changed (`wcol:5-28`, `wcol:~85-100`) **[code]**. `writtenBy` is stamped from the session for display and never decides a write. The lead is chosen at open and never changes. Nothing deletes an entry; done is a status (`ww:62-70`). Workstreams are keyed per owner, so two users' `checkout` are two workstreams.

An entry's fields (`went:52-72`): `title`, `lead`, `sessionId` (`null` until the open names it), `status` (a label, trimmed, not empty, at most `WORKSTREAM_STATUS_MAX_LENGTH` characters; default `on-track`; `done` is the one label with a meaning: a done workstream stays listed, is never stale, and is never the next due date), `due` (`YYYY-MM-DD`), `objectives` (`{ text, met, metAt, metBy }`), `openedAt`, `updatedAt`, `writtenBy`; its latest report is the entry's content. `updateWorkstream` takes `project`, `owner?` (naming another owner is refused by the store), `id`, and the changes (`title?`, `status?`, `due?`, `objectives?`, `report?`) (`ww:~175-215`). The lead's tool writes only the workstream its session leads (read from the readonly `workstreamId`) and takes no title (`ww:50-60`, `ww:724`).

### 7.6 The project coordinator

One coordinator session per user per project, private to that user, at an id derived from the user, organization, flow and project (`inst:735-763`, `pco:1-6`). Its delegates are the user's open workstreams in the project: one record per workstream, the lead with the workstream's address as target, so two workstreams led by one worker are two delegates (`pco:7-26`). The list is seeded the first time it is read, then changes only when a workstream opens, is marked `done`, or moves back out of `done` (`pco:14-22`). Its `readProject` tool (put in the agent catalog and named in the coordinator's `tools:`) returns the project, every workstream's entry, `progress` (counts by status among them), and `yours: true` on the caller's own; shared means the organization's entries are read; it hands work only to its user's (`pco:36-38`, `pco:266-290`) **[code]**. A task naming another user's workstream is refused as an unknown assignee (`wt/project-coordinator.test.ts:578` **[test]**). With no workstream of the user's own it reads and answers without handing off (`pco:142` problem text: `this conversation is linked to no project, so it has no workstream to hand work to`).

The session is excluded from the ordinary worker-session list (`wf/workers/session-views.ts:~35-60,175-181`). A request for one on a project the caller cannot read is refused with a 404 (`inst:773-787`) **[code]**. `setProject` for a user's own conversation: `setWorkProject` checks the user is a member of the project (`keys:84-100`).

### 7.7 Project MCP servers

A project names MCP servers by bare name; the user supplies the key for each, once, at `mcp-credentials/<server>`. A project naming a server for which the user has set no key gives that run no access to it, and the run's session says so once, naming the server and why, never an address or a key. A key the user set for a server no project names is unused. The key is in the connection's headers only; a failed call's message has the address and key removed (`wf/projects/mcp-credentials.ts:1-30`, `wf/projects/project-mcp-capability.ts:1-48`) **[code]**. The keys route is `/api/flows/mcp-credentials`: `GET` reads which keys the caller has set, `POST` and `DELETE` on `<path>/<server>` set and clear one (`wf/projects/project-keys.ts:28-35`).

## 8. Inventory

One org-scoped collection, `inventory/workers/<id>`; one row per standard worker; a row says the worker was registered, not that it is working (`wf/inventory/collections.ts:1-14`) **[code]**, `inv` **[doc]**. `workforce-roster` declares it, and so does any flow carrying `inventoryWriterActions()` (`rf:132`, `wf/inventory/inventory-resource.ts`). The kit does not write it: the app calls `openInventory(...)` at boot **[absence]**.

Row fields (`wf/inventory/collections.ts:61-124`; a browser reads all nine, `:139-141`):

| Field | Meaning |
| --- | --- |
| `id` | the worker's id; the join key with the files |
| `kind` | the flow it runs on |
| `door` | the one public action that takes a user's message (`respond`), or `null` when the flow has none |
| `doorTakesTask` | whether the door also takes a `taskId`. Send the key only when `true`. A row written before the field reads `false` |
| `name` | display name from the file's `name:`, or `null` |
| `teamName` | its team's display name, or `null` |
| `rules` | whether the worker keeps standing rules: its flow declares the `standingRules` action |
| `hired` | `false` for a worker the files declare. `null` on a row written before the field |
| `incarnation` | `null` on a declared worker's record |

`openInventory(workers, { run, workerWriter: { flowKind, sessionId? }, userId, orgId })` writes the rows and returns `{ workers, problems }`: `workers` is how many were written; failures go in `problems` rather than throwing (`wf/inventory/open-inventory.ts:106,177,225-296`) **[code]**. It throws, naming what to pass, when `orgId` is absent (`DEFAULT_ORG_ID` from `@flow-state-dev/core` is the explicit "no authentication" value), or when workers are given and `workerWriter` is not (`open-inventory.ts:226-248`). The write session is `inventory-binder` on the writer flow, created at first boot and reused (`open-inventory.ts:106`). Every write is an upsert keyed by the worker's id, so a second run writes the same rows (`wf/inventory/worker-writer.ts:33-37`). The writer action is `registerWorkersInInventory`, in `internal.actions` never `actions`; the `run` callback must reject on a failed run and must forward `source` (`worker-writer.ts:19-24`, `open-inventory.ts:81-89`, `inv` **[doc]**). The inventory's rows are the workers the files declare, from `inventoryWorkers(installation)`; a user's own workers are not listed (`reg:148-161`).

A browser reads it by scope, or through a session by pattern `inventory/workers/*`. Page size defaults to 50, `limit` 1 to 200 (`packages/engine/src/routes/resource-routes.ts:470-471,539-541`), a bad ref is a 404 `ClientHttpError`. Another organization's rows are never returned (`wf/inventory/collections.ts:30-36`, `wt/cross-org-collection-read.test.ts` **[test]**).

### 8.1 Shift Manager's reads of the inventory

Shift Manager reads the org's `inventory/workers/*` collection by org scope, with no session (`sm/lib/reads.ts:433-460`) **[code]**. With no inventory read, or none holding a worker, these screens show a failure in place of their content: TEAMS (`sm/surfaces/Sidebar.tsx:552`), the Shift Coordinator view (`sm/surfaces/ShiftCoordinator.tsx:238-243`), Inbox's asks (`sm/surfaces/Inbox.tsx:507-508`) and Roster (`sm/surfaces/Roster.tsx:165-168`). The failure reads `No inventory to read: none of this Lab's flows declares the organization's worker inventory (inventory/workers/*) with a worker in it. Either the Lab booted without opening its inventory, or these pages are an older build than the Lab and look for keys it no longer uses: rebuild them (pnpm --filter @flow-state-dev/shift-manager build) and reload.` (`sm/lib/reads.ts:453-459`, `sm/lib/directory.tsx:22-25`), or, for asks, `Asks are read from worker sessions, and the worker inventory did not load. <reason>` (`sm/lib/reads.ts:566`). Roster shows its failure only when there are also no workers; it still lists the user's own roster workers (`sm/surfaces/Roster.tsx:165-168`, `sm/lib/directory.tsx:15-45`). Projects load on their own (`packages/shift-manager/test/reads.test.ts:289-309` **[test]**).

Screens re-read on another session's change, and poll every 30 seconds where the Lab cannot push (`sm/lib/snapshot-subscribe.ts:30`, `sm/lib/inbox.ts:38`, `sm/lib/lab-data.tsx:16-22`). An "as of" summary is a read, not a live value (`sm/lib/lab-data.tsx:16-22`).

The Shift Coordinator is found by name: a worker whose id, after the first `.`, is exactly `shift-coordinator`, an org worker (`shift-coordinator`) or a team's (`ops.shift-coordinator`). One match is it. No match shows `This Lab declares no shift coordinator` and `Shift Manager talks to the worker named shift-coordinator. Declare one on the coordinator flow at org/workers/shift-coordinator/.` Two or more matches name no worker: the screen lists the ids (`sm/lib/shift.ts:157-179`, `sm/gaps.ts:72-78`, `sm/surfaces/ShiftCoordinator.tsx:247-259`) **[code]**. The conversation that opens is the user's one conversation with that worker, a session at an address derived from user, organization, flow and worker (`ensureWorkerSession`, `cl:182-200`, `wf/workers/derive-session-id.ts`); it appears once the session list holds it, and the user's first line opens it (`sm/surfaces/ShiftCoordinator.tsx:~376-400`) **[code]**.

## 9. Usage

A record per user, per worker, per UTC day. Every worker flow built on `installation.session()` with `installation.resources` records usage; a flow of one's own needs those two lines (`wu:1-30`, `wud` "What gets recorded" **[doc]**). When a request ends, however it ends, what it spent is added to the record for the session's worker and the day it ended on (`wu:197-215`). It is not a quota: nothing limits what a worker may spend (`wud` **[doc]**).

Read it through the view `workerUsage` on `workforce-roster`, with no session. In a browser: `workerUsageView` from `@flow-state-dev/workforce/browser`, for `client.view(workerUsageView, { days })` or `useView` (`wf/workers/worker-usage-ref.ts`, `wf/browser.ts:28`). Input `{ days?: number }`: an integer from 1 to 90, default 7 (`WORKER_USAGE_MAX_DAYS`, `WORKER_USAGE_DEFAULT_DAYS`, `wu:116-120`, `wu:300-302`). The period is today and the days before it, in UTC, so `days: 1` is today since midnight UTC (`wu:240-243`, `wu:268-269`). It takes no user: it answers for whoever calls it (`wu:9-12`, `wu:279-287`) **[code]**.

Output `{ workers: [...] }`: one row per worker that spent anything in the period, ordered by worker id (`wu:283-289`).

| Field | What it holds | Cite |
| --- | --- | --- |
| `worker` | the worker's id | `wu:104-106` |
| `gone` | `true` when the worker is no longer on the reader's roster; its records are kept | `wu:106-107`, `wu:259-262` |
| `tokens` | `{ input, output }` summed over every source | `wu:109`, `wu:256-258` |
| `costUsd` | sum of the sources that have one; `null` when none does | `wu:111`, `wu:259-260` |
| `bySource` | one entry per source, ordered by source then billing | `wu:112-113`, `wu:253-255` |

Each `bySource` entry (`wu:84-97`): `source` (a model id, or a harness name such as `claude-code`, `codex`, `cursor`), `kind` (`model` or `harness`), `billing` (for a harness `api-key`, `subscription` or `null` when it could not tell; always `null` for a model), `inputTokens`, `outputTokens`, `costUsd`, `runs`, `unreported`. `runs` is, for a harness, how many runs, and for a model how many request endings called it (a request that pauses and resumes counts once for each ending). `unreported` counts harness runs that ended without reporting any tokens.

`costUsd` is a number only for a harness run on an `api-key` whose harness reported a cost; every other source carries `null`, which a screen shows as "not reported", never `$0` (`wu:40-41`, `wu:92-93`, `wud` "Cost appears only where a harness reported one" **[doc]**). A harness run that ended before sending any usage counts once in `runs` and once in `unreported` and adds no tokens (`wu:42-43`).

Writes add atomically, so two requests ending at once for one worker and day both land. A record that fails to write is logged, not failed (`wu:166-190`, `wu:196-215`). A flow that declares `installation.session()` but not `installation.resources` has nowhere to write: in development a request that spent tokens fails, naming the collection; in production the request goes on and a warning is logged (`wu:140-146`, `wu:197-212`). A task's spend is counted from the same figures, per task (`wud` **[doc]**). The record key is `<YYYY-MM-DD>/<worker>`; the collection is `worker-usage/**` (`wu:62-66`, `wu:96-115`).

## 10. Standing rules

A standing rule is one line a user asked a worker to follow in every later conversation with them (`sr/rules-capability.ts:88-95`).

- **Tools**, model-facing, names pinned: `rules/read` (no input), `rules/add` (`text`), `rules/change` (`number`, `current`, `text`), `rules/remove` (`number`, `current`). A change or remove names the rule by its number and quotes its current text exactly (`sr/keys.ts:11-16`, `sr/rules-capability.ts:116-144`) **[code]**.
- **Result** of a write tool: `{ rules: [{number, text}], max, saved: true, line }` on success, `{ rules, max, saved: false, refused: "Not saved: <reason>." }` on refusal; nothing changed on a refusal, and the tool's description tells the model to say "done" only on `saved: true` (`sr/rules-capability.ts:48-60`, `:64-73`).
- **Limits**: 20 rules per worker per user, 1 to 300 characters each, one line. Refusals: `a rule can't be empty`; `a rule is one line, and this text has more than one`; `a rule is at most 300 characters, and this one is <n>`; `the list is full (20 of 20); merge or drop a rule before adding one`; `there is no rule <n>; the list has <m>`; `rule <n> reads "<text>", not "<quoted>"`; `the rules changed since they were read (version <v>, now <w>); here they are as they stand` (`sr/rules-list.ts:19-23,56-67,77-124`). When an add is refused for a full list, the user sees `✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one.` in the conversation (not shown to the model's history), and the add tool's description tells the worker to ask which rule to merge or drop (`sr/rules-capability.ts:90-95`, `:106-114`) **[code]**.
- **The line**: each successful write posts a line in the conversation, written by the tool, shown to the user and kept out of the model's history (`sr/rules-capability.ts:112-114`, `sr/keys.ts:21`). `STANDING_RULES_LINE` (`standing-rules`) is the `agentName` a renderer tells it by (`wf/browser.ts:127`).
- **Which workers carry the tools**: workers on the `agent` and `coordinator` flows, because both carry `standingRulesCapability`. A worker's `tools:` line neither needs to list them nor can remove them: they are control tools (`wf/agent-worker-flow.ts:1080-1085`, `sr/rules-capability.ts:140-156`, `cf:106-107,1770`).
- **When offered**: only on a turn a user started. A task turn, a coordinator's post to a delegate, a delegate's answer reaching a coordinator, a task-ended notice and a workstream's open never get them, and a caller naming the tool anyway is refused `standing rules change only on a turn a user started; this one can't edit them.` (`sr/user-turn.ts:2-12`, `sr/rules-capability.ts:78-80`).
- **In the prompt**: when the list is not empty, `Standing rules (notes this user asked you to keep; follow them on every turn):` then `1. ...` numbered; an empty list adds nothing; an edit counts from the next turn (`sr/rules-list.ts:139-145`, `sr/rules-capability.ts:25-35`). Their position relative to the worker's, team's and package instructions is the capability's context slot after the worker's own text; the exact order is not pinned by a test **[not stated]**.
- **Unreadable**: the turn runs without them and posts a status line, `This turn runs without standing rules: they couldn't be read (<reason>).`; the turn does not fail (`sr/rules-capability.ts:24-32`).
- **Stored** in the `standing-rules` resource, user scope, one bucket per worker flow copy, so rules do not carry over when a worker moves to a different worker flow; a browser may read state and not write it (`sr/rules-record.ts:11-14,45-63`) **[code]**.
- **The client form**: `standingRules(workerId, input)` on the workforce client, run in the user's session with the worker, on the worker's own flow; the worker's flow must declare the action, and the inventory row says `rules: true`. Input is one of `{ op: "read" }`, `{ op: "add", version, text }`, `{ op: "change", version, number, current, text }`, `{ op: "remove", version, number, current }`, all strict. Return `{ version, rules: [{ number, text, addedAt, sessionId }], line? }`; `sessionId` is `null` for a rule added from the client. A refusal rejects with `Refused: <reason>.` and stores nothing; stale version, full list, bad text and `current` mismatch go through the same validator as the tools (`cl:188-195`, `sr/rules-action.ts:22-76`, `wt/standing-rules.test.ts`) **[code]**.

## 11. Error reporter

All from `er/*` and `wf/index.ts:167`, the doc is `erd`.

- **What reaches it** (`erd` "What gets reported" **[doc]**): the engine's `errorCapture` sends one event per request that ends failed (`final: true`), after retries and rescues, so a failure a retry fixed is not reported (`er/reporter.ts:35-47`). An errored task on a conversation board is reported, including one that gave up without throwing; a cancelled task is not (`wf/conversation-board/task-settled.ts:239`, `:233-250`). A coordinator's own judgment turn that crashes and is rescued is sent too, because the request completes (`cf:1209-1214`, `er/rescued.ts`). A user can describe a problem to it, optionally naming a session, task or project; a named session is read only against the user who named it (`wt/error-reporter.test.ts:467` **[test]**). It never reports its own failures (`er/reports.ts:507-509`) and is never routed through a coordinator (`erd` "What it will not do" **[doc]**).
- **Grouping**: failures with the same flow, action, block path, error code and message (with ids, numbers and paths taken out, lower-cased) share one report; repeats raise its count; redelivering one occurrence counts it once (`er/fingerprint.ts:1-9,45-63`, `wt/error-reporter.test.ts:434`, `wt/error-reporter-fingerprint.test.ts`) **[code/test]**.
- **`createErrorReporter(options)`** (`er/reporter.ts:106-143`): `worker` (string, required: the `WORKER.md` id), `operator` (`{ userId, orgId }`, required), `tracker` (`{ project: "<visibility>/<id>", hint? }`, optional; without it reports are kept and previewed but never filed), `preview` (`autoFile` and `autoFileAfterMs`), `limits`, `filter`, `secrets`, `links`, `inboxLink` (optional; a function from a report's session to the link that opens its Inbox item; absent, the reporter says where a report waits with no link), `log` (default `console.warn`). **`defineErrorReporterFlow(options)`**: `reporter`, `installation`, `harness` (a function from feeds to a harness block) required; `cwd` (default `process.cwd()`), `mcpTools` (the project's MCP tools, through which a report files), `agent` (the conversation turn's options) optional (`er/flow.ts:79-92`). **`defineErrorReporterIntakeFlow({ reporter })`** takes only `reporter` (`er/flow.ts:842-846`). The host goes to `reporter.bind(host)`, not to any of the three; `errorCapture: reporter.capture` goes in `createFlowState` (`er/reporter.ts:12-24`).
- **Options table** (defaults) (`er/reports.ts:204-221`, `er/reporter.ts:112-124`): `preview.autoFile` none (error codes, or sources `request`, `task`, `manual`, `storm`, that file without a preview); `preview.autoFileAfterMs` never; `limits.newPerWindow` 5 (new reports per window, the rest go into one storm report); `limits.windowMs` 1 hour; `limits.commentEveryMs` 1 hour; `limits.dismissForMs` 24 hours; `filter` all; `secrets` none (beside the environment's keys and the operator's MCP keys); `links` none.
- **Preview needs durable execution**: the preview suspends the run, so the host needs durable execution, which is on by default over a persisting store or with `durable: true` (`packages/engine/src/flowstate/types.ts:352-359`, `erd` "Turning it on" **[doc]**).
- **Lifecycle**: gather (a dossier by code), draft (a harness reads the code; the drafting run gets no tracker tools, `er/flow.ts:323`), the operator's answer, file. Secrets are redacted before anything is stored or shown (`er/redact.ts`, `wt/error-reporter.test.ts:401,443,456`). Statuses: `owed`, `drafting`, `previewing`, `filing`, `filed`, `dismissed`, `closed` (`er/reports.ts:106`). Answers: File, File with instructions, Don't file (`decision: "file" | "dont-file"`, optional `instructions`, `er/flow.ts:107-112`). A filing that fails stays approved and is retried, across a restart too (`er/flow.ts:539-556`, `:603-610`).
- **Dedup limits**: a repeat of a filed report adds one counted comment at most once per comment interval (default 1 hour from filing or the last comment); if that comment run finds the issue `completed` or `canceled`, the report is marked `closed`, and the next failure with that fingerprint starts a new report linking the old issue (`er/flow.ts:690-729`, `er/reports.ts:596-602`, `wt/error-reporter.test.ts:409`). A reopened issue is not detected. More than `newPerWindow` new reports in a window go into one storm report. A dismissed report only counts repeats for `dismissForMs` (1 day) (`er/reports.ts:204-221`, `wt/error-reporter.test.ts:371,382`). `wt/error-reporter.test.ts:609-644` pins status history kept; records are deleted past 90 days (`:670`).

## 12. Panels and read surfaces

- **The react entry**, `@flow-state-dev/workforce/react`: `Roster`, `WorkerDetail`, `BoardColumns`, `BoardList`, with `groupIntoColumns` and `BOARD_STATUS_COLUMNS`. Read-only; no CSS framework (`wf/react/index.ts:1-35`, `wf/react/components/chrome.ts`). React is an optional peer. `BOARD_STATUS_COLUMNS` is `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`, in that order; a status this version does not know becomes a column after them (`wf/react/components/BoardColumns.ts:48-57,136-145`) **[code]**.
- **Panel paging**: `limit` is the page size requested each time, not a cap; the read follows `nextCursor` to the end, up to 1,000 pages, and a server that repeats a cursor or keeps returning one is an error line with Retry, never the rows read so far (`wf/react/components/reads.ts:125-145`, `packages/client/src/resource-client/read-every-page.ts:16,39-67`). The route's default page is 50 and its largest 200 (`packages/engine/src/routes/resource-routes.ts:470-471`).
- **Live**: `live` re-reads on another session's change; the panel's `client` is read-only (`wf/react/components/reads.ts:53-100,125-145`, `wt/panels-live-scope.test.ts`).
- **Empty and failed reads**: an empty `BoardColumns` board reads `This board has no rows. Boards are wired to a worker explicitly, so the likely reason is that nothing drains this one yet.`; an empty `BoardList` reads `This board has no tasks.`; an empty `Roster` reads `No workers have been hired in this organization yet.`; a failed read shows the error with Retry (`wf/react/components/BoardColumns.ts:228-231`, `BoardList.ts:157`, `Roster.ts:219`, `chrome.ts:60-70`). `slots.empty` replaces the text.
- **A card's row** is the conversation board's client row: `id`, `title`, `goal`, `context`, `attachments`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `feedback`, `holds`, `steers`, `spend`, `createdAt`, `updatedAt`, `startedAt`, and more through the end of the list; `input`, `output`, `metadata` and the write log are never sent to a browser (`wf/conversation-board/ledger.ts:73-110`, `:148`). `slots.card` replaces a card's body (`wf/react/components/cards.ts`, `BoardColumns.ts:68-79`).
- **Views the kit serves** (`rf:162-206`, `keys:149-177`): on `workforce-roster`: `roster`, `workerUsage`, `workerSessions`, `sessionTurns`, `workerMessages`, `inbox`, `workstreamReport`, and `routines` (when the roster flow is built with the routine view, which `hireWorkforce` always does, `reg:129-143`). Browser handles: `rosterView`, `workerUsageView`, `workerSessionsViewRef`, `sessionTurnsViewRef`, `workerMessagesViewRef`, `inboxViewRef`, `workstreamReportView`, `routinesView` (`wf/browser.ts:28-53`, `:100-112`). On the `projects` flow (the host's): `checkRepository` (only when the host supplies `checkRepository`) and `projectSetup` (always) (`pw:236-244`, `wf/browser.ts:101-103`). On the coordinator flow and any flow built with `defineSessionBoard`: `listTasks_tasks` (and `delegates`). `listTasks_tasks` returns the conversation board plus the `plan` board (the steps a worker files for itself); a session with no plan steps has an empty `plan` board (`wf/conversation-board/session-board.ts:20-23`, `wf/conversation-board/plan.ts`).
- **Roster available before any session is opened**: the roster and usage views are read at user scope with no session (`rv:3-13`, `wu:117-120`).
- **The conversation board's actions**: `<tool>_tasks` names, e.g. `createTask_tasks`; `no_delegation_board` while the session files nothing; a read of the tasks collection from a browser works only when the flow declares it, and answers 404 otherwise (`wf/conversation-board/session-board.ts:10-14,96`; `wt/conversation-board-browser-read.test.ts` **[test]**). `sessionIdOfFiling(filingSessionId: string): string` returns everything before the last `~`, or the input when it has none; exported from the package and its browser entry (`wf/conversation-board/filing-session.ts:112-115`, `wf/index.ts:69`, `wf/browser.ts:66`).
- **Round-trip with the browser entry**: the package root pulls `node:async_hooks` through the task board, so a client component imports from `@flow-state-dev/workforce/browser` (`wf/browser.ts:1-16`, `wt/browser-subpath-safe.test.ts`).

## 13. Agent options the kit forwards, and conversation memory

- `agent.model`: the default model for workers that name none. Resolution: a worker's own `model:` setting, else `agent.model`, else `intent/chat` (a provider-neutral intent the app's resolver turns into a concrete model) (`wf/agent-worker-flow.ts:134`, `:276`, `:468`) **[code]**.
- `agent.maxSteps`: model steps per turn; default 50; the last step offers no tools (`wf/agent-worker-flow.ts:141`, `:386-390`, `:1240`).
- `agent.uses`: capabilities every worker on the flow carries; a worker picks presets from them with `capabilities:` in its file; tool-carrying presets are fenced by a worker's `tools:` line, control tools are not (`wf/agent-worker-flow.ts:~300-340`).
- `agent.afterAnswer`: a block run after the worker answers, as a side chain; it cannot change the answer. It receives the answer text as a string. Long-term memory belongs to the user and is shared across that user's workers on `agent`; a worker carrying memory records nothing of its own without `afterAnswer`, so it stays empty (`wf/agent-worker-flow.ts:~340-385`, `:~350-370`, `wod` "Hiring the roster" **[doc]**).
- `agent.isolateUserState`: keys the flow's user-scoped storage by the flow copy's id; default false; on an installation every worker runs on one `agent` copy, so its workers still share one cell per user (`wf/agent-worker-flow.ts:~345-360`).
- **Conversation window (workers on `agent`, and the coordinator's own turn)**: a talk-to worker reads its last 50 turns word for word (`packages/engine/src/context/createExecutionContext.ts:775`). As the conversation nears 50 turns, up to a quarter of the window (about 12 turns) at a time is folded into a running summary (trigger: oldest unfolded turn reaches the oldest quarter), and the summary stands in for the folded turns and is kept in the conversation from then on (`packages/core/src/utility/history-summary.ts:11-18`, `wf/worker-default-layer.ts:22-28`, `wf/agent-worker-flow.ts:~1131-1140`) **[code]**. A worker can turn the summary off with `defaults: { historySummary: false }` (`wf/worker-default-layer.ts:60-72`).

## 14. Skills, the GitHub token, other options

- **A worker's skill set**: a missing level is not an error. Each worker is read on its own, so two teams can each have a `review` skill. The same name at two folder levels reaching one worker is refused: `Skill "<name>" reaches worker "<worker>" from <n> levels — <path> and <path>. Remove one: there is no precedence rule.`, and every copy is left out of that worker's set (`wf/manifest.ts:396-397`, `wf/loader/read-worker-skills.ts:64`). The same name in `defineAgentWorkerFlow({ skills })` and in a worker's folders is refused separately, at the worker's config check: `holds skill "<name>" from its own folders, and defineAgentWorkerFlow({ skills }) carries a skill of the same name. They fill one catalog and there is no precedence rule — rename one, or drop one.` (`wf/agent-worker-flow.ts:515-531`). A bad skill folder does not cost the worker its other skills (`wf/loader/read-workforce.ts:145-180`, `wt/read-worker-skills.test.ts`). A copy a user makes keeps its worker's skill names; a fork's names resolve against the installation's skills on each turn, so a skill the installation no longer registers is refused (`wf/workers/installation.ts:483-490,555-575`).
- **Conversation board facts a user can observe** (carried from the Conversation-board rows): a task chain is at most 5 boards deep, and a top task has at most 100 tasks under it by default (`wf/conversation-board/chain.ts:37-43`, `kit:99-100`); a task gets 2 attempts, a task filed with its result to the conversation gets 1 (`board.ts:179-184,1368`); a plan step gets `STEP_ATTEMPTS` (`board.ts:1662`).
- **`operatorGitHubToken()`**: returns `GITHUB_TOKEN` (trimmed) when set and non-empty; else what `gh auth token` answers (read once at start, never from a request, 5-second-class timeout `GH_TIMEOUT_MS`); else `undefined`. Node-only: the server entry exports it (`wf/service-flows/github/operator.ts:4-9,16-34`) **[code]**. `operatorGitHub({ operator, token, apiUrl? })` serves that one user; with no token every GitHub routine is refused (`:36-44`).
- **`hireWorkforce` is called by the kit only**; it and `createWorkerInstallation` are not public exports (`wf/workers/index.ts:50-61`), so there is no app-level path to document.

## Lookups the page answers

1. **What happens when a user edits a standard worker?** Section 3.2.
2. **Which worker may hand work to which?** Section 5.5.

## Row ledger: every row moved to R-25

Each row from `grep -rhE --include=*.record.md -e '→ R-25( \(corrected by pass 5\))?$'`. "Carried" = in this sheet, in the section named. "Carried, refined" = true, with a correction shown. "Dropped" = not carried, reason given.

| Row (short name) | Disposition | Where |
| --- | --- | --- |
| Task actions (cancel, steer, release, retry) and five project board groups | **Dropped**: no code in `packages/workforce/src` defines "five project board groups"; the task actions are the task board's (`R-23`, `task-board.facts.md`) and the Shift Manager's groups are that product's screens. Not verifiable from the workforce surface | n/a |
| Conversation length: 50-turn window, fold, summary kept; coding workers have none | Carried (corrected by pass 5: the summary is kept from then on) | 13 |
| Roster states (standard, edited, forked, hired) | Carried | 3.1, 3.2 |
| Hiring at runtime: what a hire takes, no restart; coding worker settings `flow: coder`, `harness:` | Carried (hire). **Dropped**: coding worker settings `flow: coder` and `harness:` naming a filled slot value; those belong to the Harness runs page (R-27), and `showSettings` is the roster-side fact carried in 2.3 | 1.5, 2.3 |
| Inventory failures in Shift Manager (corrected by pass 5) | Carried | 8.1 |
| Screen refresh: re-read, 30 s poll, "as of" | Carried | 8.1 |
| `shift-coordinator` discovery (found by name; none; duplicates) | Carried, refined: matched on the id after the first `.`, not "by name" in a file field | 8.1 |
| `hire`/`fire` held only when the worker's `tools:` names them; lands on the calling user's roster; fire has no approval wait | **Dropped, not carried**: the model-facing `hire`/`fire` tools are not exported by `packages/workforce/src` (`wf/index.ts` exports the actions, not tools); what is carried is the action form. Claim not verifiable from the surface | 1.5 |
| Which conversation opens with the Shift Coordinator (corrected by pass 5) | Carried | 8.1 |
| Project MCP servers: names, user's key, no key no access, unnamed unused | Carried | 7.7 |
| Project refusals: no project at filing; project unreachable ends errored, not retried (corrected by pass 5) | Carried, refined: errored on a conversation's board, cancelled on a fixed board | 4.3, 4.4 |
| `messages.budget`, `messages.perTurn` | Carried | 1.3 |
| Error reporter triggers (corrected by pass 5) | Carried | 11 |
| Reporter intake: what a user can name; ownership check | Carried (ownership by test) | 11 |
| Reporter exclusions | Carried | 11 |
| `createErrorReporter` options (corrected by pass 5) | Carried, refined: also an `inboxLink` option | 11 |
| Preview requirement (durable) | Carried | 11 |
| Report lifecycle | Carried | 11 |
| Operator answers and preview options | Carried | 11 |
| Filing failure and retry; no `tracker`; the shipped prompt's tracker | Carried, except "the shipped filing prompt's tracker": **dropped**, prompt wording is not observable behaviour | 11 |
| Deduplication limits (corrected by pass 5) | Carried | 11 |
| Report grouping key | Carried, refined: flow, action, block path, code and message, not only block | 11 |
| Error reporter options table | Carried | 11 |
| Model resolution order; 50 steps; 50-turn window | Carried | 13 |
| `agent.uses`, `agent.afterAnswer`, memory ownership | Carried | 13 |
| Hire options, return shape, `watchRoster` timing | Carried; **dropped**: "within about a second" (no code or test pins it; only the 3 s fallback and push) | 1.5 |
| Roster operations: fork, edit, fire, reset | Carried | 3.1 to 3.3 |
| Roster refusals; nothing written | Carried | 4.1 |
| Stored parts table: `Where` column; per-organization scoping | Carried | Stored parts |
| Discovery output | Carried | 6 |
| Discovery coverage: not by the kit; file-declared only | Carried | 6 |
| Views the kit serves (item 13, corrected by pass 5) | Carried | 12 |
| Rule-change line | Carried | 10 |
| Standing-rule tools | Carried | 10 |
| Standing-rule refusals (quoted text mismatch) | Carried | 10 |
| Which workers carry the rule tools | Carried | 10 |
| When rule tools are offered | Carried | 10 |
| Where rules enter the prompt | Carried, refined: heading and numbering and empty-list rule verified; "after worker, team and package instructions" is not pinned by a test, so the sheet does not state the order | 10 |
| Rules unreadable | Carried | 10 |
| Standing-rule limits (corrected by pass 5) | Carried | 10 |
| `standingRules(workerId, input)` signature, `rules: true`, four shapes | Carried | 10 |
| `standingRules` return shape | Carried | 10 |
| `standingRules` write refusals | Carried | 10 |
| Where rules are stored | Carried | 10, Stored parts |
| Rules do not carry over to another worker flow | Carried | 10 |
| Kit option `directory`, `fsdev gen --root` | Carried (the `--root` flag: `packages/fsdev/src/commands/gen.ts:195`) | 1.1 |
| Project address and visibility rules | Carried | 7.1 |
| `createProject` fields and defaults | Carried | 7.2 |
| `openWorkstream` preconditions and effects | Carried | 7.4 |
| Workstream ownership rules | Carried | 7.5 |
| `readProject` output; project-coordinator handoff | Carried | 7.2, 7.6 |
| Project coordinator session listing and refusal | Carried | 7.6 |
| `setBrief` action | Carried | 7.3 |
| When a worker gets the task tools | Carried | 5.5, 5.6 |
| Session delegate list; `addDelegate`/`removeDelegate` | Carried | 5.4 |
| Kit option `taskChainLimit` | Carried | 1.1 |
| Roster entries (standard, edited, forked, hired; no status) | Carried | 3.1 |
| `delegateAnswerOf(item)` | Carried as an export: recognises a delegate's answer item, recorded under the delegate's worker id (`wf/index.ts:91-96`, `wf/browser.ts:134`). Signature detail is in the type, not repeated here | 12 (exports) |
| Views the kit serves, which flow each lives on (corrected by pass 5) | Carried | 12 |
| `coordinator.routeModel` required; startup refusal naming the flow | Carried, refined: required by the type only; the "install sentence about Node-only import" is **dropped** (the root export is not the kit; see `wf/index.ts:1-15`) | 4.2, 5.1 |
| Refusals table: ineligible delegate; built-in agent and coordinators eligible | Carried | 5.4, 5.5 |
| Routing modes: best-fit row (corrected by pass 5) | Carried | 5.2 |
| Model calls per mode; round-robin order; everyone | Carried | 5.2 |
| Fallback per mode | Carried | 5.2 |
| Coordinator tools table; unknown assignee | Carried | 5.5, 5.6 |
| Coordinator surface table | Carried | 5.7 |
| Roster ownership row (corrected by pass 5) | Carried | 5.4 |
| `addDelegate`/`removeDelegate` actions (corrected by pass 5) | Carried | 5.4 |
| Delegate eligibility for custom flows | Carried | 5.5 |
| Kit options table: `generated.workerFlows`, `coordinator.agent`, custom coordinator replaces | Carried | 1.1, 1.2 |
| Refusals row: task for a worker not in `delegates` | Carried | 5.5 |
| Limits rows: a worker acts only for its owner | Carried | 3.4 |
| Workforce panels: import path, read-only, `groupIntoColumns`, `BOARD_STATUS_COLUMNS` | Carried | 12 |
| Board card row shape; `slots.card` | Carried | 12 |
| Panel paging | Carried | 12 |
| Panel `live` re-read; read-only `client` | Carried | 12 |
| Panel empty and failed states (corrected by pass 5) | Carried | 12 |
| Worker skill set assembly (corrected by pass 5) | Carried; **dropped**: "a later edit to a skill file does not reach a copy already made". A fork copies instructions and settings (test), but its skill names resolve against the installation's skills each turn, so the claim is not true as stated and no test pins it | 14 |
| Worker id use | Carried | 3.5 |
| Session create with no `workerId`, unknown id, id on another flow | Carried | 4.3 |
| Hired worker id rules | Carried | 3.1 |
| Delegation rules: `all`, 25 cap, no self-routing, duplicate refusal, standard-only | Carried, refined: `all` includes the worker itself; only the coordinator skips itself | 5.5 |
| Coordinator routing: when answers are delivered; round closes; cost bound | Carried; cost bound marked derived | 5.3 |
| Startup refusals for the workforce kit; `readWorkforceFolder` throws | Carried | 4.2 |
| Hire refusals: all together, prefixed, all or nothing, per-cause messages | Carried | 4.2 |
| Roster row, edited: effect next turn, same id, file untouched; `fsdev dev` restart | Carried; the `fsdev dev` restart is routed to the CLI page | 3.2 |
| Discovery output: three domains, default, narrowing only, misspelt refused | Carried | 6 |
| Conversation board: action names, `listTasks_tasks`, browser read, 404, topic format, `sessionIdOfFiling` | Carried, except "topic format": **dropped**, not located in a stable exported surface | 12 |
| Fields a browser receives from the tasks ledger; page size 50, limit 200, `readEveryCollectionPage` | Carried | 12 |
| Workforce kit and hire option `messages`, `DEFAULT_*` exports | Carried | 1.3 |
| Worker flows: `agent`, coordinator, app-registered; one shared copy | Carried | 2 |
| Roster states; fork copies configuration | Carried | 3.1 |
| Hire and fire: return value; what fire removes; standard worker leaves when its folder is deleted | Carried; "standard worker leaves when its folder is deleted": the files are read each start, so it is gone from the roster and turns on it end as fired (`inst:857-859`, `inst:~713`) | 3.3 |
| Coordinator routing modes: four modes (corrected by pass 5) | Carried | 5.2 |
| Worker flow roles | Carried | 2.2 |
| Projects and workstreams: owner write, org read; lead's session; one coordinator per user per project | Carried | 7.5, 7.6 |
| Conversation boards: delegate-only pieces, `keptOpenBy`, completion rule, `cascadeFiled`, depth 5, limit 100 | Carried only for depth 5 and limit 100 (14); the other pieces (`keptOpenBy`, completion rule, `cascadeFiled`) are **dropped** here: they are on the Task board and Delegating work pages | 14 |
| `operatorGitHubToken()` row | Carried | 14 |
| Workforce read `listTasks_tasks` | Carried | 12 |

## Contradictions found

1. **`worker-usage.md` documents `workerUsageAction(installation)` and `WORKER_USAGE_ACTION`, which do not exist.** Neither name is exported by `packages/workforce/src` (`grep` finds none). Usage is the `workerUsage` view on `workforce-roster`, read with `workerUsageView` (`wf/workers/index.ts:73`, `wf/browser.ts:28`). The sheet follows the code. The doc page and its example need replacing at cutover.
2. **`inventory.md` lists 7 fields per row and says "and no others"; the collection exposes 9** (also `name` and `teamName`, `wf/inventory/collections.ts:139-141`). The sheet follows the code.
3. **`manifest-sources.ts:48-50` says a hired worker's roster row is the declared half "so Discover can see it"; the code reads only the file-declared workers** (`wf/manifest-sources.ts:157-180`: `declared = files`, a row with no file is skipped). Discovery lists file-declared workers only. The sheet follows the code; the comment is stale.
4. **`durable-hire.md` shows a roster entry with four fields** (`id`, `flow`, `standard`, `description`); the entry has nine (`rv:22-32`).
5. **`durable-hire.md` says "four actions: `hire`, `fork`, `edit` and `fire`"; the roster flow also has `reset`** (`reg:129-143`), and `edit` takes `settingsPatch`, which the doc does not mention.
6. **`workers-on-disk.md` "Hiring the roster" shows `hireWorkforce(installation)` and `flowRegistry.registerMany(flows)` as the setup**; an app on the kit does neither (`kit:272-281`), and neither function is a public export, so the page carries no low-level form.
7. **`coordinators.md` (via the earlier coordinator sheet, line 195-196 there) and the best-fit comment in `coordinator-flow.ts:36` say "Routing never picks the coordinator itself"; best fit does offer and pick the coordinator on a user's message when it has a description** (`cf:1020-1030`, `bf:11-14`). The first line is about delegate targets; a coordinator pick means its own judgment turn answers.

## Left out on purpose (no observable surface, or not Reference)

- Any rationale for a limit, how a claim is made atomic, the CAS retry of a project write, the claim gate, the order of internal dispatches.
- The shipped filing prompt's wording, the lead-fit evaluator's question text, best fit's `ROUTE_QUESTION` text.
- The conversation board's `keptOpenBy`, completion rule and `cascadeFiled` (the task board and delegating-work pages).
- Worker messaging (`sendMessage`, delivery, the ask-and-wait limits): R-26 holds it. Only `messages.budget` and `messages.perTurn` are here because the kit takes them.
- Harness runs, kit workspace options and run states: R-27.
- `WORKER.md` settings, ids and the "what makes a file unusable" cases: R-28.
- A pass 5 reader should check the lines marked `~` (approximate, read from a longer range): `hire:~650-760`, `ww:~139-215`, `wconf:~625-641`, `agent-worker-flow.ts:~300-385`, `sm/surfaces/ShiftCoordinator.tsx:~376-400`.
