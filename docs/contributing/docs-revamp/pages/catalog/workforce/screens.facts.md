# Facts for Workforce screens (K-12, catalog, kit template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: the existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example. No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read, and every surface named here is built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `ui` = `apps/docs/docs/workforce/ui.md` (the page this one replaces; line numbers are the file's own)
- `ov` = `apps/docs/docs/workforce/overview.md`
- `dw` = `apps/docs/docs/workforce/delegating-work.md`
- `wf` = `packages/workforce/src`
- `rc` = `packages/workforce/src/react/components`
- `wt` = `packages/workforce/test`
- `rv` = `wf/workers/roster-view.ts`
- `rr` = `wf/workers/roster-view-ref.ts`
- `uv` = `packages/react/src/hooks/useView.ts`
- `tl` = `packages/orchestration/src/inbox/client.ts` (`taskListViewRef`)
- `ks` = `apps/kitchen-sink/components/team-panel.tsx` (the one running example)
- `gm` = `goals/design-system/skins-reused-components-from-one-token-set/host/main.tsx`

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/ui-components` (or another Reference page); the page links, does not state it. **[verify]** not confirmed by running code in this pass; pass 5 must check before it reaches the page. **[cut]** history or mechanism; never on the page. **[checked]** read against code or a test, or run, in this pass. **[ran]** a throwaway test run against a real in-process engine in this pass (the test was deleted; its output is quoted).

## Flags against the page plan and the existing page (read first)

1. **The components are not where the existing page says.** `ui:16`, `ui:82`, `ui:135` and `ov:43` import `Roster`, `BoardColumns` and `BoardList` from `@flow-state-dev/react`. The root of that package exports none of them (`packages/react/src/index.ts:140-176` lists `FlowNavigator`, `useView`, `useSessionList` and nothing from workforce). They live on **`@flow-state-dev/workforce/react`**, and nowhere else: `wt/react-entry.test.ts:1-6`, `:22` (the entry's full export list: `BOARD_STATUS_COLUMNS`, `BoardColumns`, `BoardList`, `Roster`, `WorkerDetail`, `groupIntoColumns`), `:25-33` (React's package has no workforce subpath, no alias); `packages/workforce/package.json:37-40`. `gm:20-21` imports `FlowNavigator` from `@flow-state-dev/react` and the four panels from `@flow-state-dev/workforce/react`. An import from the old path fails to resolve. The code wins. **[checked]**
2. **`Roster` does not read the roster view, and it cannot draw a real roster from the collection the existing page tells you to declare.** The entry's own header says it reads "the roster flow's `roster` view by default" (`wf/react/index.ts:5-6`); the component reads a **collection**, key `roster` by default, with `listCollectionResources` (`rc/Roster.ts:182`, `:190-199`; `rc/reads.ts:150-180`). It reads no view. And the rows a real collection answers do not pass the component's own row check. **[ran]**: with `defineWorkerCollection()` as the roster flow's `workforceWorkers`, a hired worker reads back as
   `{"topic":"scribe","storageKey":"workforce/workers/scribe","clientData":{"flow":"fixture-worker","name":null,"description":null,"forkedFrom":null,"settings":{}}}`.
   The collection's client projection is `flow`, `name`, `description`, `forkedFrom`, `settings` (`wf/workers/worker-row.ts:93-100`); its doc says the instructions stay on the server (`wf/workers/worker-row.ts:71-75`). `Roster` keeps a row only if `clientData.workerId` and `.flow` are strings (`rc/Roster.ts:151-157`, filter at `:204-210`) and shows the rest as "N workers could not be loaded" (`rc/Roster.ts:211`, `:241-266`). The tests feed it `{ workerId, flow, instructions }` by hand (`wt/panels.test.ts:92-95`), never a row read from a real engine. So the existing page's snippet (`ui:64-75`, `defineWorkerCollection()` under `roster`) draws an empty list plus an unreadable count. `WorkerDetail` has the same hole: it reads instructions from the same projection, which carries none, and a row without `workerId` fails `isWorker` and shows "This worker's instructions could not be read." (`rc/WorkerDetail.ts:98-110`). **The page must not teach `Roster` or `WorkerDetail` over `defineWorkerCollection()` until the owner decides** (a bug in the component, or in the projection). Pass 5 must re-run the check. **[ran]** **[checked]**
3. **Which view lists a user's workers (question 1): `rosterView`.** It is a handle on the view `roster` of the flow `workforce-roster` (`rr:11-12`, `wf/workers/keys.ts:141-145`); it joins the user's own workers and the standard ones from the app's files, each listed once (`rv:15-24`, `rv:102-113`). Import it from `@flow-state-dev/workforce/browser` (`wf/browser.ts:30`; safe in a browser bundle, `wf/browser.ts:1-19`). `useView` comes from `@flow-state-dev/react` (`packages/react/src/index.ts:170`). **[page]** **[checked]**
4. **Scope is the user's, not the organization's.** `ui:213` says "The roster and the board columns are scoped to an organization", and `rc/Roster.ts:3-10` says the collection is "organization-scoped at the store". Worker records are stored at **user scope** (per organization): `wf/workers/worker-row.ts:68-69`, `wf/workers/keys.ts:10-15`. The conversation ledger is at the owner's user scope too: `wf/conversation-board/ledger.ts:3-8`, `:138`. Every read through a session returns the signed-in user's records, in the session's organization. The page says "the user's", not "the organization's". `dw:188` says the same: a read never returns another user's records. **[checked]**
5. **The navigator is the one component in `@flow-state-dev/react`; the workforce panels are three more plus one.** `FlowNavigator` browses flows, not a workforce (`packages/react/src/components/flow-navigator/FlowNavigator.ts:5`); `Roster`, `BoardColumns`, `BoardList` and `WorkerDetail` are the workforce entry's (flag 1). `ui:13` calls the navigator "most of it". **[checked]**
6. **No component draws "a worker is waiting".** A roster row carries a worker id and a flow, nothing else (`rc/Roster.ts:223-233`; `RosterEntry` has no status field, `wf/workers/client.ts:54-84`; the view's entry schema has none, `rv:34-44`). Where waiting does show is the table in section 4.4. Shift Manager's roster screen derives "waiting on you" from a snapshot of tasks and asks with its own code (`packages/shift-manager/src/surfaces/Roster.tsx:8-16`); that is an app, not a shipped component, and the page does not cite it. **[checked]**
7. **The Messages section of `ui` (`ui:157-159`) is not this page's.** "No component draws the messages your workers send each other" belongs to `messaging`. The page may say it in one clause with a link. **[ref]**
8. **The page plan's "Views → C-09" and "Component props → `reference/ui-components`".** The page states which view feeds which region and shows three snippets; the props tables, the CSS custom properties, the slot lists and the state tables are Reference rows (section 7). **[ref]**
9. **Kit template does not fit this page.** The screens are not a kit and not a slot. The workforce kit's `install` returns the flows (`wf/kit/workforce-kit.ts:171-183`); the kit's doc says it serves "one copy of each worker flow and the roster flow" (`wf/kit/workforce-kit.ts:1-10`), and the roster flow is where the roster, usage, routines and workstream-report views live (`wf/workers/roster-flow.ts:1-26`, `:67-76`). The kit's slots (`workerFlows`, `uses`, `flows`) name nothing to do with screens (`wf/kit/workforce-kit.ts:174-179`). So the template's "slots it opens" and "slots it fills" have nothing to hold; "views it serves" is the real section. The `slots` on each panel (`rowTrailing`, `empty`, `card`, `columnHeader`, `row`) are component props, not kit slots; do not call them slots without saying which type. **[checked]**
10. **Existing page defects the new page must not copy.**
    - `ui:64-75`: `defineFlow({ ..., actions: { /* ... */ } })` is a placeholder, and the roster declared under `roster` is flag 2's broken read.
    - `ui:84-93`: the props type is real, but the component takes a `getToken` the page never defines; the snippet is fine as a pattern and too long for a 900-word page.
    - `ui:132-143`: `client` is a free variable ("This example assumes a `client` built...").
    - `ui:117`: "a standard worker that can't run stops `hireWorkforce` at startup" restates the Workers page's rule; not this page's.
    **[checked]**
11. **A lab or starter is not a supported example.** `ks` is the one running example and is a reference app; labs are research software (`labs/README.md:3-7`). The kitchen-sink panel uses `watchRoster`, not a component or `useView` (`ks:13-14`, `:89-107`). **[checked]**

## 1. What you get

- A roster, a conversation's board and a board of every conversation, each as a view or a collection a browser reads, plus four components that draw some of them. **[page]**
- Four components on `@flow-state-dev/workforce/react`: `Roster`, `BoardColumns`, `BoardList`, `WorkerDetail` (`wf/react/index.ts:11-33`; `rc/index.ts:247-274`). One component on `@flow-state-dev/react`: `FlowNavigator` (`packages/react/src/index.ts:139-153`). One hook that reads a view: `useView` (`packages/react/src/index.ts:170`). **[page]** **[checked]**
- Five view handles a client reads from `@flow-state-dev/workforce/browser`: `rosterView`, `workerUsageView`, `routinesView`, `workstreamReportView` (all on the `workforce-roster` flow), and `checkRepositoryView` (on the projects flow). `wf/browser.ts:30-31`, `:81-83`; refs at `wf/workers/worker-usage-ref.ts:12`, `wf/routines/routines-view-ref.ts:25`, `wf/projects/workstream-report-view-ref.ts:37`, `wf/projects/check-repository-view-ref.ts:49`. The page names `rosterView`; the others are one row each on Reference. **[page for rosterView; ref for the rest]** **[checked]**
- The conversation board's task list is a **session view**, `listTasks_tasks`, on the coordinator flow and on any flow built with `defineSessionBoard`; its handle is `taskListViewRef(flow, "tasks")` from `@flow-state-dev/orchestration/inbox`. `wf/coordinator/coordinator-flow.ts:1790-1791`, `wf/conversation-board/session-board.ts:19-20`, `:271-272`, `tl:56-66`, `packages/orchestration/package.json:44-47`. The ledger's id is `tasks` (`wf/conversation-board/ledger.ts:61`). **[page]** **[checked]**
- A coordinator conversation's session is of the flow `coordinator` (`wf/coordinator/coordinator-keys.ts:12`, exported from `wf/browser.ts:75`). **[page]** **[checked]**

## 2. Install it

- Package: `@flow-state-dev/workforce`, `0.5.0` (`packages/workforce/package.json:3`). The install line is `pnpm add @flow-state-dev/workforce` (cut README copy `docs/contributing/docs-revamp/readmes/workforce.md:6`; the live README has none). **[reconcile]** at cutover. **[checked]**
- The components need React 18 or 19 and `@flow-state-dev/react`, both optional peers of the workforce package (`packages/workforce/package.json:120-131`). The package root imports no React; only `./react` does (`wt/react-entry.test.ts:35-40`). So a server-only app that imports the root pulls none of it in. **[page]** **[checked]**
- `@flow-state-dev/workforce/browser` is the entry a client component imports from. The package root is not safe to bundle for a browser (`wf/browser.ts:4-9`), and `wt/browser-subpath-safe.test.ts` fails on any Node built-in in that entry's graph (`wf/browser.ts:11-12`). **[page one sentence]**
- The views exist once the workforce kit is installed: the kit hires the roster flow with the roster view in it, and a coordinator conversation has its board view when the kit has a `coordinator` key. `wf/kit/workforce-kit.ts:1-10`, `:246-256`, `wf/workers/roster-flow.ts:67-76`, `wf/coordinator/coordinator-flow.ts:1790-1791`. Nothing is configured for the screens themselves. **[page]** **[checked]**
- `useView` needs a client: it reads the nearest `FlowProvider`'s, or takes one in `options.client`. `uv:54-56`, `uv:27-28`. **[page]**

## 3. Use it

### 3.1 The roster (`useView(rosterView)`)

- `useView(ref, input?, options?)` returns `{ value, stale }`. `value` is `undefined` until the first answer lands; `stale` is `true` while the last read failed and the live read tries again on its own. `uv:3-14`, `uv:31-37`. **[page]**
- The screen names no topic. Each answer carries the change topics of what the view's run read, and the client's live read listens to those; a change reads again. `uv:6-9`; for the roster, `rv:20-23` ("a hire, an edit, a fork or a fire reaches its watchers with no topic named by the app"). **[page]** **[checked]**
- Every screen in the app watching the same view with the same input shares one read. `uv:9-11`. A keyed view's rows keep their identity across answers while they don't change (`uv:11-12`; the roster view is keyed by worker id, `rv:67`). **[page]** **[checked]**
- The roster view takes no input and no session: it is answered at user scope (`rv:49`, `:66-67`; `wf/workers/roster-flow.ts:67-68`). So `useView(rosterView)` is the whole call. The roster flow runs no worker (`wf/workers/roster-flow.ts:2-3`). **[page]** **[checked]**
- Each entry: `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited`, `settings`. `rv:34-44`; the client's `RosterEntry` is the same shape, asserted by a type test (`wt/roster-view-types.test-d.ts:1-26`; `wf/workers/client.ts:54-84`). Field meanings (`standard`, `edited`, `forkedFrom`, `teamName`, `settings` shows only what the worker's flow shows) are `RosterEntry`'s doc comments, `wf/workers/client.ts:54-84`. **[page, two or three fields; the rest ref]** **[checked]**
- A standard worker the user edited is listed once, as their copy, still `standard: true`, on its file's team, `edited: true`. `rv:104-113`. A user's own worker has `standard: false`. `rv:91-101`. **[page one sentence]** **[checked]**
- What it follows: a hire, fork, edit or fire, from any tab, a script or a worker's own turn. `rv:20-23`; `wt/watch-roster.test.ts:68-80` (the test is for `watchRoster`, which follows the same view). Timer: where push can miss a change, the live read reads again every 3 s by default (`uv:25-26`; `packages/client/src/live/live-read.ts:34`); `null` turns it off. **[page]** **[checked]**
- `watchRoster(onRoster, { onError })` on the workforce client is the same watch without React: `wf/workers/client.ts:145`, `:407-412`. `ks:13-14`, `:89-107` is the running example of it. **[page one sentence + link]** **[checked]**
- A failed re-read keeps the roster already shown; the next read that lands replaces it. `wt/watch-roster.test.ts:108-121` and `ks:42-50`. **[ref]**
- A page that shows `Roster` or `useView(rosterView)` shows workers; it does not show their status. See flag 6 and 4.4. **[page]**

### 3.2 The roster component

- `Roster` lists workers read from one **collection** on one session. Props: `sessionId` (required), `collectionRef` (default `"roster"`), `problems`, `limit`, `slots`, and the transport pair `client` and `live`. `rc/Roster.ts:60-114`, `:137`, `:179-188`. **[ref]** (the page names three)
- Each row shows the worker's id and its flow; `slots.rowTrailing(row)` puts the host's own control beside it, `slots.empty()` replaces the empty note. `rc/Roster.ts:60-65`, `:219-233`. A row's `data-worker-id` is on the `<li>`. **[page, one clause]** **[checked]**
- Empty text: "No workers have been hired in this organization yet." Loading: "Loading the roster…". A failed read: its message and a Retry button, never retried on a timer. `rc/Roster.ts:213-219`, `rc/chrome.ts:101-120`. **[ref]**
- `problems` is a list the host hands in, of workers it could not restore at boot, shown beside a count "N workers could not be loaded". Workforce passes none itself: a boot reload's `{ workers, problems }` is a server-side value with no path to a browser. `rc/Roster.ts:12-17`, `:79-84`, `:238-266`. The existing page adds that a standard worker that can't run stops the app starting (`ui:117`). **[ref]**
- A row it cannot read is not drawn; it adds to that count. `rc/Roster.ts:201-211`, `:258-263`. This is flag 2's mechanism. **[ref]**
- **There is no organization or user prop**, and a type test pins the prop names: `rosterPropNames` is `client`, `collectionRef`, `limit`, `live`, `problems`, `sessionId`, `slots` (`rc/Roster.ts:125-133`; `wt/panels-props-allow-list.test-d.ts`). The read is addressed to the session, and the session's user and organization are the ones read. `rc/Roster.ts:5-10`, `:68-69`. **[page one sentence]** **[checked]**
- The collection key is one path segment, so `roster`, never `workforce/roster` (`rc/Roster.ts:70-77`). **[ref]**
- It pages: `limit` is the page size, not a cap; the panel follows the cursor for up to 1,000 pages and shows an error plus Retry, never a partial list, if pages remain or the server repeats a cursor. `rc/Roster.ts:85-92`, `rc/reads.ts:128-149`; `wt/panels.test.ts:215-262`. **[ref]**
- Without `client`, it reads through the nearest `FlowProvider`'s user, base URL and fetcher; with no fetcher there, that is plain browser `fetch`, which sends a same-origin cookie and no `Authorization` header (`rc/usePanelSource.ts:1-17`; `ui:115`). Pass one stable `client` to every panel; a new object each render reads as a rebuilt client and re-reads (`rc/Roster.ts:100-105`). **[page one sentence; ref for the rest]** **[checked]**
- `live` reads again when another session changes the collection: it subscribes the session's, the user's and the org's topics and reads on a `resource` notice whose path is under the collection's storage path (found once from the manifest), on a connect, a reconnect, a tick or a `resync`. `rc/reads.ts:94-126`; `wt/panels-live-scope.test.ts:58-76`. A change to another collection, a `state` notice and a session's `items` notice read nothing (`wt/panels-live-scope.test.ts:68-73`). A client that can only read takes no `live`; TypeScript rejects the pair (`rc/Roster.ts:106-112`). A live panel whose read failed reads again within 2 s on its own (`wt/panels-live-scope.test.ts:114-125`). Without `live`, nothing is subscribed and the read happens once, on mount (`wt/panels-live-scope.test.ts:78-85`). **[page: "live re-reads when someone else changes the collection"; ref for the topics]** **[checked]**
- `WorkerDetail` shows one worker's flow (a prop, no read) and instructions (one item read; `workerId` omitted means "not published" and no request). Five states: text, none given, not published, reading, could not be read. `rc/WorkerDetail.ts:3-36`, `:43-74`, `:113-128`. See flag 2 for what a real collection answers. **[ref; flag]**

### 3.3 A conversation (a coordinator's tasks, with `useView`)

- A conversation with a coordinator keeps its own board of the tasks it filed: ledger id `tasks`, at the owner's user scope (`wf/conversation-board/ledger.ts:3-8`, `:61`, `:138`; `dw:169-171`). A worker files onto the board of the session it is in, never another's (`dw:169`). **[page]** **[checked]**
- That board's task list is read as a view: `useView(taskListViewRef("coordinator", "tasks"), {}, { sessionId })`. The view is named `listTasks_tasks`, a session view, keyed by task id. `tl:56-66` (ref and call), `wf/conversation-board/session-board.ts:19-20`, `orchestration/src/skills/views/task-list-view.ts:1-8`, `:21-37`, `:42-58`. A session with no board to list is refused by the list's own reason, `no_delegation_board` (`task-list-view.ts:46-48`). **[page]** **[checked]**
- The view stores nothing; watching it stores no request per look. `packages/shift-manager/src/lib/conversation-tasks.ts:5-9` (a doc comment on an app's hook; the fact is the view's: its context refuses every write, `task-list-view.ts:49-53`). **[page one clause]** **[checked]**
- Its answer is a list of tasks. A task carries `id`, `goal`, `title?`, `status`, `assignee?`, `attempts`, `statusNote?`, `filedByTask?`, `run?`, and the waiting state: `holds?` (what the task waits on now, oldest first, absent when nothing does) and `keptOpenBy?`. `packages/orchestration/src/skills/task-listing.ts:12-17`, `:23-73`. On the board's own action, not the model's: `spend`, `updatedAt`, `createdAt`, `startedAt`, `completedAt`, `leaseUntil` (`task-listing.ts:39-67`). **[page: five fields; ref for the rest]** **[checked]**
- A hold names who it waits on: `actor` is `user` or `system` (`packages/orchestration/src/tasks/schema/hold.ts:41-42`, `:55-67`). A user's hold is a question, a confirm, or a parked approval, review or input (`hold.ts:7-38`, `:69-81`). **[ref]**
- Task statuses: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled` (`packages/orchestration/src/tasks/schema/task-status.ts:13-20`). `held` means "filed, not started, until someone says go" (`task-status.ts:26-29`). A task waiting on a user keeps its other status and carries a `holds` entry: `holds` is "one list of holds, whatever the task's status" (`hold.ts:3-4`). **[page]** **[checked]**
- Where a delegate's answer lands: in the conversation as a message under the delegate's worker id, marked in its `metadata` so a screen tells it from the coordinator's own words; `delegateAnswerOf(item)` returns `{ worker, taskId }` or `undefined`. `wf/conversation-board/delegate-answer.ts:1-16`, `:36-52`, exported `wf/browser.ts:97-102`. **[page]** **[checked]**
- A coordinator's routing record per message is exported by name (`COORDINATOR_ROUTE`, `COORDINATOR_JUDGMENT`, `COORDINATOR_FLOW`; `wf/browser.ts:75`); the record's fields are `coordinators`' page, not this page. **[link only]**
- The view and the collection read are different reads of the same ledger. The view is per session (one conversation's board); the collection `tasks` read through any one of the user's sessions returns the rows of every session that user filed from (`dw:188`: "The read covers the tasks of every session that user has filed from... so you don't need a request per session."; test `wt/conversation-board-browser-read.test.ts:20-43`, `:75-78`). The session must be on a flow that keeps boards (the built-in worker flow, the coordinator flow, or a `defineSessionBoard` flow); any other session answers 404 `Unknown resource "tasks"` (`dw:188`). **[page]** **[checked against dw; test confirms the cross-session rows]**
- A task's input, output and metadata are never sent in the collection read. `dw:190`; `wt/conversation-board-browser-read.test.ts:75-78`. **[ref]**
- The items of the conversation itself (messages, tool calls, approval cards) are drawn by the component registry, not by workforce: `ui:29`, `ui:165` ("Messages, task plans and approval cards from the component registry follow one session's items as they arrive"). **[link only: `reference/ui-components`]**

### 3.4 A board (`BoardColumns`, `BoardList`)

- Both take `sessionId` (required), `boardRef`, `limit`, `slots`, and the `client` and `live` pair. `rc/BoardColumns.ts:84-117`, `rc/BoardList.ts:38-74`. `boardRef` is the key the session's flow declares the ledger under, one path segment, such as `tasks` or `eng.feature.work` (`rc/BoardColumns.ts:87-91`). **[page: `sessionId`, `boardRef`, `live`; ref for the rest]** **[checked]**
- `BoardColumns` groups rows by status in this order: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled` (`BOARD_STATUS_COLUMNS`, `rc/BoardColumns.ts:48-55`). A status it does not know gets its own column after those; no row is dropped (`rc/BoardColumns.ts:145-163`; `wt/panels.test.ts:304-317`). Each column heading reads `<status> (<count>)`, and an empty column says "Nothing here" (`rc/BoardColumns.ts:254-258`). **[page]** **[checked]**
- A card shows the task's `title`, else its `goal`, else its `id`, and its `assignee` when there is one. `rc/BoardColumns.ts:172-186`. The card is built from `id`, `status`, `title?`, `goal?`, `assignee?`, `error?` only; the stored envelope (claim, lease, retry ledger, write log) is withheld by the collection's `expose`. `rc/cards.ts:9-26`; `wt/panels.test.ts:381-413` (none of the withheld fields reach the DOM). **[page one sentence]** **[checked]**
- A row that has no string `id` and `status` is not a card and is not drawn. `rc/cards.ts:34-48`. **[ref]**
- `BoardList` draws the same board as one list, newest first by `createdAt`; a row without a `createdAt` follows the dated ones. The row shows title (else goal, else id), the status word (as written, so an unknown status shows as itself) and the assignee. `rc/BoardList.ts:2-18`, `:89-122`, `:137`. **[page]** **[checked]**
- The collection's `expose` for a board's fields: `createdAt` is a field the list orders by only "if the board published it" (`rc/BoardList.ts:89-93`). The existing page says the collection's `clientData` holds `createdAt` among its fields (`dw:190`). **[ref]**
- Three different renders: loading ("Loading this board…"), empty and a failed read with Retry. Empty on `BoardColumns` says boards are wired to a worker explicitly and that nothing probably drains this one; on `BoardList`, "This board has no tasks." `rc/BoardColumns.ts:205-233`, `rc/BoardList.ts:139-159`. The existing page: "An empty board says so, and names the usual reason: no worker drains it" (`ui:119`), true of `BoardColumns` only. **[page one sentence, scoped to columns]** **[checked]**
- Slots: `BoardColumns` `card` (the body, not the `<li>`), `columnHeader`, `empty`; `BoardList` `row` (the body), `empty`. The component renders one `<li>` per row carrying `data-task-id`, whether the body is the default or the host's. `rc/BoardColumns.ts:67-82`, `:262-272`, `rc/BoardList.ts:25-36`, `:165-176`. **[ref]**
- `live` on `BoardColumns` reads again when another session changes a row under its collection's storage path; on `BoardList` it subscribes the session's topic narrowed to the board and reads on each board notice, on a connect or reconnect, or on a tick. A reply streaming in the session sends no board notice. `rc/reads.ts:74-126`; `wt/panels-live-scope.test.ts:98-111`; `wt/board-list.test.ts:276-324`. A task filed there and the same task settling later in its delegate's task session both reach every open tab (`ui:145`; the test at `wt/board-list.test.ts:302-311` shows a board notice reads once and draws the read, never the notice). **[page one sentence each]** **[checked]**
- `BoardList` requires a client that can `subscribe` for `live`: `PanelLiveSource` (`rc/reads.ts:40`, `rc/BoardList.ts:65-72`). `BoardColumns`' live needs `PanelNoticeSource`: reads, `getResourceManifest` and `subscribe` (`rc/reads.ts:48-51`). A client from `createClient` has all of them. **[ref]**
- Default re-read pace: 3 s timer wherever push can miss a change; one read in flight and one waiting for any number of notices. `rc/reads.ts:83-86`, `packages/client/src/live/live-read.ts:34`; `wt/board-list.test.ts:312-324`. Nothing re-reads a failed non-live panel; the Retry button is the user's. `rc/chrome.ts:101-107`. **[ref]**
- Without `client`, a live `BoardList` reads and subscribes through the provider's fetch; with `client`, both go through it, so the subscription carries the read's credential to the read's origin. `wt/board-list.test.ts:390-436`; `rc/BoardList.ts:56-72`. **[ref]**
- `groupIntoColumns(rows)` and `BOARD_STATUS_COLUMNS` are exported for a host drawing its own columns. `wf/react/index.ts:19-20`; `rc/BoardColumns.ts:48-55`, `:145`. **[ref]**

### 3.5 The navigator (the one component for "where is everything")

The plan's questions do not ask for it, but it is how a screen shows that a session is waiting, so the page keeps one paragraph. Sources are the existing page and `packages/react`.

- `FlowNavigator` takes `sections` (a label and a set of flow kind names), `onSelectSession` and optional slots. `packages/react/src/components/flow-navigator/FlowNavigator.ts:135-139`; `ui:15-29`. The coordinator flow's kind is `coordinator`; the built-in worker flow's is `agent` (`ui:27`, `wf/coordinator/coordinator-keys.ts:12`). **[page one sentence]**
- Session rows carry a mark for the state of the session's latest request: `in_progress` Running ●; `suspended` waiting on the user "Waiting on you" ◆ (needs the user); `suspended` waiting on other work "Waiting" ◇ (does not); `interrupted` Interrupted !; `failed` Failed ✕; `incomplete` Incomplete !. `completed` and `aborted` show no mark, and neither does a session with no request. `packages/react/src/components/flow-navigator/session-row.ts:25-64`; `ui:43-54`. A `suspended` request that does not say whether it waits on a user reads as "Waiting on you", the safer miss (`session-row.ts:59-61`). **[page: the waiting rows; ref for the table]** **[checked]**
- `sessionRowState`, `sessionLabel` and `sessionAge` are exported to draw rows in a list of your own, over `useSessionList`. `packages/react/src/index.ts:148-151`, `:171-176`; `ui:58`. **[ref]**
- The session list is live through the client's `subscribe` on the user's topic: the server publishes a `run` notice for each write to one of the user's sessions, "created, titled, deleted, a request started or ended", from any tab or process the bus reaches; a client without `subscribe` reads once. `packages/react/src/hooks/useSessionList.ts:1-12`; `packages/react/test/useSessionList.test.ts:49-57`. The engine publishes a `run` notice on every session-record write that a delta method (`patchField`, `incField`, `pushToArray`, `deleteField`) or a `set` makes (`packages/engine/src/bus/publish-writes.ts:425-450`). Whether a request parking as `suspended` is one of those writes was not run: **[verify]** before the page says the row's mark flips "within about a second" when a worker starts waiting (`ui:56` says it of "a request starting or ending"). **[verify]**
- The navigator reads the flow list once; a leaf's sessions read when it opens and again whenever one changes while it stays open; opening a collection flow kind's own row reads nothing, so a roster of two hundred workers costs one request. `ui:165`. **[ref]** **[verify]** (not re-read against `FlowNavigator.ts`)
- **The navigator is not scoped to an organization or user.** It shows the flow kinds the server registered, the instances under them, and the sessions the caller can see; the flow list is answered without authentication, so every caller sees every flow and every worker declared in a `WORKER.md`. It does not list a user's own (hired) workers; those come from the roster view. `ui:213-215`. **[page one sentence + link]** **[verify]** (the existing page only; not re-read against the engine's flow-list route)

## 4. The questions the plan asks (answer key for pass 2)

### 4.1 Which view lists a user's workers?

`rosterView`, read with `useView(rosterView)`. It lists the user's own workers and the standard ones from the app's files together, each once. Flag 3, 3.1.

### 4.2 What re-renders when a worker starts waiting?

Depends on what the screen watches. The roster (`useView(rosterView)` or `Roster`) does not: a roster entry holds no status. The conversation's task list (`useView(taskListViewRef(...))`) does re-render when a task on the board changes, and a task waiting on a user carries a `holds` entry (3.3). `BoardColumns` and `BoardList` with `live` re-read on a change to the board and show a `held` task in the `held` column or word. A navigator session record changes its mark when the session's latest request reaches `suspended` (3.5, **[verify]** on timing and on the path that notice takes). Pass 5 checks which of these the page keeps.

### 4.3 Do you have to use the shipped components?

No. The components are drawn over reads a client already makes: `useView(rosterView)` returns plain data for a roster of your own (3.1), `taskListViewRef` plus `useView` returns a conversation's tasks (3.3), `watchRoster` follows the roster without React (3.1; `ks:89-107` does so with its own list), and `readEveryCollectionPage` plus `sessionIdOfFiling` read the board without a component (`dw:192-205`, `wf/browser.ts:49`). `BoardColumns` and `BoardList` take `slots.card` / `slots.row` for your own body, and each component brings no CSS framework or icon set; you theme through `--fsd-panel-*` custom properties and fill your own parts through slots (`rc/chrome.ts:49-58`, `rc/Roster.ts:18-21`). `groupIntoColumns` is exported for your own columns (3.4). **[page]** **[checked]**

### 4.4 Where "waiting" shows, per surface (for the figure and for question 2)

| Surface | Where waiting appears | Source |
| --- | --- | --- |
| Roster entry (view) | nowhere: no status field | `rv:34-44`, `wf/workers/client.ts:54-84` |
| `Roster` row | nowhere: id and flow | `rc/Roster.ts:223-233` |
| Conversation task list (view) | `holds` on a task, and its `status` | `task-listing.ts:12-17`, `hold.ts:3-4` |
| `BoardColumns` | a card in the `held` column for a filed-not-started task; a user question rides on `holds`, which the card does not show | `rc/BoardColumns.ts:48-55`, `rc/cards.ts:19-26` |
| `BoardList` | the status word beside a row | `rc/BoardList.ts:113-122` |
| `FlowNavigator` session row | ◆ Waiting on you or ◇ Waiting, from the session's latest request | `session-row.ts:36-64` |

**[checked]** for the cells; the card's missing `holds` follows from `BoardCard`'s fields (`rc/cards.ts:19-26`).

## 5. The figure: which view feeds which part of the screen

A page wireframe with regions tied to a read, an arrow (`READS`) from each region and hatching on the data behind each read. The regions, and the facts each carries, for the figure brief:

| Region | Read | Data behind it | Source |
| --- | --- | --- | --- |
| Roster rail | `useView(rosterView)` | the user's own workers (user scope) and the standard workers from the app's files | `rr:12`, `rv:15-24`, `wf/workers/worker-row.ts:68-69`, `wf/workers/keys.ts:25` |
| Session list under a worker | `FlowNavigator` over `useSessionList` | the user's sessions, with each one's latest request status | `packages/react/src/hooks/useSessionList.ts:1-12` |
| The conversation | the session's items, drawn by the component registry | one session's items | `ui:165` |
| The conversation's board | `useView(taskListViewRef("coordinator", "tasks"), {}, { sessionId })` | the conversation's ledger `tasks`, at the owner's user scope | `tl:56-66`, `wf/conversation-board/ledger.ts:61`, `:138` |
| A board of every conversation | `<BoardColumns boardRef="tasks" live />` or `<BoardList ... />` | the `tasks` collection read through any one of the user's sessions, covering every session they filed from | `dw:188`, `rc/BoardColumns.ts:188-203` |

The figure's own hatched layer is the data, the arrow is the read. **[page, figure]**

## 6. The four questions, for what these screens read

The screens store nothing. Each component keeps only the rows it has read in memory; a page refresh reads again (`rc/reads.ts:150-180`). What they read is stored by other pages' parts, so the answers below point to their sheets and state what the screens need.

| Part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| The user's own worker records | The user who hired or forked each one. | The user alone; a browser sees `flow`, `name`, `description`, `forkedFrom` and `settings` the worker's flow shows, never instructions or other settings (`wf/workers/worker-row.ts:66-79`, `:93-100`; `wt/roster-shown-settings.test.ts:1-12`, `:44-60`). | User scope (per organization), pattern `workforce/workers/*` (`wf/workers/keys.ts:10-15`). | One per worker the user hired or forked. |
| The standard workers | The app: each one is a `WORKER.md` file in the repo (`coordinators.facts.md` section 6 and the Workers sheet, `docs/contributing/docs-revamp/pages/concepts/workers.facts.md`). | Every user: the roster view lists them all for every user (`rv:102-113`). | Projected from the installation's files at `workforce/standard-workers/*` (`wf/workers/keys.ts:24-25`); not written per user. | One per file. A user's edit makes their own copy, listed in its place (`rv:104-113`). |
| The roster view's answer | Nothing: a view stores nothing. It reads the two collections each time it runs. | The caller. | Nowhere; the live read holds the last answer in the browser (`uv:6-12`). | One answer per caller. |
| A conversation's tasks | The user whose conversation it is (`wf/conversation-board/ledger.ts:3-8`). | That user alone (`dw:188`). A task's input, output and metadata are never sent to a browser (`dw:190`). | One durable collection at the owner's user scope, ledger id `tasks`, rows keyed by the filing session (`wf/conversation-board/ledger.ts:3-8`, `:61`, `:138`; `dw:190`). | One row per task; at most 100 tasks count under one top task (`dw:165`). |
| A session's request status | The session's owner. | The caller, in the sessions the navigator lists (and every caller sees every flow kind, `ui:213`). | In the session record; `requestStatus` is read from the same listing (`packages/react/src/hooks/useSessionList.ts:1-12`). | One latest status per session. |

## 7. What stays off the page

- **Reference rows** (`reference/ui-components`): each component's prop table and the transport types (`PanelRowSource`, `PanelItemSource`, `PanelLiveSource`); `rosterPropNames` and the other allow-lists; every slot signature; the `--fsd-nav-*` and `--fsd-panel-*` custom properties and the "one set of tokens" recipe (`ui:169-207`); the state-by-`data-state` table; the paging rules and the 1,000-page ceiling; the live topics each panel subscribes; the navigator's depth rules and slots (`ui:31-39`, `:176-188`); the session row table (`ui:45-52`); `groupIntoColumns`; the `data-*` attributes. **[ref]**
- The Messages section (`ui:157-159`): a link to `messaging`. **[ref]**
- The Limits section's "These components render; they don't administer. There is no create-worker or invite control." (`ui:211`): a true one-clause limit, kept if the page has room. **[page, optional]**
- The multi-organization warning about the navigator (`ui:213-215`): kept as one sentence with a link to the authentication page. **[verify]**
- Everything in the existing page's "Where each component reads from" figure caption beyond the region-to-read table in section 5. **[figure]**
- Cost and read arithmetic, the 3 s timer's exact value and the 2 s failed-read retry: Reference. **[ref]**
- The lab and starter apps (`labs/*`): not cited. **[cut]**
- Tracker ids in test names and doc comments (`BR-*`, `FIX-*`, `V*`): never cited on the page. **[cut]**
- What these components used to import from, or an alias for the old path: an Upgrading-page row, not this page. The code carries none (`wt/react-entry.test.ts:25-33`). **[cut]**

## 8. Open items for the owner and for pass 5

1. Flag 2 is a defect, not a prose problem: `Roster` and `WorkerDetail` cannot read a row the real `defineWorkerCollection()` answers (no `workerId`, no `instructions`). The page's "The roster component" example depends on the answer. Options the caller may weigh: the component reads `rosterView` instead, the collection's projection gains the fields, or the component's row check changes. Until then the page can show `useView(rosterView)` (a real read, 3.1), the board components over a real ledger (3.4, verified against the real row shape `wt/conversation-board-browser-read.test.ts:75-78`), and say nothing about `Roster`.
2. Section 3.5's navigator timing claims are the existing page's, not re-run.
3. The scope wording (flag 4): the existing page and the component's doc comments say "organization"; the code stores at user scope. The page says "the user's".
4. The install line is in the cut README copy only (section 2).

## Revise round 1

- The board components (`BoardColumns`, `BoardList`) read the board's collection, not a view: `usePanelRows` calls `readEveryCollectionPage` (`rc/reads.ts:151-176`; `rc/BoardColumns.ts:193-203`). Only `rosterView` and the task list go through `useView`. The page now says so.
- Moved to Reference (page links `reference/ui-components`): `value`/`stale` fields, re-read triggers and shared read, roster entry states and no-status, task statuses, `delegateAnswerOf`, board props and card contents, the where-waiting-shows table (section 4.4), which flow serves each view, `--fsd-panel-*` tokens, the no-create-worker limit, `groupIntoColumns`.
- Page keeps: the roster redraws on hire, edit, fork and fire; a waiting task carries a `holds` entry; a coordinator is defined as a worker that hands tasks to other workers.

## Revise round 2

- Roster scope made findable (flags 3, 4; 3.1; section 6): Alice's hired worker is not in Bob's roster (user-scope rows, `wf/workers/worker-row.ts:68-69`); standard workers list for every user; Bob's edited standard worker lists once as his copy, `standard: true`, `edited: true` (`rv:102-113`). The page states it in the roster section and the opening scope line.
- Board empty states (3.4, `rc/BoardColumns.ts:48-55`, `:205-233`; `rc/BoardList.ts:139-159`): `BoardColumns` empty note says boards are wired to a worker explicitly and nothing probably drains this one; `BoardList` says "This board has no tasks."; both have loading and failed-read-with-Retry states. Column order and unknown-status column stated in the board section.
