# Fact sheet: Task board (R-23, reference, `reference/task-board`)

Pass 1. Cites only what a fact sheet may cite: the existing pages (`apps/docs/docs/orchestration/task-board.md` = OLD, `apps/docs/docs/orchestration/configuration.md` = CFG, `apps/docs/docs/workforce/delegating-work.md` = DW, `apps/docs/docs/patterns/plan-and-execute.md`), the exported surface and its doc comments, tests, and one example that uses it (`examples/guides/custom-pattern`). No spec, no `docs/internal`, no PR or commit text was read. The moved rows from other pages' records were checked against the code and are ledgered in section 12.

Where a fact comes from reading the implementation (not an exported doc comment or a test), it is marked **[source]**. Implementation reading constrains what the page may say; it is not quoted. A fact with no tag is on an exported type, its doc comment, or a test.

Page shape from the sitemap: tables, plus one state figure ("A task's states"). Tables: `taskBoard` options, task statuses and what moves a task between them, stop reasons, concurrency, retries, where the list is stored and how long each choice lasts, assignees that dispatch. Lookups: "What cancels a task?", "Which stop reason means a task is waiting on a user?", "What does `maxAttempts` change?". "Migrating" is cut. "Assignees that dispatch" is its own table. No narrative.

## Abbreviations

All paths from the repo root. `O` = `packages/orchestration/src/`. `T` = `packages/orchestration/test/`.

- Board: `tb` = `O`task-board/index.ts; `bm` = `O`task-board/blocks/board-meta.ts; `cb` = `O`task-board/blocks/check-board.ts; `qs` = `O`task-board/quiescence.ts; `sh` = `O`task-board/shared.ts; `bmode` = `O`task-board/board-mode.ts; `da` = `O`task-board/dispatch-assignee.ts; `te` = `O`task-board/task-entry.ts; `dt` = `O`task-board/blocks/dispatch-task.ts; `rr` = `O`task-board/blocks/record-result.ts; `gsl` = `O`task-board/goal-seek-loop.ts; `ar` = `O`task-board/apply-replan.ts; `fpw` = `O`task-board/flow-policy-wiring.ts; `pred` = `O`tasks/collection/predicates.ts.
- Tasks: `ts` = `O`tasks/schema/task-status.ts; `tk` = `O`tasks/schema/task.ts; `hd` = `O`tasks/schema/hold.ts; `ti` = `O`tasks/schema/task-init.ts; `wt` = `O`tasks/workers/types.ts; `casc` = `O`tasks/collection/cascade.ts; `int` = `O`tasks/collection/internal.ts; `mt` = `O`tasks/collection/method-table.ts; `caps` = `O`tasks/collection/task-caps.ts; `fr` = `O`tasks/collection/field-rules.ts; `fil` = `O`tasks/collection/filing.ts; `dtc` = `O`tasks/collection/define-task-collection.ts; `goc` = `O`tasks/collection/get-or-create.ts; `hol` = `O`tasks/collection/holds.ts; `ev` = `O`tasks/collection/change-event.ts; `bmv` = `O`tasks/board-meta-value.ts; `ntc` = `O`tasks/notice/task-settled-entry.ts.
- Tools: `tt` = `O`skills/task-tools-capability.ts.
- Other packages: `core` = `packages/core/src/`; `pat` = `packages/patterns/src/`; `wf` = `packages/workforce/src/`; `eng` = `packages/engine/src/`.
- Tests under `T`task-board/: `tbt` = task-board.test.ts; `capt` = task-board-caps.test.ts; `rbt` = task-board-retry-budget.test.ts; `bmt` = board-mode.test.ts; `wur` = task-board-waiting-on-a-user-report.test.ts; `qt` = quiescence.test.ts; `gslt` = goal-seek-loop.test.ts; `dcf` = dispatch-cross-flow.test.ts.
- Example: `ex` = `examples/guides/custom-pattern/src/plan-map-reduce.ts`.

## 0. Findings the writer must act on before drafting

The code disagrees with OLD or CFG in these places. Code wins; each is a row the page must get right.

| # | Finding | Source |
|---|---------|--------|
| 0.1 | **`claimOrder` has two names, not three, and the default is `"fifo"`.** OLD (task-board.md "Claim orders") and CFG say `"topological"` is a third name and the default. It is not accepted: the type is `ClaimOrder \| "fifo" \| "priority"`, the destructure defaults `"fifo"`, and any other string throws `unknown claim order name`. A test pins that `"topological"` is not a name. | `tb:688` (default), `O`task-board/shared.ts:27-46 (type, switch, throw), `tbt:150-160` (throws), `tbt:456-462` ("topological is not one") |
| 0.2 | **`idlePollMs` is not a sleep.** CFG: "Sleep when a claim returns nothing, default 50". An idle worker waits for a `task-change` item on the board's collection; it re-checks on its own after `max(idlePollMs * 100, 50)` ms (default 5,000 ms). `idlePollMs` itself must be `>= 0` (a negative throws at construction). | `tb:694`, `tb:721-725`, `tb:1196-1231` (`timeoutMs: Math.max(idlePollMs * 100, 50)`, `wakeOn: onTaskChangeFor`), `pred:19-45` |
| 0.3 | **There is no `dispatch` option on `taskBoard`.** CFG lists `dispatch` ("Dispatch mode for a uniform worker"). `TaskBoardConfig` has no such field; a uniform worker cannot dispatch (`taskBoard()` throws for a task dispatcher given as the uniform `workers` block). Drop the row. | `tb:301-541` (the whole config), `da:277-282` |
| 0.4 | **The default-assignee rule on `createTask` is not "several delegates leave the task unassigned".** With a roster: one worker on the roster gets the task; the board's default worker claiming unassigned tasks, or no roster, files it unassigned; a task filed `held: true` stays unassigned; otherwise `createTask` is refused `assignee_required` and files nothing. Row 6 of section 12 is carried corrected. | `tt:371-402` |
| 0.5 | **`answers_not_question` is in OLD's refusal table and in no code.** The updateTask refusals the code has are in 8.4. Two the table lacks: `filing_setting_fixed`, `wait_is_not_a_question`. Drop the one, add the two. | grep of `O` finds the name nowhere; `tt:1698`, `tt:1898` |
| 0.6 | **A third `keptOpenBy` value, `"steer"`, exists.** OLD's table lists `"filed"` and `"suspended"`. The schema and its doc comment have `"suspended"`, `"filed"`, `"steer"`. | `tk:525`, `tk:512-525` |
| 0.7 | **`task-board-meta` has six `terminationReason` values**, OLD lists five. The sixth is `"waiting-on-an-event"`: the work left waits on something outside the board and none of it on a user. | `bm:292-309`, `wur:186-203` |
| 0.8 | **The spend view carries `costUsd`**, which OLD's `spend` table omits. | `O`tasks/schema/spend.ts:74-81 |
| 0.9 | **The wrapper patterns do not all use the board's defaults.** `parallelTasks` and `supervisor` set concurrency 3, `planAndExecute` sets 1; `parallelTasks` also sets `onIdle: "complete"`. See 10. | `pat`parallelTasks/index.ts:96,139-142; `pat`supervisor/index.ts:281,384-391; `pat`plan-and-execute/index.ts:615,723-732 |
| 0.10 | **`taskSettledInputSchema.ending` has a fourth value, `"retried"`.** OLD says three. The doc comment on the notice type says `retried` is read only off a marker an older board wrote. Say three, and do not list `retried`. | `ntc:57`, `O`tasks/notice/task-notice.ts:78-81 |

## 1. `taskBoard` options

`taskBoard(config)` from `@flow-state-dev/orchestration/task-board` returns a handle. Config type `TaskBoardConfig` (`tb:301-541`).

### 1.1 The handle

| Member | What it is | Source |
|--------|------------|--------|
| `drain` | The sequencer to put in a flow as a step. | `tb:570-578` |
| `collectionId` | The id of the task list; matches `data.collectionId` on emitted items. | `tb:579-580` |
| `capability` | Put in a block's `uses`; the board's tasks are at `ctx.cap.<name>` (the board `name`, verbatim; hyphenated names via `ctx.cap["my-board"]`). | `tb:581-602`, `tbt:1281-1300` |
| `backing` | `"request" \| "resource" \| "sequencer" \| "factory"`. | `tb:567`, `tb:604-612`, `tbt:182-222` |
| `mode` | `"plan"` or `"delegation"`. | `tb:613-620` |
| `boardId` | The declared id, or absent. | `tb:628` |
| `dispatchers` | The assignees holding a task dispatcher, in declaration order. Each has `name`, `kind` (`"named"`, or `"floor"` for `defaultWorker`, whose `name` is empty), `label` (`assignee:<name>` or `floor`) and `dispatch`. `newSession` is not listed here. Empty on a board with none. | `tb:629-633`; OLD "What the drain reports" |
| `hasIdlessInitialTasks` | `true` when any `initialTasks` entry has no `id`. | `tb:634-643`, `tbt:224-246` |
| `caps` | The resolved creation caps, defaults applied; `{}` when the caller supplied the collection. Pass `...board.caps` to a `getOrCreateTaskCollection` that resolves the same list, or that writer enforces nothing. | `tb:644-659`, `capt:249-307` |

### 1.2 Options

| Option | Type | Default | What it does | Source |
|--------|------|---------|--------------|--------|
| `name` | `string` | required | Name of the outer sequencer and the prefix of every internal block; unique within a flow if the flow mounts more than one board. A name that is a property of every object, such as `__proto__` or `toString`, throws (pinned by `tbt:1301-1314`). | `tb:301-311`, `tbt:1301-1314` |
| `boardId` | `string` | none | Stable id. Required when any assignee (or `newSession`) is a task dispatcher. Only the `"per-task"` and `"per-worker"` presets fold it into the session key, so renaming it orphans their live runs; a custom `{ key }` is used as returned. It also scopes the claim gate (the check a dispatched run makes that its claim is current). `core`types/dispatch.ts:331-346, `da:294`. | `tb:312-326`, `da:285-297` |
| `mode` | `"plan" \| "delegation"` | `"plan"` | Whether the drain waits on its tasks. See 7. | `tb:328-347` (`:682` default) |
| `collection` | request spec \| sequencer spec \| `defineTaskCollection(...)` \| factory | request-backed, `collectionId` = `name` | Where the task list lives. See 6. | `tb:349-362` |
| `workers` | one block, or `{ [assignee]: block }` | required | A single block runs every claimed task. A registry routes on `task.assignee`. On a delegation board each registry value is a `dispatcher(...)`. | `tb:364-377` |
| `defaultWorker` | block or task dispatcher | none | Registry fallback for a task whose assignee is unknown or absent. Without it, such a task fails per `onError`. A task dispatcher here hands each such task over under the assignee the task names. Declared workers never route through it. | `tb:379-388`, `tbt:549-777` |
| `newSession` | task dispatcher | none | Plan boards only. A task filed `session: "new"` runs in a session of its own and the drain waits on it. A delegation board that sets it throws. | `tb:390-399`, `tb:1337-1365`, `bmt:110-130` |
| `concurrency` | `number` | `4` | How many workers run at once. `< 1` throws at construction. | `tb:401-405`, `tb:687`, `tb:711-715`, `tbt:128-137` |
| `maxEnqueuedTasks` | `number \| null` | `100` (or the lifetime cap if that is lower) | Most tasks that may be added while others are `pending`. `null` is unbounded. See 4 and 5.3. | `tb:407-428`, `caps:340-346` |
| `maxTotalTasks` | `number \| null` | `500` | Most tasks the list may ever hold, finished ones included. `null` is unbounded. | `tb:430-442`, `caps:221` |
| `maxTotalRetries` | `number \| null` | `50` | Failure retries the board may grant across every task. `0` never retries, `null` is unbounded. | `tb:444-461`, `caps:243` |
| `claimOrder` | `"fifo" \| "priority" \| ClaimOrder` | `"fifo"` | How a ready task is picked. See 4.3. | `tb:463-469`, `tb:688` |
| `onIdle` | `"complete-or-blocked" \| "complete" \| "wait"` | `"complete-or-blocked"` | When the worker pool stops. See 3.2. | `tb:471-486` (`:689`) |
| `initialTasks` | `TaskInit[]` | `[]` | Tasks written into the list at the start of each drain. A task whose `id` already exists is skipped; one without an `id` is added again on every drain of the same list. | `tb:488-489`, `tbt:1938-2004`, `tb:634-643` |
| `onError` | `"skip" \| "fail"` | `"skip"` | A worker that throws: `"skip"` writes the failure to that task and siblings go on; `"fail"` writes it, then rethrows, so the drain fails. With `maxAttempts` left, `"fail"` still rethrows after the task was re-queued. | `tb:491-503`, `rr:442-561` (`:559-561`), `tbt:868-929` |
| `maxIterations` | `number` | `10000` | Per worker, how many times it loops back to claim again. `< 1` throws. Not a drain count: `goalSeekLoop`'s `maxIterations` counts drains, and setting one does not set the other. | `tb:505-510`, `tb:692`, `tb:716-720`, `tb:1253-1256`, `gsl:164-167` |
| `shouldExit` | `(collection) => boolean` | none | Stop test for `onIdle: "wait"`, run once per worker iteration and on each wake event of the idle wait. Ignored in the other two modes. | `tb:512-517`, `qs:111-113`, `O`task-board/predicates.ts:75-77 |
| `idlePollMs` | `number` | `50` | See 0.2: an idle worker re-checks after `max(idlePollMs * 100, 50)` ms if no task change wakes it first. `< 0` throws. | `tb:519-523`, `tb:1221` |
| `toolCache` | `boolean \| { enabled?, defaultTtl?, maxEntries?, defaultScope? }` | on when a worker tool is `cacheable` | Memoizes tool results for one board run; torn down when the run ends, completed or errored. `false` turns it off. `defaultScope` is `"run" \| "request" \| "session"`, default `"run"`. `maxEntries` default 5,000 (`core`blocks/tool-cache.ts:186). | `tb:525-533`, `tb:546-562` (type); `fpw:213-221`, `fpw:266-276`; CFG "toolCache object" |
| `flowPolicy` | `TaskFlowPolicy` | `declaredDepsOnly()` | Which earlier tasks' observations a worker sees as `priorWork`. | `tb:535-541`, `fpw:208-210` |

Construction errors, all thrown by `taskBoard()` itself:

| Condition | Source |
|-----------|--------|
| `concurrency < 1`, `maxIterations < 1`, `idlePollMs < 0` | `tb:711-725` |
| an unknown `claimOrder` string | `tbt:150-160` |
| the old `dispatcher` key (now `claimOrder`) | `tb:696-707`, `tbt:163-176` |
| `maxTotalTasks`, `maxEnqueuedTasks` or `maxTotalRetries` beside a supplied `defineTaskCollection` or factory | `tb:1389-1411`, `capt:309-330`, `rbt:129-138` |
| a cap that is not a positive integer or `null` (`maxTotalRetries`: not a nonnegative integer or `null`); an enqueue bound above the lifetime bound | `caps:246-304`, `capt:178-232` |
| a mode that contradicts the assignees, or a dispatcher board missing `boardId`, a durable collection, `sharedToLineage`; see 7.3 | `bmode:55-100`, `da:277-327` |

## 2. Task statuses and what moves a task between them

Six statuses. `taskStatusSchema`: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled` (`ts:15-22`). `completed`, `errored` and `cancelled` are terminal (`ts:29-34`).

### 2.1 The state machine

The allowed moves (`ts:44-52`, **a status move the table does not list throws `IllegalTaskTransitionError`**, `ts:73-114`):

| From | To | What moves it | Source |
|------|----|---------------|--------|
| `pending` | `in_progress` | A worker claims it: all its `deps` are `completed`, it is not `held`, and it has no open hold. | `ts:45`, `int:1053-1063` [source for the claim rule; also OLD "Dependencies"] |
| `pending` | `held` | Filed with `held: true`, or `updateTask({ status: "held" })` before the first start. | `ts:45`, `ti:63-68`, `tt:1647-1665` |
| `pending` | `cancelled` | A cancel, or a cascade when a dependency ends for good. | `ts:45` |
| `held` | `pending` | Released: `updateTask({ status: "pending" })`. | `ts:47`, `tt:1647-1665` |
| `held` | `cancelled` | A cancel. | `ts:47` |
| `in_progress` | `completed` | The worker's turn returns. | `ts:46`, `mt:642-645` |
| `in_progress` | `errored` | The worker throws (or ends for good) with no attempts left, the retry budget refuses a retry, or a claim finds a lapsed task already abandoned 3 times (`DEFAULT_MAX_ABANDONMENTS = 3`) and settles it inside `claim`. | `ts:46`, `mt:658-700`, `int:512`, `int:1078-1097`, `int:1460-1475` |
| `in_progress` | `pending` | A failure with attempts left (a retry), or the manual `reclaim()` verb on a lapsed row (nothing in the shipped packages calls it). | `ts:46`, `mt:658-682`, `mt:780-803` |
| `in_progress` | `cancelled` | A cancel while it runs, or a cascade. | `ts:46` |
| `completed`, `errored`, `cancelled` | none | Terminal. | `ts:48-50` |
| `errored`, `cancelled` | `pending` | **The `retryTask` action only**, outside the table: the same task, id, messages, output so far and spend, one more attempt. | `mt:717-728`, `int:430-495` |

- 2.1.1 A task waiting on a user keeps its status and gains a hold with `actor: "user"`. An external wait is a hold with `actor: "system"`, which drives `waiting-on-an-event` (`O`tasks/schema/hold.ts:19,38-39,83). Before it starts it is `pending` (filed on questions); midway it is `in_progress` with no lease. A cancel closes every hold. The claim never takes a row that has an open hold. `tk:527-544`, `hol:56-64`, `int:1021-1063`.
- 2.1.2 `getTask` and `listTasks` show a task's open holds as `holds`; the `held` status is separate from a hold: set at filing with `held: true` or by `updateTask({ status: "held" })` before the first start (the filer's tool or the `updateTask_<suffix>` action, suffix per 8.0.2: the collection id with characters outside `[a-zA-Z0-9_-]` turned into `_`; `O`skills/task-tool-suffix.ts:13-15, `O`skills/task-tools-capability.ts:2492,2514), it keeps a task from being claimed until released. The filer is the block or model that filed the task. `tt:200-210` (`waitingOf`), `tt:2004-2025`.
- 2.1.3 `held` sits beside `pending`, before any start. A held task starts only once released. A `fail` on a held task is refused (routed terminal, which the table refuses from `held`). `ts:36-43`, `int:688-700`.
- 2.1.4 A lapsed lease does not move the row to `pending`. `claim` admits an `in_progress` row whose lease lapsed (`isClaimable`) and re-claims it in place: it stays `in_progress`, `attempts` +1, `abandonments` +1; no failure is recorded and the retry budget is not spent. A row already abandoned 3 times is settled `errored` in the claim write with `[tasks] task "<id>" was abandoned by its worker 3 times without completing. Not re-dispatched.` Only the manual `reclaim()` verb writes `pending`. `int:1053-1060`, `int:1396-1425`, `int:1089-1097`, `mt:508-541`, `mt:780-803`.
- 2.1.5 Every status change emits a `task-change` item. Its kinds: `added`, `claimed`, `completed`, `errored`, `retried`, `retry_requested`, `held`, `released`, `settings_changed`, `resumed`, `cancelled`, `label_changed`, `metadata_changed`, `priority_changed`, `assignee_changed`, `run_linked`, `progress_reported`, `resume_settled`, `steered`, `cancel_owed`, `wait_changed`, `asked`, `answered`. `ev:17-80`. The item is keyed `${collectionId}/${taskId}` (the latest change per task replaces the previous one) and defaults to `itemVisibility { client: true, history: false }`. `goc:1-12`, `goc:36-44`.

### 2.2 What cancels a task (the lookup)

Anything that calls cancel, and a cascade. One row each:

| Cancels the task | Source |
|------------------|--------|
| `updateTask({ id, status: "cancelled" })`, from the filer's tool or the `updateTask_<suffix>` action (2.1.2). Allowed until the task finishes; sent alone. | `tt:1647-1665`, `tt:1714-1722`, `fr:41`, `fr:44-45` |
| A cancelled **confirm**: answering a confirm No (`done: false`) when its `onNo` is `"cancel"` (the default) cancels the task, the No and its note as the reason. | `tt:1914-1918`, `tt:1946-1975`, `hd:88-94` |
| A worker throwing `TaskEndsForGoodError(msg, { taskId, ending: "cancelled" })` for the task it holds. | `rr:167-177`, `rr:454-461` |
| A cascade: a task a task depends on failed for good or was cancelled. | `casc:9-16`, `casc:57-60` |
| Stopping the run of a task that waits on a user: the task is cancelled rather than failed. | OLD "A task waiting on a user" |
| Stopping a conversation whose turn waits on a task cancels the task it waits on. | OLD "Waiting on a task" |
| A cancelled task owes `cancelled` on its dependents and on the tasks it filed (see 2.3). | `casc:57-65` |

A terminal task cannot be cancelled again: the cancel is advisory and answers `task_finished`. `mt:770-777`, `tt:1620-1640`.

### 2.3 Cascade rules and cancelled-task fields

- 2.3.1 A task that fails for good (`errored`) or is cancelled cancels every open task on the board whose `deps` name it, then every task that depends on those, to the end of the chain. Each is `cancelled`, labelled `"skipped"`, with `causedBy` naming the task that ended and `error` reading `dep <id> failed` or `dep <id> was cancelled`. `casc:9-16`, `casc:30-31`, `casc:76-94`, `tbt:419-454`.
- 2.3.2 Every board does this; nothing is wired. The cascade is owed in the ending's own write, so a crash between the two leaves it on the stored row (`cascadeOwed`); the ending's pass pays it at once, and the board's next drain pays any past due before it claims. A task that is retried owes nothing yet. `casc:17-25`, `tb:765-790` (`payOwedCascades`), `T`task-board/drain-pays-owed-cascade.test.ts.
- 2.3.3 A task that fails, retries or is cancelled also cancels the open tasks it filed, on a board whose collection declares `cascadeFiled` (the Workforce conversation board does; a plain board has none). `casc:62-65`, `dtc:150-160`, DW 232.
- 2.3.4 A retry (`retryTask`) cancels no dependents and sends the filer no notice. A dependent the failure cancelled stays cancelled until retried too. OLD "Changing tasks from outside a run"; `int:430-445`.
- 2.3.5 A filing is refused when its `deps` could never be met: `dependency_not_on_board` (an id on no task of this board), `dependency_ended` (a dependency that already failed or was cancelled), `dependency_loop`. Nothing is filed; in a batch the ids in the same batch count. The `createTask` tool answers `{ ok: false, error }`; `createTasks`/`initialTasks` throw `TaskFilingRefusedError` (fields `rule`, `taskId`). A replan batch is different: a task whose dependency already ended is filed `cancelled` and `skipped`, as are the batch tasks that depend on it; every other refusal fails the run. `fil:16-47`, `fil:55-67`, `ar:228-262`.
- 2.3.6 A planAndExecute plan's output maps `errored` to `failed`, `cancelled` to `skipped`, `in_progress` to `in-progress`; `pending` and `completed` pass through. `pat`plan-and-execute/blocks/synthesize.ts:26-44, plan-and-execute.md lines 82-83.
- 2.3.7 `completed` and `cancelled` keep their status: neither has an exit in the table (2.1). `ts:48-50`.
- 2.3.8 The run itself does not fail because a task did: under `onError: "skip"` the failure is on the task and the drain ends normally; the final `task-board-meta` reports `blocked-by-failures`. `tbt:868-905`, `tbt:1839-1888`.

### 2.4 The state figure ("A task's states")

Nodes: `pending`, `held`, `in_progress`, `completed`, `errored`, `cancelled`. Edges and their labels are the table in 2.1. Terminal nodes: the three last. Marks on the figure (per `user-docs-figures.md` rules the figure pass uses): the `in_progress -> pending` edge is the retry (a lapsed lease is not an edge: the row stays `in_progress`, stated as a note, 2.1.4); the `errored/cancelled -> pending` edge is `retryTask` alone and is drawn apart from the rest. A task waiting on a user is a note on `pending`/`in_progress`, not a seventh state (2.1.1). Every name comes from `ts:15-22`.

## 3. Stop reasons

### 3.1 The reason on the final `task-board-meta` item

The board's last item of a drain is a `data` item of type `task-board-meta`, keyed by `collectionId`, `itemVisibility { client: true, history: false }`. Two per drain: `status: "active"` first, `status: "completed"` last. `bm:75`, `bm:111-115`, `bm:312-316`, `bmv:1-35`, `tbt:1786-1836`.

`data` shape: `{ collectionId, status, terminationReason?, counts?, maxTotalRetries? }`. `counts`: `total`, `completed`, `errored`, `cancelled`, `held`, `in_progress`, `pending`, `retries` (failure retries the board granted). `maxTotalRetries` is the limit the collection actually enforced, `null` when none. `bmv:7-34`, `bm:256-275`. A pattern around a board may write other `status` words (for example `"planning"`). `bmv:21-26`.

Six `terminationReason` values. The page words the order as "checks the conditions below in order, and the first match sets the value", since eight conditions map onto six values (`blocked-by-failures` is three of them) (`bm:196-241`, code at `bm:292-310`):

| Order | Value | Means | Source |
|-------|-------|-------|--------|
| 1 | `retry-budget-exhausted` | A retry was refused because `maxTotalRetries` was spent (read from a stored denial on a task, never from `counts.retries === maxTotalRetries`). | `bm:206-209`, `rbt:166-216` |
| 2 | `all-completed` | Every task is `completed`, or the board was empty. | `bm:203`, `tbt:249-275`, `tbt:333-350` |
| 3 | `blocked-by-failures` | A task is `errored`, `cancelled` or `held`. | `bm:204-205`, `bm:221-224` |
| 4 | `blocked-by-failures` | A remaining task is going nowhere: a dependency that no running work will satisfy, or an abandoned running row (lapsed lease, nothing open). A task that only depends on a waiting-on-a-user task does not trigger this. | `bm:225-229`, `bm:111-152` [source for the closure], `wur:98-110`, `wur:205-224` |
| 5 | `waiting-on-a-user` | The work left waits on a user: a question, a confirm, or a run stopped for a review or an approval. | `bm:212-214`, `wur:77-110`, `wur:164-185` |
| 6 | `waiting-on-an-event` | The work left waits on something outside the board, none of it on a user (an external wait). | `bm:215-217`, `wur:186-203` |
| 7 | `dispatched` | Every remaining task is running in a dispatch run. The board did its part; success, not a stall. `counts.in_progress` is how many are still running. Only a `mode: "delegation"` board reports it; a plan board with a dispatcher assignee or `newSession` never does (`bmode:36-38`, `O`task-board/shared.ts:96-107, `bm:262-266`). | `bm:210-211`, `bm:44-48`, `qt:405-426` |
| 8 | `blocked-by-failures` | Otherwise. | `bm:234` |

- 3.1.1 Rung 3 outranks rung 5: a failed, cancelled or `held` task beside a waiting-on-a-user task reports `blocked-by-failures`. A held-status task with an open question is `blocked-by-failures`, not `waiting-on-a-user`. `wur:111-130`, `wur:226-245`. A dispatched task beside the question task is `waiting-on-a-user`. `wur:246-257`.
- 3.1.2 `waiting-on-a-user` and `waiting-on-an-event`: nothing went wrong and nothing is finished. The next drain after the answer picks the work up. `bm:212-217`, OLD "complete-or-blocked".
- 3.1.3 The choice between `all-completed` and `blocked-by-failures` comes from the counts, so in `onIdle: "wait"` a `shouldExit` that fires with tasks still running reports `blocked-by-failures` though nothing failed. `bm:236-239`.
- 3.1.4 `maxTotalRetries` on the item is `null` on the durable (resource-backed) backing, which counts retries but enforces no budget. `caps:75-100`, `rbt:235-257`.

### 3.2 When the worker pool stops: `onIdle`

Decided once per worker iteration by `checkBoard`; the answer is the worker's last output (3.3). `qs:1-122`, `cb:1-60`.

| `onIdle` | The pool stops when | Source |
|----------|---------------------|--------|
| `"complete-or-blocked"` (default) | **Drained**: no task is `pending` or `in_progress` (a dispatched task whose lease is live on a delegation board does not count); or **blocked**: no worker is running a task and no `pending` task is claimable (every remaining one has a non-`completed` dep, or every running one waits on a user). | `qs:111-122`, `qs:61-69`, `qt:147-153`, `tbt:1049-1105` |
| `"complete"` | Only when no task is `pending` or `in_progress`. A pending task whose dep never completes keeps every worker cycling until `maxIterations`. | `qs:114-117`, `tbt:930-1010` |
| `"wait"` | Never on its own: `shouldExit(collection)` returns `true`, or `maxIterations` trips. | `qs:111-113`, `tbt:1108-1161` |

- 3.2.1 A task waiting on a user is `in_progress` but does not occupy a worker. On `"complete-or-blocked"` a board whose only open tasks wait on a user stops `blocked` and leaves them as they are; on `"complete"` they keep the loop alive until answered. `qs:61-69`, `qt:350-404`, OLD "complete".
- 3.2.2 A plan board counts every `in_progress` task as holding the drain open; a delegation board excuses every running task whose lease is live. A lapsed lease holds the drain open again until a claim takes the row back (2.1.4). `bmode:30-36`, `qs:39-52`, `qt:427-445`.

### 3.3 What `board.drain` returns

- 3.3.1 One entry per worker, so `concurrency` entries in an array, each `{ shouldContinue: boolean, reason: "drained" | "exit" | "claimed" | "idle" | "blocked" }`: how that worker's loop ended. A finished worker's entry is `shouldContinue: false` with `"drained"`, `"blocked"` or `"exit"`. A worker that hits `maxIterations` ends with its last `checkBoard` output, `shouldContinue: true` with `"claimed"` or `"idle"` (`core`blocks/sequencer.ts:1861). `tb:1273-1281` (`.forEach` over `concurrency` workers), `O`task-board/schemas.ts:129-137, `dcf:463`, `dcf:478`, `cb:35-60`.
- 3.3.2 It does not return the tasks. The next step reads them from the list: `collection.list({ status: "completed" })` and each task's `output`. `ex:88-98` (a step after `board.drain` reads `list({ status: "completed" }).map(t => t.output)`).
- 3.3.3 `goalSeekLoop`'s own termination reasons (`converged`, `max-iterations`, `judge-error`) are separate and belong on the goal-seek page: `gslt:153`, `gslt:255`, `gslt:302`.

### 3.4 `waiting-on-a-user` inside `goalSeekLoop`

- 3.4.1 When a drain leaves a task waiting on a user, the loop ends the pass there with termination reason `"waiting-on-a-user"`: no judge, no replan, no `finalize`, and no iteration spent. `waiting-on-an-event` ends it the same way when no task waits on a user. `gsl:20-31`, `gsl:251-254`.
- 3.4.2 Run the loop again once the answer lands: its drain takes the task's next turn and the loop goes on. The list must survive the request, so this is a resource-backed board; a request-backed list does not outlive the request. `gsl:27-31`, `gsl:23-26` [source for why only resource-backed].
- 3.4.3 If an answer lands after the drain stops and before the loop reads the board, the pass drains again while a task owes a turn and none waits on a user: at most `maxIterations` such drains, none counted as an iteration. If a task still owes a turn when those run out, the pass ends as a wait on a user does, without judging. `gsl:33-40`.
- 3.4.4 `goalSeekLoop` refuses a delegation board at construction (its judge would rule on work still running). `tb:333-347` (doc), `bmt:191-203`.

## 4. Concurrency

| Setting or rule | Value | Source |
|-----------------|-------|--------|
| `concurrency` | Default `4`. The board spawns exactly this many workers, each its own claim, run, check loop. | `tb:401-405`, `tb:687`, `tb:1273-1281`, `tbt:310-332` |
| Readiness | A task is claimable when its status is `pending` (so not `held`), or it is `in_progress` with a lapsed lease or owing a turn (its last question answered, or a steer no request took); it has no open hold; and every `deps` entry is a task on the board with status `completed`. A dep id that names no task is not satisfied. | `int:932-942`, `int:1053-1063` [source for the exact rule]; OLD "Dependencies" |
| One holder | At most one worker holds a task's claim at a time; a worker that loses a race moves to the next ready task. Not exactly-once dispatch: a lapsed lease is handed out again. | `O`tasks/claim-orders/types.ts:1-25, `tbt:394-418`, `tbt:779-820` |
| Lease | A claim has a lease, default 120,000 ms (2 min), renewed while the worker is alive (every third of the span). A caller-set lease must be at least 1,000 ms. The board exposes no setting for it. | `int:1105-1130`, `tk:200-217`, OLD "What the drain reports" |
| Lapsed lease | The next claim admits an `in_progress` row with a lapsed lease and no open hold and re-claims it in place (2.1.4). | `mt:780-800`, `int:1053-1063` |
| Abandonment allowance | A task whose worker died (lease lapsed) is handed out again up to 3 times, a budget of its own, separate from `maxAttempts`. Past that it settles `errored` with `... was abandoned by its worker 3 times without completing. Not re-dispatched.` The board sets no option for it. | `int:502-512`, `int:1076-1096`, `tk:98-124` |
| Idle wake | An idle worker wakes on a `task-change` item for this board, else re-checks on a timer (0.2). A task added mid-drain (by a sibling or outer step) is taken promptly. | `pred:19-45`, `tb:1196-1231`, `tbt:821-867`, `tbt:1416-1452` |
| Claim order | See 4.3. | |
| `maxIterations` | Per-worker cap on loop-backs, default 10,000. At `concurrency: 4`, four workers may each spend it. | `tb:505-510`, `tb:1253-1256` |
| Dispatched entries | The task entry a `per-worker`, `{ key }` or `{ by }` dispatcher addresses defaults to `concurrency: "queue"` (several tasks can land in one session); a `per-task` dispatcher's entry keeps the flow default. An explicit `concurrency` on the entry wins. The in-process runner and queue workers sharing a lease backend apply it; a host handing dispatches to an external queue without one does not. | `core`flow/defineFlow.ts:960-1000, OLD "Which session a task runs in" |
| Pattern concurrency | See 10. | |

### 4.3 Claim order

- 4.3.1 Two names: `"fifo"` (default) and `"priority"`, or any `ClaimOrder` (`{ claim(collection, workerId, ctx) }`) such as the two `@flow-state-dev/orchestration` exports or your own. `O`task-board/shared.ts:27-46, `O`tasks/claim-orders/types.ts:30-45.
- 4.3.2 `fifo`: earliest-created ready task first; ties break on id. `priority`: highest `priority` ready task first (unset counts 0), ties on earliest created, then id. `O`tasks/claim-orders/fifo.ts:1-18, `O`tasks/claim-orders/priority.ts:1-34, `int:1100-1104`.
- 4.3.3 Neither claims a task with unmet `deps`: the collection's claim does that check, not the claim order. A `ClaimOptions.eligibility` predicate NARROWS the substrate's candidates and does not replace them (`O`tasks/collection/types.ts:227-259, `O`tasks/collection/method-table.ts:506-508). Round 1 left `eligibility` off the page; an earlier version said "replaces", which was untrue. `O`tasks/claim-orders/types.ts:5-22, `O`tasks/claim-orders/fifo.ts:7-11.

## 5. Retries

### 5.1 `maxAttempts` (per task)

- 5.1.1 A task's `maxAttempts` is set on its `TaskInit`, not on the board. Unset, a failure is final: the task goes to `errored`. `ti:42-47`, `tk:48-56`.
- 5.1.2 When a worker throws and the task has attempts left, the task goes back to `pending` (status change `in_progress -> pending`), its `error` is cleared, and the error text is kept as `feedback`, which reaches the next attempt on `TaskWorkerInput.feedback`. The next claim starts a new attempt. `mt:658-682`, `wt:74-75`.
- 5.1.3 "Attempts left" is `attempts - abandonments < maxAttempts`. `attempts` counts every claim, including the one after a worker died; the attempts that spend `maxAttempts` are `attempts - abandonments` (two counts, stated on the page in one line). An answer to a question and a message each take a turn on the same attempt and use none. `int:515-545`.
- 5.1.4 `maxAttempts` can be edited only before the task first starts. `fr:37`.
- 5.1.5 A conversation-result task (`resultTo: "conversation"`) has one attempt: `maxAttempts` unset reads as 1; any other value is refused at filing (`conversation_result_one_attempt`). `ti:85-90`, `fil:31-32`.
- 5.1.6 `TaskEndsForGoodError(message, { taskId, ending? })` from `@flow-state-dev/orchestration/task-board`: a worker that knows a failure would repeat throws it, naming the task it works. The board ends that task on this attempt, `errored` by default or `cancelled` with `{ ending: "cancelled" }`, with the message as the reason; no retry; the dependents and filed work cascade as for any ending. It counts only for the task it names; a board nested in a worker that rethrows one about its own task is an ordinary failure to the outer task. `rr:158-177`, `rr:454-461`, `T`task-board/record-error-ends-for-good.test.ts.
- 5.1.7 `retryTask` (action only) puts an `errored` or `cancelled` task back to `pending`. It keeps `maxAttempts`: a task with tries left keeps them, a task with none gets exactly this one more. A failure's `error` becomes the next attempt's `feedback`; a cancel's reason does not. The retry is counted in the task's `retryLedger`. `int:430-495`.

### 5.2 `maxTotalRetries` (per board)

| Fact | Source |
|------|--------|
| Default `50`. `null` is unbounded; `0` runs every task once and never retries; omitting reapplies the default. Valid: a nonnegative integer or `null`. | `caps:243`, `caps:262-278`, `rbt:98-128` |
| It counts failure retries the board grants, across every task: the sum of each task's `retryLedger.granted`. No stored counter. `reclaim()` and `release` also return a task to `pending` and do not spend it. | `caps:37-53`, `caps:216-230` |
| The budget is spent when the retry is granted, not when it runs. | `caps:222-228` |
| At the bound the next task that fails goes to `errored`, with `error` = `<error> — not retried: collection "<id>" has spent its retry budget of <n> (maxTotalRetries). Raise it, or pass null to opt out.` and `retryLedger.deniedByBudget: true`. The drain counts it as resolved and ends normally. A first attempt is never refused at any value. | `int:704-722`, `mt:658-700`, `rbt:317-360` |
| Per-task record: `task.retryLedger = { granted, deniedByBudget }`; absent on a task that never failed or was stored by an older version. Read `task.retryLedger?.granted ?? 0`. | `tk:62-96` |
| Applies only when the board builds its own collection (request default, sequencer opt-in). Beside a supplied `defineTaskCollection` or factory it throws. | `tb:1389-1411` |
| On the durable (resource-backed) backing, retries are counted and the bound is not enforced; the item reports `maxTotalRetries: null`. | `caps:75-100`, `rbt:235-257` |
| A direct `getOrCreateTaskCollection({ backing: "state" })` with no `maxTotalRetries` applies no bound at all (not 50). | `caps:180-196` |
| `retryTask` is refused `retry_budget_spent` where the budget is enforced and spent. | `tt:2261`, `int:459-466` |
| A retry that keeps happening because `reclaim()` re-pends a task never advances `attempts` or spends the budget; `maxIterations` ends such a loop. | `caps:25-31`, `tb:505-510` |

### 5.3 Creation bounds (not retries, but the same family)

| Bound | Default | Counts | Refund | Source |
|-------|---------|--------|--------|--------|
| `maxEnqueuedTasks` | `100`, or the lifetime cap if that is lower (5.3.4) | tasks added while others are `pending`, checked at creation against the resulting `pending` count | a slot frees when its task leaves `pending`; a stranded task keeps its slot | `caps:11-17`, `caps:221-224`, `caps:341-346` |
| `maxTotalTasks` | `500` | every task ever on the list, finished ones included | never | `caps:15-18` |

- 5.3.1 Past either bound, creating a task throws `TaskCapExceededError` with `cap` (`"enqueued"` or `"total"`), `limit`, `attempted`, and writes nothing. A batch `createTasks` is all-or-nothing on the request and sequencer backings. The `createTask` tool answers `{ ok: false, error: "enqueued_task_cap_exceeded" }` or `"total_task_cap_exceeded"`. `caps:134-166`, `tt:445-452`, `capt:132-176`, `capt:434-458`.
- 5.3.2 This is "the per-request cap on filed tasks": on a request-backed board the list ends with the request, so 100 pending / 500 total apply per request. `caps:56-58`.
- 5.3.3 The enqueue bound applies only when a task is created. A task returning to `pending` (retry, release, reclaim) is not bounded, so `pending` can exceed `maxEnqueuedTasks`; `maxTotalTasks` is the hard ceiling. `caps:25-31`.
- 5.3.4 Defaults: an omitted enqueue bound is `min(100, maxTotalTasks)` when the total is a number, so `maxTotalTasks: 50` alone is accepted. An explicit enqueue bound above the lifetime bound throws. `0`, a negative, a fraction, `NaN`, `Infinity` throw. `caps:285-304`, `caps:341-346`, `capt:178-232`.
- 5.3.5 How long the counts last: all three are read off the stored task map when checked (size, `pending` count, sum of `retryLedger.granted`), so they last as long as the map: the request (fresh each request); a sequencer's state (restored on resume, task map included, so counts come back); a generator's own state is not checkpointed, so its counts start over after a resume; durable (resource-backed): no bound enforced, `maxInstances` on `defineTaskCollection` is a capacity limit instead (caps how many task instances exist at once; deleting frees a slot; creation is one instance at a time, so a batch crossing it stops partway). `caps:37-100`.
- 5.3.6 Bounds belong to the one collection reference the board built. A second ref over the same list built without `board.caps` enforces none. `createApplyReplan` with `capability: board.capability` uses the board's; with only `name` it enforces none. `caps:123-132`, `tb:423-428`, `ar:66-96`, `capt:249-307`.
- 5.3.7 The caps options exist only on `backing: "state"`; passing them with `backing: "resource"` is a TypeScript error. `goc:82-100`.
- 5.3.8 A planned or replanned set that crosses a bound is refused as a whole: the board stays empty (seed) or untouched (batch). `capt:369-400`, `capt:434-458`.

### 5.4 Recorder failure (a result the board could not write down)

- 5.4.1 If the store committed a result and announcing it failed, the board emits a persisted `task-board-recorder-failure` item, `data: { collectionId, taskId, recorder: "complete" | "fail", verdict: "committed" | "undetermined", error }`, no key (each failure is its own entry), and the drain fails after every other task finished, whatever `onError` says. `rr:183-260`, OLD "When the board cannot record a result", `T`task-board/recorder-equivalence-matrix.test.ts.
- 5.4.2 `undetermined` is a permanent answer on a hand-written `TaskCollectionRef` and on rows an older board stored with no write record. `O`tasks/write-provenance.ts [source].
- 5.4.3 The `chatAssistantRenderers` registry maps the item to `false` (not shown in a chat thread). OLD "When the board cannot record a result".
- 5.4.4 A hand-written ref must honour the optional `TaskTransitionOptions` third argument on `complete` and `fail`, or a late result is not declined. A ref that throws instead is contained: the late result is dropped and the drain goes on. OLD "A task store of your own", `rr:21-27`.
- 5.4.5 A result that arrives for a task that already moved on (cancelled, settled by the worker itself, claim taken by another worker) is dropped silently, one task only. `rr:21-27`, `tbt:395-418`.

## 6. Where the list is stored and how long each choice lasts

Four backings, chosen once on `collection`. `board.backing` reads it back. `tb:349-362`, `tb:567`.

| Choice (`collection:`) | Backing | Lasts | Who can reach it | Source |
|------------------------|---------|-------|------------------|--------|
| omitted, or `{ collectionId?, stateKey? }` or `{ backing: "request", ... }` | `"request"` | The request. A new request starts empty. Survives every block boundary in the request, including a second `board.drain` in the same request (a replan loop) and adds from sibling steps before or during the drain. | Any block in the request that lists `board.capability`; any block that resolves it by `collectionId` (`getOrCreateTaskCollection({ ctx, backing: "state", collectionId })`). | `tb:261-281`, `tb:1597-1612`, `tbt:1416-1494`, `tbt:1609-1783`, `ex:48-98` |
| `{ backing: "sequencer", collectionId, stateKey? }` | `"sequencer"` | One `board.drain` invocation; two calls give two independent lists. The parent sequencer's `stateSchema` needs a `Record<string, Task>` slot at `stateKey` (default `"tasks"`); `taskBoardStateSchema` has that shape but is exported only from `@flow-state-dev/orchestration/internal` (`O`internal.ts:94), so the page does not name it. | Blocks inside the board's own sequencer; the capability throws from outside the subtree. | `tb:283-295`, `tb:1556-1596`, `tbt:1316-1337`, `caps:59-64` |
| `defineTaskCollection({ id, scope, ... })` | `"resource"` | Stored as resources: outlives the request, at the scope named. Nothing is enforced for `maxTotalTasks`, `maxEnqueuedTasks` or `maxTotalRetries`. | By `scope`: `"session"` one session (a dispatched run's session sees an empty one unless `sharedToLineage: true`); `"user"` one user within one organization, every flow of theirs unless isolated; `"org"` one organization. | `dtc:155-200`, `tb:1511-1555`, `tbt:1495-1608`, `docs-revamp/pages/reference/resources.md:142-159` |
| a function `(ctx) => TaskCollectionRef` | `"factory"` | Whatever your store does. `collectionId` is the literal `"factory-supplied"`. The board applies no caps. | Whatever your store allows. | `tb:297-299`, `tb:1493-1510`, `capt:341-367` |

How many exist (the "how many" question), per part:

| Part | Who owns it | Who can see it | Where it is stored | How many |
|------|-------------|----------------|--------------------|----------|
| The list on the request | the request | blocks in the request | `ctx.request.state[stateKey]`, `stateKey` defaulting to `collectionId`, which defaults to the board `name` | one list per `collectionId` in one request; two boards with distinct names get distinct lists |
| The list on a sequencer | the `board.drain` call | blocks inside that sequencer | the sequencer's state at `stateKey` | one per invocation |
| The list as resources | the resource's scope owner (session, user or org) | the users its scope names (session: that session; user: that user in that organization; org: that organization) | the store, one resource instance per task at `<id>/**` | one list per `id` per scope instance (per partition if `partitionBy`); at most `maxInstances` tasks if set |
| A task entry | the list it is in | per the list | in the list | one entry per task; at most 20 messages and 20 questions per task |
| Its `task-change` and `task-board-meta` items | the request that made the change | the client (`client: true`), not the model's history (`history: false`) | the request's item stream | one `task-change` stream key per task (latest wins); one `task-board-meta` key per `collectionId` |
| The tool-result cache | the board run | the board run | in memory, torn down when the run ends | one per run |
| The retry count | derived from the list | per the list | none: the sum of `retryLedger.granted` over rows | none |

`defineTaskCollection` options (`dtc:97-190`):

| Option | Type | What it does |
|--------|------|--------------|
| `id` | `string` | Required. A single plain segment (no `*`, `[param]`, `/`). Forms the resource pattern `<id>/**`, the `ctx.resources` key and the board's `collectionId`. |
| `scope` | `"session" \| "user" \| "org"` | Required. How long and for whom the list lasts. |
| `sharedToLineage` | `boolean` | Session scope only (rejected at user or org). One list for a conversation and every session dispatched under it. |
| `partitionBy` | `(identity) => string` | `user` scope only; not with `maxInstances`. One set of rows per partition; task ids one path segment. The function gets only the server-set identity `{ sessionId, lineageId, userId, orgId, tenantId }`. A session id is reused when a session is recreated, so build the partition from `sessionId` and `lineageId` together. Rows load a partition at a time. Declares a `byTaskId` index. |
| `stateSchema` | Zod schema | Types each task's `input`. Default `z.unknown()`. |
| `maxInstances` | `number` | Most tasks held at once; creating past it throws. Not a lifetime cap. |
| `recordEnding`, `settings`, `cascadeFiled`, `delivery` | functions/objects | Composing-layer hooks (Workforce uses them); the page names them in one line each or leaves them to the Workforce pages. |

- 6.1 `taskToolActions` throws for a board on any backing but a `defineTaskCollection`. `tt:2447-2460`.
- 6.2 Block-level state: including the board in a flow installs its collection resources on both the drain and `board.capability`. OLD "Durable boards that survive across turns".
- 6.3 A `session`-scoped board with `sharedToLineage: true` can hand rows to sessions on its own flow; to hand rows to another flow, use a `user`-scoped collection with `partitionBy`, served on the receiving flow with `taskLedgers({ resolve })` (the resolve's third argument is the partition). The rows sit in user scope, readable by every flow of that user even under `isolateUserState`. `dtc:97-160`, `dtc:279-300`, OLD "A board per conversation, worked on another flow".

## 7. Assignees that dispatch

### 7.1 Mode

| `mode` | Rows run | The drain waits on | Source |
|--------|----------|--------------------|--------|
| `"plan"` (default) | in the drain, or handed to another session through an assignee that dispatches or `newSession`, which the drain then waits on | every task | `bmode:10-14`, `tb:328-347` |
| `"delegation"` | in another session, through a dispatcher assignee | no task; it returns once each task is on its way, and the session working a task settles it | same |

`board.mode` reads it back. A mismatch throws at `taskBoard()`: `bmode:55-100`, `bmt:76-190`.

### 7.2 Assignee resolution (inline or dispatched)

| Case | What happens | Source |
|------|--------------|--------|
| `workers` is one block | Every claimed task runs in it. | `tb:364-377` |
| `workers` is a registry, the task's `assignee` matches | Runs on that worker. | `tbt:469-512` |
| Assignee unknown or absent, `defaultWorker` set | Runs on `defaultWorker`; a task dispatcher there hands the task over under the assignee the task names, and a task with no assignee fails. | `tb:379-388`, `tbt:549-640`, OLD "Worker registry" |
| Assignee unknown or absent, no `defaultWorker` | The task fails per `onError`. | `tbt:513-548`, `tbt:750-777` |

The task tools can refuse a bad assignee at filing if given a roster (8.2). Without one, any assignee is accepted.

### 7.3 What an assignee that dispatches is

- 7.3.1 An assignee is a `dispatcher({ name, action, session, flowKind?, state?, wait? })` from `@flow-state-dev/core` where a worker block would go. The drain claims a row, dispatches it to a dispatch run, and moves on; the row stays `in_progress` until the run settles it. `dispatcher` stamps its own `type: "task"`; leave it unset. `tb:370-376`, `dt:270-292`, `core`types/dispatch.ts:74-110.
- 7.3.2 The worker is declared once on the flow under `task: { actions: { <name>: { block } } }`; the dispatcher's `action` names it. A task entry takes the same fields as an action (`inputSchema`, `concurrency`, `onCompleted`, `onErrored`, ...) minus `description` and `mcp`. No client can call it. OLD "Assignees that dispatch".
- 7.3.3 The entry receives the same `TaskWorkerInput` an inline worker does (`taskId`, `goal`, `title`, `context`, `input`, `deps`, `attempts`, `feedback`, `steers`, `followUpOf`, `metadata`, `sealed`, `priorWork`, `attachments`). `wt:39-129`.
- 7.3.4 `defineFlow` throws for: a flow that holds such a board without its pass entry (`delivery.passEntry ?? onTaskSettled` on a plan board, `onTaskSettled` otherwise; a `newSession` dispatch requires none; `O`task-board/index.ts:891-892, 917-922); a dispatcher `action` the flow does not declare under `task.actions`; a `task.actions` entry no board dispatches to and no `from` serves; a task dispatcher reachable from an action without sitting on a board; two boards dispatching to one entry; an entry with `from` that a board in the same flow also dispatches to; an entry block that declares `sessionStateSchema` (root or composed child). `core`flow/defineFlow.ts:960-1010; OLD "What the board requires".

### 7.4 What the board requires (`taskBoard()` throws, naming board and assignee)

| Requirement | Source |
|-------------|--------|
| `mode: "delegation"`, and every assignee dispatches (named and `defaultWorker`). A uniform inline `workers` block is refused on a delegation board (`bmode:82-90`) and a uniform dispatcher can never dispatch, so a delegation board needs a registry | `bmode:80-100`, `bmt:142-190` |
| `boardId` is set | `da:285-297` |
| `collection` is a `defineTaskCollection()` (request, sequencer and factory are refused; a request or sequencer list ends before a dispatched run settles its task). The throw reads `[task-board] "<name>" dispatches assignees (<names>) on a <backing>-backed collection ... must be durable. Pass a defineTaskCollection() to \`collection\`.` | `da:299-309` |
| A `session`-scoped collection declares `sharedToLineage: true`; `user` and `org` need nothing extra | `da:311-328` |
| The dispatcher sits at a named registry entry or `defaultWorker`; a uniform `workers` block cannot be a dispatcher (`assertDispatchBoardSupported` throws), so a delegation board always has a registry | `da:226-236`, `da:277-283` |
| A plan board's dispatcher does not say `wait: false`; a delegation board's does not say `wait: true`; a delegation board has no inline assignee and at least one dispatcher (the page lists the last as its own row) | `bmode:64-100`, `bmt:87-190` |
| `newSession` is a task dispatcher and only on a plan board | `tb:1337-1365` |

- 7.4.1 A board that dispatches freezes the assignee on an `in_progress` task: `setAssignee` declines with `immutable-assignee`. A pending or held task can change hands. The rule belongs to the collection, so a second board over the same `defineTaskCollection` follows it. `goc:96-100`, `dtc:350-370` (`freezeLedgerAssignee`), `tb:1318`, OLD.

### 7.5 Which session a dispatched task runs in (`session`)

| `session` | How many runs | Source |
|-----------|---------------|--------|
| `"per-task"` | one per task; a follow-up task (`followUpOf`) runs in the session of the task it follows | `core`types/dispatch.ts:76-111, `core`types/dispatch.ts:326-345 |
| `"per-worker"` | one per assignee, shared by every task it runs | same |
| `{ key: (task, ctx) => string }` | one per distinct key; a key function returning an empty string fails the task | same, `:346-360` |
| `{ by: (task, ctx) => { key } \| { id } }` | chosen per task: a keyed run, or an **existing** session by id (never created; `session-not-found` or `session-not-addressable` if missing or not the principal's or flow's; an answer that is not exactly one non-empty `key` or `id` fails the task) | `core`types/dispatch.ts:111-120, `:366-410` (`resolveTaskSessionTarget`, `chooseTaskSession`) |

- 7.5.1 The two presets fold `boardId` into the key, so two boards' runs stay apart. A custom `key` is used as returned: two assignees or boards returning one string share a session, scoped to the dispatching conversation and, for a cross-flow assignee, the named instance. `core`types/dispatch.ts:76-88.
- 7.5.2 A task keeps its session for its whole life; when a worker asks a question, the answer brings it back to that session on the same attempt. OLD.
- 7.5.3 `flowKind` may be a function `(task, ctx) => string | undefined | Promise` on a `task` dispatcher; it must use `session: "per-task"` (any other policy throws when the dispatcher is built); only a `task` dispatcher takes a function. Returns `undefined`/empty: `DispatchRefusedError` with `refused: "flow-not-found"`, naming the assignee. A task with no assignee at the fallback is refused the same way. A function that throws fails the attempt. Put it at `defaultWorker`. `core`types/dispatch.ts:176-222, OLD "Sending a task to a flow chosen per task".
- 7.5.4 `action` may be `{ among: string[], by: (task, ctx) => string }`; `by` may be async; every name in `among` is checked at `defineFlow` and must be under `task.actions`; a `by` answer outside `among` fails the task with `refused: "no-entry"` before anything is sent. `core`types/dispatch.ts:111-135, OLD.
- 7.5.5 A `state` on the dispatcher (a fixed object or `(task) => object`, receiving `assignee`, `taskId`, `input`) is the starting state of each **new** run; the target flow's `stateSchema` and `createCheck` accept or refuse it; an existing run keeps its own. With none, a flow that needs it refuses every new run: the task fails `create-refused`. A `{ id }` answer from `{ by }` ignores `state`. `core`types/dispatch.ts:637-670 (`resolveTaskState`), OLD.
- 7.5.6 Refusals a dispatch can answer: `no-entry`, `flow-not-found`, `session-not-found`, `session-not-addressable`, `key-occupied`, `create-refused`, `no-dispatch-operation`, `dispatch-rejected`, and `external-flow-runner` (a `{ by }` answer of `{ id }` on a host that runs flows on an external job queue that does not share leases, which the page words that way and links to Concurrency "Where a policy holds"; internally: an `id` delivery where the runner hands work to an external queue and the worker adapter has no shared lease backend; `core`types/dispatch.ts:511). `DispatchRefusal` also has `no-sender`, reachable only from a `{ from: true }` target, which task dispatch never builds, so the page omits it. `core`types/dispatch.ts:478-516. A refused dispatch fails the task through the board's ordinary error path; the same `DispatchRefusedError` (`refused` code) a `dispatcher()` block throws, so `.rescue()` reads it either way.

### 7.6 What the dispatch returns and when a dispatched task is done

- 7.6.1 The dispatch block returns `{ dispatched: true, taskId, sessionId, requestId, adopted }`. `adopted` is `false` when the dispatch created the session, `true` when it re-entered one. `requestId` is the one value that is always one per dispatch; `sessionId` is the run (shared under `per-worker` and `{ key }`, and under `per-task` it identifies the row, so a retry re-enters it). The task's worker input must survive a JSON round trip: a `Date`, `Map`, class instance or `undefined` in object position fails the task naming the path. `dt:270-292`, OLD.
- 7.6.2 The row gains `run: { sessionId, requestId, attempt, startedAt? }` when the run starts. Cleared by the next claim; a finished task keeps the run that last worked it. Read the session's `flowId` for the run's flow. Not set on inline tasks. `tk:265-312`, `T`task-board/run-link-gate.test.ts.
- 7.6.3 The run settles its task once, when all its work is over: its request ended, with any `.sideChain()` work it started and any its `onFinished` started; every task it filed has ended and its session has heard each ending. Until then the task is `in_progress` with `keptOpenBy`: `"filed"` (tasks it filed not ended or not yet heard), `"suspended"` (its request is suspended: `ctx.suspendForUser()`, `ctx.suspend()` or an external event), `"steer"` (a message no request has taken). A kept-open row has no lease, is not handed out again however long the wait, including across a restart. A stop for a user is also listed in `holds`. `tk:497-525`, `T`task-board/settles-when-its-work-is-over.test.ts.
- 7.6.4 Output: the latest `reportProgress` checkpoint; with none, the last answer that counts: the entry's, or a later request's under `taskRequestAdmission({ answerCounts: true })` with `noteTaskAnswer` tapped after the step. `tk:329-345`, OLD "Requests that work on a waiting task".
- 7.6.5 A step in `.sideChain()` that throws in any request working the task fails the attempt, though the request reports `completed`; read the task. A cancel stops that rule; a dropped client connection is not a cancel. OLD.
- 7.6.6 If the board cannot record the result, the dispatch run's request reports `failed`. Its stream gets the terminal status only after the check. `onFinished` runs before it. OLD, 5.4.
- 7.6.7 Stopping the host waits for a request working a dispatched task until it records an outcome (settled, failed, or waiting), within `shutdownDrainMs` (default 10 s) shared with wake requests; past it the host shuts down and logs how many hadn't. OLD.
- 7.6.8 The row's stale-claim checks: on arrival the run re-reads the row and runs the worker only if the claim is current (same attempt, same row, still `in_progress`, still this assignee); otherwise `StaleTaskClaimError` (`code: "stale-task-claim"`), nothing written. A claim whose lease lapsed in a host queue is renewed on the same attempt; refused only if a drain already reclaimed it. `te:122-140`, `te:610-640`, OLD.
- 7.6.9 `onError` reaches the run: `"fail"` fails the dispatch run (request `failed`); `"skip"` leaves it `completed` with the error on the task. OLD "Concurrency and error handling".

### 7.7 How a dispatched task's ending is heard

- 7.7.1 The flow declares `internal: { actions: { onTaskSettled: taskSettledEntry({ block, concurrency?, defer? }) } }`; `block` has `inputSchema: taskSettledInputSchema`. It runs once per ending in the session that filed the task. Default concurrency on the session is `queue`. `ntc:1-100`.
- 7.7.2 Notice fields: `boardId`, `taskId`, `attempt`, `ending` (`completed`, `errored`, `cancelled`; see 0.10), `output` (completed), `error` (errored), `cancelled` (ids of dependents the ending cancelled that the same session filed; those dependents send no notice), plus `question` and `waitedOn`. `ntc:52-66`.
- 7.7.3 No notice when: the task failed and will retry (nothing until its last attempt ends); the filer waited on it with `getTask({ id, wait: true })` (open at the ending, or started after it ended but before an `onTaskSettled` request for it started); the filer's own model cancelled it with `updateTask` in its own turn (the tool result told it). A cancel from a person, an app's action, or a cascade from another session's task does send one. OLD "Hearing how a task ended".
- 7.7.4 Delivery: held while the filing request runs, sent when it ends; at a park (approval, input, a `getTask` wait) a task ending during the park sends right away and one held goes out about two seconds after. Needs a host with durable execution; elsewhere a notice is sent as soon as the task ends. A notice a crash lost is sent again about two seconds later or when the server is back, by the sweeper running `onTaskSettled` in the filing session with empty input (your block is not called for that request). `ntc:16-40`, OLD.
- 7.7.5 The block runs once per ending; if it throws the notice stays owed and runs again, never beside a running copy. If the filing session no longer exists, or the notice has been owed longer than `maxDebtAgeMs`, the task records `metadata["noticeUndeliverable:<attempt>:<ending>"] = { at, detail }` and gives up. `O`tasks/notice/task-notice.ts:804, OLD, `eng`flowstate/createFlowState.ts:1112.
- 7.7.6 On interruption a held notice goes out when the request is marked `interrupted` (default within about 90 s of its last heartbeat; `staleSweepThresholdMs`, `staleSweepIntervalMs`). OLD.
- 7.7.7 Board notices (live views): each change publishes a `board` notice on the filing session's topic narrowed to the board id, whichever session or process made the change, including a delegate's own task session; it carries only the changed task's id. A row added also goes out on the board's own scope topic (session, user or org) so a view hears a row filed from a session it never named; on a partitioned ledger both name the partition as an opaque key. `core`types/board-notice.ts:1-85.

### 7.8 One entry, many boards: `taskLedgers`

`taskLedgers({ name, resolve, uses?, onError?, endRules?, allowSessionState? })` builds a task entry's `from` value; any board in any flow can then hand it tasks. `resolve(ledgerId, ctx, partition?, taskId?)` returns the ledger or `undefined`. The ledger id is the sending board's `boardId`. An unanswered id is refused `UnknownTaskLedgerError` (`code: "unknown-task-ledger"`). An entry with `from` that a board in the same flow dispatches to is refused at `defineFlow`. `onError` default `"skip"`. `allowSessionState` accepts an entry whose blocks keep session state. `te:560-640`, `T`task-board/task-ledgers.test.ts, OLD "A task entry served by many boards".

## 8. Task tools

Five tools; four belong to whoever files work, one to the worker: `createTask`, `getTask`, `listTasks`, `updateTask`, and `reportProgress` (worker only, offered only on a turn working a task, takes no `id`). `retryTask` exists only as an action. `tt:1460-1465`, `tt:1647`, `tt:1986-2005`, `tt:2210-2214`, `tt:2205-2209` ("filer's four; an action gets a retry").

- 8.0.1 `createTaskToolsCapability(resolve, roster?, { dispatches?, resumesWaits? })` points the filer's tools at a board; `dispatches: true` only for a board that starts a ready task on filing; `resumesWaits: true` only when the board also hands tasks out and the flow declares `onTaskSettled`. Without `resumesWaits`, `getTask` is not offered `wait`. `tt:2330-2380`.
- 8.0.2 `taskToolActions(board, roster?)` or `taskToolActions(collectionId, resolve, roster?)` offers the filer's four plus `retryTask` as flow actions, named `<tool>_<suffix>` where the suffix is the collection id with every character outside `[a-zA-Z0-9_-]` turned into `_` (`eng.work` gives `updateTask_eng_work`). Public actions: anyone who can call the flow can call them. The roster may be a function of the block context. `O`skills/task-tool-suffix.ts:1-30, `tt:2420-2480`.
- 8.0.3 How a task starts when filed: on a board that starts work on filing (a conversation's board in Workforce), `createTask` starts a ready task at once and returns its id without waiting; `held: true` files it unstarted until `updateTask({ id, status: "pending", assignee? })`. On a board a drain runs, `createTask` files a task the drain starts when it claims it. `tt:1560-1595`, `tt:2347-2360`, OLD "Giving another worker work".

### 8.1 `createTask` fields and result

Fields (`tt:1175-1246`): `goal` (required), `title`, `context`, `assignee`, `deps`, `priority`, `input`, `labels`, `metadata`, `followUpOf`, `held`, `questions` (strings or `{ kind: "question" | "confirm", prompt, onNo? }`), `session` (`"new" | "ongoing"`), `resultTo` (`"filer" | "conversation"`), `target`, `maxAttempts`.

Result: `{ ok: true, taskId, status?: "held" }` (`status: "held"` only when filed held) or `{ ok: false, error }`. `tt:1464-1470`.

| Error (`error` string starts with) | When | Source |
|------------------------------------|------|--------|
| `no_delegation_board` | the tools' resolver finds no board for this caller | `tt:143`, DW 58 |
| `unknown_assignee` | the roster does not name the assignee; the message lists who is available; nothing stored | `tt:372-380` |
| `assignee_required` | a roster that names several workers, no default worker claims unassigned tasks, not held | `tt:395-402` |
| `already_open` | the same goal for the same assignee and workstream target while a task for it is still open; names that task | `tt:1295-1310` |
| `create_task_does_not_wait` | `waitForResponse`, `wait` or `timeoutMs` passed | `tt:1475-1485` |
| `enqueued_task_cap_exceeded`, `total_task_cap_exceeded` | 5.3.1 | `tt:445-452` |
| `task_files_not_kept` | the turn's files could not be kept with the task | `tt:1546-1552` |
| a `TaskFilingRefusedError` rule code (2.3.5, `follow_up_takes_no_session`, `follow_up_takes_no_target`, `follow_up_takes_no_result_to`, `conversation_result_one_attempt`, `setting_not_supported`, `setting_not_from_task_session`, `follow_up_of_unrun`, `duplicate_task_id`, `parent_cancelled`, `questions_not_kept`) | the filing breaks a board rule | `fil:16-47`, `tt:1453` |
| a follow-up that names an assignee | refused at input | `tt:1488-1492` |

Defaults a roster-less board gives: every assignee is accepted. `tt:386-394`. A task filed by a worker's turn records `filedByTask` (server-set). `tt:1442-1458`. `createTask` with the same goal and assignee filed twice (a retried call) does not start the work twice. `tt:1295-1310`.

### 8.2 `updateTask`: the per-field rule

One rule per field, checked inside the write (`fr:1-75`, `fr:23-46`):

| Field | Allowed |
|-------|---------|
| `goal`, `title`, `context`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts` | Before the task first starts (never claimed). A task back in `pending` after a failed attempt stays locked. |
| `status: "held"`, `status: "pending"` | Before the first start: hold, or release a held one. |
| `status: "cancelled"` | Until the task finishes. Sent alone. |
| `message` | Until the task finishes. Sent alone. At most 20 per task. |
| `answers` (+ `message` for a question, `done` for a confirm) | While that question is open. Sent alone. |
| `session`, `resultTo`, `target`, `followUpOf`, `attempts` | Never. The three filing settings are refused `filing_setting_fixed`. |

- 8.2.1 Flat fields beside `id`. `labels` and `deps` and `input` replace the whole value; `metadata` merges its keys over the task's. `tt:1596-1607`, `tt:1647-1665`.
- 8.2.2 A refusal is a result, not a throw; it names the field, the state and the next move; nothing is written. A task that starts between read and write is refused.
- 8.2.3 `message` text: kept on the task in order as a steer, `from` the filer, a user, the board or a service; reaches the work without using an attempt, ending the task or changing status. A finished task takes none (file a follow-up). `getTask` lists them as `steers` oldest first with `at`, `answers?` and `taken`. `MAX_STEERS` = 20. `steer.ts:10`, `tt:2054-2080`, `tt:1980-1984`.
- 8.2.4 Where a message lands: filed not started, the first attempt's brief carries every message after the goal; running, the worker takes it before its next model call in the same turn (a coding run on a harness manager at its next step); waiting on tasks it filed, a turn starts with the message while those keep running (on a Workforce conversation's board a session runs one turn of a task at a time); after the worker's last model call, the task gets one more turn before it settles, which needs a board with a steer turn (`taskLedgers({ endRules: { steerTurn: { entry } } })`; a Workforce conversation's board has one; without one a late message stays untaken). OLD "Sending a message to an open task".

Refusals (`error` begins with the code; `{ ok: false, taskId, error }`):

| Code | When | Source |
|------|------|--------|
| `field_locked_after_start` | an until-start field on a started task; names the fields and the status | `tt:1639-1646` |
| `task_finished` | any write to a finished task, a message included | `tt:1620-1640` |
| `cancel_takes_no_edits` | `status: "cancelled"` sent with another field | `tt:1710-1722` |
| `message_takes_no_edits` | `message` sent with a field or a status | `tt:1724-1736` |
| `nothing_to_update` | no field and no status beside `id` | `tt:1737-1745` |
| `filing_setting_fixed` | `session`, `resultTo` or `target` sent | `tt:1693-1703` |
| `unknown_assignee` | an assignee the roster does not name | `tt:372-380` |
| `steer_limit` | a message to a task that already holds 20 | `tt:1976-1986` |
| `message_not_supported` | the board's list keeps no messages | `tt:1800-1808` |
| `no_such_question` | an `answers` id that is not an open question or confirm of the task | `tt:1894`, `tt:1940` |
| `wait_is_not_a_question` | `answers` names the task's external wait | `tt:1896-1900` |
| `question_answered` | other words for a question already answered (the same answer again is a success that writes nothing, even on a finished task) | `tt:1936-1941`, OLD |
| `question_is_the_users` | the filer's tool answering a question the user answers from their Inbox (filed-at-filing questions, and any midway question on a task routed to a workstream) | `tt:1902-1908` |
| `question_takes_message` | a question answered without `message`, or with `done` | `tt:1918-1922` |
| `confirm_takes_done` | a confirm answered without `done` | `tt:1910-1914` |
| `done_without_answers` | `done` sent without `answers` | `tt:1880-1883` |
| `answer_takes_no_edits` | an answer sent with a field or a status | `tt:1883-1888` |
| `questions_not_supported` | the board's list keeps no questions | `tt:1924` |
| `task_not_found` | no such task, or one the caller cannot reach | `tt:144`, `tt:1905` |

### 8.3 `getTask`, `listTasks`

- 8.3.1 `getTask({ id })` returns the task whole: goal, title, context, status, assignee, deps, priority, labels, metadata, attempts, maxAttempts, session, resultTo, target, input, output (with `checkpoint: true` when it came from `reportProgress`), statusNote, error, `keptOpenBy`, `holds`, followUpOf, filedByTask, run, completedAt, `steers`, and `current` (latest completed follow-up's `id` and `output`). `input`, `metadata` and `output` longer than 20,000 characters as JSON come back cut to 20,000 with `inputCut`, `metadataCut` or `outputCut` set. An unknown id: `{ ok: false, error: "task_not_found", taskId }`. `tt:152`, `tt:222-290`.
- 8.3.2 `listTasks` lists tasks without their output; each row carries the worker's latest status note. Filters include `status`, `filedByTask`. A task you wait on shows `waitedOn: true`. `spend` is on the action's rows only, absent from the model's tool. `tt:1986-2003`, `O`skills/task-listing.ts, OLD.
- 8.3.3 `getTask({ id, wait: true, deadline? })`: a turn pauses until the task ends or the deadline; default 5 minutes; the server sets bounds (1 s to 24 h by default); out of range is refused, never clamped. At the deadline the turn carries on with the task as it stands, nothing cancelled. A wait is one per step; nests at most 5 deep (`MAX_WAIT_DEPTH`); one waiter per task. While an `onTaskSettled` request for that ending is running or parked the wait returns `{ ok: true, taskId, arrivesAsNotice: true, message }`. Needs a board that wakes a waiting turn and a host with durable execution, the sweeper, and a store that keeps wakes; elsewhere `wait` is not offered. `eng`durability/wait-chain.ts:67-90, `core`types/wait-gate.ts:60, `O`tasks/helpers/wait-on-task.ts:120-140, `T`tasks/wait-lapsed-across-a-park.test.ts.

| Wait refusal | When | Source |
|--------------|------|--------|
| `wait_not_filer` | your session did not file the task | `O`tasks/helpers/wait-on-task.ts:130 |
| `wait_on_conversation_result` | the task's result goes to the conversation | `:132` |
| `wait_taken` | another request already waits on it | `:136` |
| `wait_on_plan_step` | a plan board handed the row over and the drain waits on it | `:138` |
| `wait_already_pending` | this step already waits | `:134` |
| `wait_too_deep` | the chain would pass 5 | `:140` |
| `wait_deadline_out_of_range` | `deadline` outside the bounds | `:127` |
| `deadline_without_wait` | `deadline` without `wait` | `tt:2128-2133` |
| `wait_unavailable` | this server or board can't hold a wait | `tt:2160-2167`, `:125` |

### 8.4 `retryTask` (action only)

Input `{ id }`. Result `{ ok: true }` or `{ ok: false, taskId, error }`; nothing written on refusal. The error starts with the code (`tt:2248-2275`):

| Code | Meaning |
|------|---------|
| `task_finished` | the task completed; a completed task never reopens: file a follow-up |
| `not_finished` | the task is still open |
| `dependency_ended` | a task it depends on failed or was cancelled: retry that first |
| `settling` | its last ending is still being passed on; try again in a moment |
| `retry_budget_spent` | `maxTotalRetries` is spent on a collection that enforces it |
| `task_not_found` | no such task, or one the caller can't reach |
| `retry_not_supported` | the board's list has no retry |

### 8.5 `reportProgress` and questions

- 8.5.1 `reportProgress({ statusNote?, output? })`: `statusNote` is a one-line note for task views; `output` a checkpoint. The latest checkpoint is the task's output: completing keeps it, and the worker's final answer becomes the output only when it never reported one. A failed attempt keeps its checkpoint. Neither changes status. Refused after the task finished (`task_finished`), or with neither field (`progress_takes_a_note_or_output`), or off a task turn (`not_a_task_turn`). `createReportProgress({ resolve })` builds it for a worker flow of your own. `tt:735-790`, `tk:329-345`, OLD.
- 8.5.2 Questions, set only when filing: up to 20, each up to 1,000 characters. A string is a question; `{ kind: "confirm", prompt, onNo? }` asks yes or no; a No cancels the task by default, or `onNo: "continue"` lets the work go on with "No." in its brief. The task stays `pending` and starts no attempt until every one is answered; each answer joins the first attempt's brief. `hd:36`, `ti:69-78`, `hd:78-102`.
- 8.5.3 A worker can ask midway: a model with `holdTaskForUser({ question })`; code with `askMidway(ctx, board, [{ prompt }])` (or `[{ kind: "confirm", prompt, onNo }]`). The turn ends without settling; the task keeps its attempt and what the turn wrote; it is not handed out again while it waits; once answered it takes one more turn on the same attempt from its brief, last checkpoint and the answer, not charged against `maxAttempts`. `createHoldTaskForUser({ resolve })` builds the tool; offer it while its `offered(ctx)` says so (a turn working a running task). `onMidwayQuestion(ctx, row, questions)` in the list's `delivery` lets the filer hear it; without it the filer reads the question with `getTask`. OLD "A task's questions".
- 8.5.4 Each hold: `id`, `ask` (`kind` of `question | confirm | external | approval | review | input`, `prompt`, `title?`), `openedAt`, `due?`; `actor: "user" | "system"`; `source.kind` `"task"` or `"suspension"`. A question stays listed until answered. `hd:51-130`.
- 8.5.5 A question has no deadline unless the host sets `userDeadlineMs`; then, on the board's first touch past it, the question closes with "No answer came before this question's deadline. Go on from your brief without it." and the work goes on. `hol:27`, OLD.
- 8.5.6 Only the user the task was filed for, in the same tenant and organization, can answer; anyone else is told `task_not_found`. `tt:1861-1890`.
- 8.5.7 A line the user types into a task's session answers its oldest open question; a confirm is never answered that way. OLD.
- 8.5.8 A stop for a user in a task's run: `ctx.suspendForUser({ kind: "approval" | "review" | "input", prompt })`; listed in `holds` with `source.kind: "suspension"`. Task cancelled while stopped: the run resumes with `suspendForUser` returning `{ cancelled: true }`, nothing it writes is kept, and a task it tries to file is refused. Run stopped: the task is cancelled, not failed. Deadline: an approval reads as a no; a review or input fails the attempt unless the run catches `SuspensionTimeoutError`. A model's `suspendForUser` tool takes `approval` or `review` on a task turn (`input` refused: use `holdTaskForUser`); built with `createSuspendForUserTool({ resolve })`. A `holdTaskForUser` and a `suspendForUser` in one step open one wait; the other comes back a tool error. `hd:61-75`, OLD "A task waiting on a user".

### 8.6 What a task's run spent (`spend`)

Dispatched tasks carry what their runs spent. `taskSpendView` returns `{ harness, model, inputTokens, outputTokens, costUsd?, unreported, live }`: `harness` the latest harness run's or `null`; `model` that run's, or the model the worker last called; `inputTokens`/`outputTokens` every request and attempt counted, `null` while nothing reported (never 0); `costUsd` the sum of charges vendors reported, `null` when none (a subscription run reports none); `unreported` `true` while a harness run hasn't reported tokens; `live` `true` while a request for the task runs, never on a terminal row. `spend` is `null` on a task that never ran in a request of its own. The run writes it every 2,000 ms while it changes and once at the end, however it ends; a retry adds to it. Only the `listTasks` action's rows carry it. A store of your own shows it once it implements `recordSpend`. `O`tasks/schema/spend.ts:56-86, `O`tasks/spend.ts:104-140, `O`task-board/task-request.ts:160 (`SPEND_TICK_MS`), OLD "What a task's run spent".

### 8.7 Inbox

`@flow-state-dev/orchestration/inbox` (browser-safe): `inboxItems({ rows, suspensions, flowOf })` returns one item per task that waits on a user, `holds` oldest first, `answerable` when one of its questions is; a stop in a task's run lists under the task; `createInboxClient(client).answer(item, answer)` sends each answer where it belongs; answers are typed by what the question asks: approval `{ approved, data? }`, input or review `{ value }` or `{ skipped: true }`, question `{ text }`, confirm `{ done, note? }`. `taskRowView(row, holds?)` gives one display state: `queued`, `held`, `running`, `waiting`, `failed`, `done`, `cancelled`; a task that waits on a user reads `waiting` whatever its stored status. `O`inbox/ [source of names]; OLD "Building an Inbox"; `T`inbox.test.ts, `T`task-view.test.ts.

## 9. Parent-task completion, chains and notices on a Workforce conversation's board

These are rows moved here by the Workforce pages. They are facts about Workforce's board and the task tools; the page carries them only as rows under "assignees that dispatch" or a short "Workforce" table, and links to the Workforce pages.

- 9.1 A worker given a task can split it into pieces for its own delegates (a piece for any other worker is refused `unknown_assignee`; a piece with no assignee goes to the delegate when it has exactly one). The pieces go on the task session's own board. The turn either waits on a piece in the same turn (`getTask({ id, wait: true })`, waits nest 5 deep) or files them and ends; the task stays `in_progress`, `keptOpenBy: "filed"`, and is not handed out again. DW 215-217, `tt:386-402`.
- 9.2 Each piece's ending wakes the worker for a turn in the task session. The task completes once no piece is open and the worker has had a turn on every piece's ending. Its output is the latest `reportProgress` checkpoint, else the answer from the last turn a piece's ending woke; a message's answer is never the output. A message in the task's session neither holds the task nor is part of it, and its turn cannot write to the task. DW 219-221, `tk:329-345`.
- 9.3 A failed piece does not fail the task by itself; its ending wakes the worker, whose turn decides. If that turn throws, the task's attempt fails. Only the session that filed the task hears it end. The pieces belong to the attempt that filed them: when it fails, is retried or is cancelled, every piece still open is cancelled. DW 230-232, `casc:62-65`.
- 9.4 Chain limits: depth 5 (fixed; the top task's board is the first) and 100 tasks under one top task at any depth, finished ones included, set with `hireWorkforce(installation, { taskChainLimit })`. A filing past either is refused `{ ok: false, error: "total_task_cap_exceeded" }` and files nothing. A step counts toward the 100 but opens no session and adds no depth. `wf`conversation-board/chain.ts:1-45, `wf`workers/register.ts:36-46, `wf`conversation-board/board.ts:1170-1200, DW 238-252.
- 9.5 A model's own cancel in its own turn owes the filer no notice. An action's cancel does. `tt:1750-1790` (`via`), 7.7.3.

## 10. Wrapper patterns: the board settings each sets

From `reference/patterns` row "Which patterns run a task board". These are the board options each pattern fixes; a user of the pattern changes only what its own options expose.

| Pattern | Concurrency | `claimOrder` | `onIdle` | `onError` | Flow policy | Loop | Source |
|---------|-------------|--------------|----------|-----------|-------------|------|--------|
| `parallelTasks` | `maxConcurrency`, default 3 | `"fifo"` | `"complete"` | `"skip"`; `"fail"` when `onSubTaskError: "fail"` | board default | `goalSeekLoop`, `maxIterations: 1`, always-`done` judge | `pat`parallelTasks/index.ts:90-143, 190-200 |
| `supervisor` | `maxConcurrency`, default 3 | `"fifo"` | board default | `"skip"` / `"fail"` by `onSubTaskError` | `declaredDepsOnly()` | no loop; reviewer wraps each worker; `maxAttemptsPerTask` default 3 | `pat`supervisor/index.ts:280-284, 375-399 |
| `planAndExecute` | `maxConcurrency`, default 1 | `"fifo"` | board default | `"skip"` (loop `onError: "fail"`) | `recentTrajectory({ n: 8 })` | `goalSeekLoop`; `maxAttemptsPerTask` default 1 | `pat`plan-and-execute/index.ts:614-616, 714-738, 815-825 |
| `eventActors` | `concurrency`, default 4 | `"fifo"` | `"complete"` | board default | board default | one worker per actor; `maxTotalRetries` not applicable | `pat`eventActors/index.ts:263, 443-453 (per patterns.facts.md 1.2) |

- 10.1 `routedSpecialists`, `roundRobin`, `debate` use task collections as a record, not a board; `responseAuditor` uses no tasks. Do not list them here.
- 10.2 Each of `parallelTasks`, `supervisor`, `planAndExecute` accepts `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` and forwards them to its internal board; defaults 500 / 100 / 50. `pat`shared/task-caps.ts:1-20, `pat`parallelTasks/index.ts:40-63.
- 10.3 `parallelTasks` has no `maxAttemptsPerTask` option; the planner stamps `maxAttempts` on a task from its output, so a planned task can retry and the budget binds it. `pat`parallelTasks/index.ts:59-62.
- 10.4 `onSubTaskError`: `"skip"` (default) leaves a failed sub-task out of synthesis, and only once its attempts run out; `"fail"` makes the pattern throw on the first failed attempt, even with attempts remaining, because the board rethrows after writing the failure. `"retry"` is not a value (treated as `"skip"` with a console warning). `pat`parallelTasks/index.ts:76-120, `rr:559-561`, `tbt:905-928`.
- 10.5 `supervisor`: `maxAttemptsPerTask` defaults to 3, so a supervisor board retries by default and `maxTotalRetries` binds it. `pat`supervisor/index.ts:100-110.
- 10.6 `planAndExecute` `maxTotalRetries`: binds only once `maxAttemptsPerTask` is raised above 1. `pat`plan-and-execute/index.ts:182-190.
- 10.7 Cancelled sub-tasks and dependents: plan output reads `skipped` (2.3.6).

## 11. The three lookups

| Lookup | Answer | Where in this sheet |
|--------|--------|---------------------|
| What cancels a task? | `updateTask({ status: "cancelled" })` (filer's tool or the action), a confirm answered No (default `onNo`), a worker throwing `TaskEndsForGoodError` with `ending: "cancelled"`, a cascade from a dependency that failed for good or was cancelled, stopping the run of a task waiting on a user, stopping a conversation whose turn waits on it | 2.2 |
| Which stop reason means a task is waiting on a user? | `waiting-on-a-user` on the board's `task-board-meta`; the same words end a `goalSeekLoop` pass | 3.1, 3.4 |
| What does `maxAttempts` change? | Unset: a failed task goes straight to `errored`. Set: while `attempts - abandonments < maxAttempts`, a failure puts the task back to `pending` with the error as `feedback` for the next attempt, spending one grant of `maxTotalRetries`; once attempts are spent, it goes `errored`. | 5.1, 5.2 |

## 12. Rows moved here by other pages' depth passes

Command run: `grep -rhE --include=*.record.md -e '→ R-23( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages`. 33 rows in 11 records. Each row below is **carried** (checked true), **carried corrected**, or **dropped** with the reason.

| # | Row (short) | Verdict | Where / why |
|---|-------------|---------|-------------|
| 1 | parallel-tasks: retry behaviour (planner `maxAttempts`, `skip` vs `fail`) (corrected by pass 5) | carried | 10.3, 10.4. `fail` aborts on the first failed attempt: the board writes the failure (re-pending a task with attempts left) then rethrows (`rr:559-561`). |
| 2 | parallel-tasks: `maxTotalRetries` default 50, `null`, `0`; retries only with `maxAttempts` | carried | 5.2, 10.2. |
| 3 | goal-seek-loop: stop reason `waiting-on-a-user` (no judge, not counted, extra drains capped) | carried | 3.4. Restricted to "list must outlive the request" (3.4.2) because the code comment says only "run the loop again once answered". |
| 4 | plan-and-execute: cascade rules (failed cancels pending dependents transitively; replanned task on a failed dep skipped; missing dep or cycle refused, run fails) | carried | 2.3.1, 2.3.5. |
| 5 | plan-and-execute: factories table (`createTaskEvaluator`, `createLLMEvaluator`, `createCaptureAndPlan`, `createApplyReplan`, `createSynthesize`, `createBuildPlanOutput`, `normalizeOutputStatus`, `evaluatePlanProgress`) in generated API; the `capability` rule of `createApplyReplan` is a row on the bounds | carried in part | The `capability` rule: 5.3.6. The factories table is not R-23: it belongs to the generated `reference/api/patterns` section. Dropped here, not false. |
| 6 | delegating-work: `createTask` result shape and default-assignee rule | carried corrected | 8.1, 0.4. "Several leave it unassigned until updateTask names one" is wrong: several and not held is refused `assignee_required`. |
| 7 | delegating-work: refusal `unknown_assignee` | carried | 8.1 (`tt:372-380`): names the assignee and who is available; nothing stored. |
| 8 | delegating-work: refusal `no_delegation_board`, `createTask_tasks`'s other fields and refusals | carried | 8.1. The action name for a collection `tasks` is `createTask_tasks` (suffix rule 8.0.2). |
| 9 | delegating-work: parent-task completion rules | carried | 9.1-9.3, 7.6.3-7.6.4. |
| 10 | delegating-work: chain limits (depth 5, 100 tasks, `total_task_cap_exceeded`) | carried | 9.4. |
| 11 | delegating-work: the ending notice, a wait on `getTask` suppresses it, `getTask` reads a finished task with its output | carried | 7.7.2-7.7.3, 8.3.1, 8.3.3. |
| 12 | screens: task statuses (six values) and the `holds` entry | carried | 2, 2.1.1-2.1.2, 8.5.4. |
| 13 | tasks-and-boards: task statuses and what moves a task between them | carried corrected | 2.1. The record's "cancelled (labelled skipped) when a task it depends on fails for good or is itself cancelled" is right; the table adds the `retryTask` move out of terminal statuses and the `held` moves. |
| 14 | tasks-and-boards: stop reasons (`all-completed`, `blocked-by-failures`, the waiting-on-a-user reason and the rest), and the item the drain emits | carried | 3.1, 3.3. |
| 15 | tasks-and-boards: assignees that dispatch (default wait vs delegation, when the drain returns, when each session settles its task) | carried | 7. |
| 16 | tasks-and-boards: retries (`maxAttempts` changes status and the drain) | carried | 5.1, 11. |
| 17 | tasks-and-boards: task tools, per-field `updateTask` rule | carried | 8, 8.2. |
| 18 | glossary: assignee resolution (unnamed entry goes to the default assignee or fails; assignees that dispatch) | carried | 7.2, 7.3. |
| 19 | glossary: claim order option (`fifo` default, `priority`, custom `ClaimOrder`; neither claims unmet deps) (corrected by pass 5) | carried | 4.3, 0.1. True and the existing page is the false one. |
| 20 | glossary: how a recorded task starts (conversation board vs drained board; `held` release by `updateTask`; dispatcher assignees) | carried | 8.0.3. |
| 21 | patterns: task caps (`maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries`, defaults, `null`, whole-plan refusal, `retry-budget-exhausted`) | carried | 5.2, 5.3, 3.1. One pointer row per pattern stays on the pattern page. |
| 22 | patterns: task status transitions (dependents cancelled and read as skipped; P&E status mapping; cancelled/completed keep status) | carried | 2.3.1, 2.3.6, 2.3.7. "Line 314" is read as the terminal rule in the state table. |
| 23 | patterns: concurrency, claim order, `onError` defaults per pattern | carried | 10. Board defaults are in 1.2. The pattern page keeps a one-line link. |
| 24 | patterns: `taskBoard` `maxIterations` (per-worker, 10,000, at least 1) vs `goalSeekLoop`'s `maxIterations`; `waiting-on-a-user` and `waiting-on-an-event` spend no iteration (corrected by pass 5) | carried | 1.2, 3.4. `waiting-on-an-event` is true (`gsl:30-31`), contrary to a page that mentions only the user reason. |
| 25 | research-team: readiness rule (all `deps` completed) and default concurrency 4 | carried | 4. |
| 26 | research-team: what `board.drain` returns (one entry per loop, how each ended) | carried | 3.3.1. One entry per worker, so `concurrency` entries. |
| 27 | research-team: the board's progress report (`task-board-meta`): `status`, `terminationReason`, `counts` | carried | 3.1. |
| 28 | research-team: the per-request cap on filed tasks and what happens past it | carried | 5.3.1-5.3.2. |
| 29 | research-team: task statuses (errored; dependents cancelled; the run itself not failing; retries via `maxAttempts`) | carried | 2.3.1, 2.3.8, 5.1. |
| 30 | research-team: cancelled-task fields (`error`, `causedBy`) and `blocked-by-failures` with its counts | carried | 2.3.1, 3.1. |
| 31 | live-updates: board notices on the filing session's topic narrowed to the board id | carried | 7.7.7. |
| 32 | write-a-pattern: storage choices (`backing: "request"`, `collectionId`; blocks outside the drain read the same list by `collectionId`; columns backing / how long / who can resolve) | carried | 6. |
| 33 | write-a-pattern: what `board.drain` outputs, and reading completed `output` with `list({ status: "completed" })` | carried | 3.3.1-3.3.2. |

Rows dropped outright: none as false. The one row not carried as an R-23 table is row 5's factories list, which belongs to the generated API reference.

## 13. Left out, for lack of an observable surface or because it is not Reference

- **Migrating** (OLD's last section: the board's and the tool's old names, each refused by a named error). The sitemap cuts it; a row on the release's Upgrading page, not here. The tool and board refuse each old name by a named error, which the page need not list.
- **Mechanism**: "a claim is a single atomic compare-and-set"; the claim write re-checks eligibility; the closure that decides a row is "going nowhere" (only its observable result, 3.1 rung 4, is kept); lease renewal cadence; `runOnce` replay protection on `createTask`; one-filing-at-a-time. Observable guarantee kept: at most one holder (4).
- **Design history in doc comments** (earlier defaults, "legacy default", "removed review option", tracker ids in header comments): not quotable.
- **The old-name migration notes** inside the tool descriptions.
- **`taskToolActions`' header comment says "eight task tools"** while the code returns five (filer's four plus `retryTask`); stale, not stated.
- **`TaskBoardConfig` internals** such as `stateKey` on request and sequencer specs: kept in 6 (it is an option), but `taskBoardStateSchema` is not public (`/internal` only), so the page describes the slot and does not name it.
- **DevTool Tasks tab** rows and the `<TaskPlan />` renderer: not R-23 (UI catalog). One sentence in OLD; not carried.
- **`goalSeekLoop`'s own options** (`judge`, `replanner`, `seed`, `finalize`, ...): CFG "goalSeekLoop options" belong on the goal-seek page, not here.
- **`createSkillsLibrary`, `skills.with`** (CFG): another page.

## 14. Doubts for pass 5

1. **`toolCache.maxEntries` default is 5,000**, confirmed: `fpw:266-276` passes `cacheCfg.maxEntries` through and the store's own default is `DEFAULT_MAX_ENTRIES = 5000` (`core`blocks/tool-cache.ts:186). The 1.2 row stands; the `maxEntries` doc comment on `TaskBoardToolCacheConfig` (`tb:556`) names the same number.
2. **`createTask`'s same-work rule (`already_open`)** is keyed on goal + assignee (+ target). OLD says "goal for the same assignee and workstream target". `tt:1295-1310`, `tt:1396-1412`. Confirm the exact key (title-insensitive? case-sensitive?) before the row says more than OLD.
3. **Lease renewal cadence** ("every third of the span", 40 s at the default) comes from a doc comment on the default and is not a user setting; the page should state the 2-minute lease only.
4. **`getTask` wait refusals** list: one more code exists in the wait helper, `wait_ended_the_request`, for a waiting request that was stopped or ended. `O`tasks/helpers/wait-on-task.ts:166, 684, 702. It is a result, not a refusal; decide whether the table carries it.
5. **The `held` + deps interplay for `taskRowView`** and the `queued` display state: not verified against `T`task-view.test.ts beyond the state names.
6. **`reference/resources.md` is cited for scope semantics** (6). It is a revamp page in drafting; if its wording changes, 6's scope column follows it.
7. **Which stop reasons raise a notice** (row 11): the page can state the three endings, and that `waiting-on-a-user` is a board stop reason, not a task ending; the moved row said "stop reasons" raise it, which has no code behind it. A task stopped for a user raises no notice until it ends.
8. **`counts.retries`** is the sum of granted retries (`bm:266`); on a resource-backed board it is a true count with `maxTotalRetries: null` (`rbt:235-257`).

## 15. Draft ledger (pass 3)

What the draft left out of this sheet, and what it changed.

- **Not carried, not Reference for this page:** 8.6 (`spend` view) and 8.7 (Inbox, `taskRowView`): neither is on a moved row or in the sitemap's table list, and 8.7's display states are unverified (doubt 5). `wait_ended_the_request` (doubt 4) is a result, not a refusal, so the wait table omits it. Lease renewal cadence (doubt 3): the page states the 2-minute lease only. 7.4.1's `setAssignee` is stated as the `immutable-assignee` refusal. 7.7.6 (interruption timing, `staleSweepThresholdMs`), 7.6.8's host-queue lease renewal and 5.4.2 (`undetermined` on rows an older board stored) are mechanism and were cut. 7.5.1's note on custom keys shared across boards is cut to one clause. 2.1.5 `task-change` kinds are listed once.
- **Doubt 7 resolved:** the page says `waiting-on-a-user` is a board stop reason, not a task ending, and that a task stopped for a user raises no notice until it ends.
- **Doubt 2:** `already_open` is stated as OLD states it (same goal, same assignee and workstream target, while a task for it is open), with no claim on case or title sensitivity.
- **Pattern table (10):** `claimOrder` is stated once under the table ("all use fifo"); `eventActors` `onError` is the board default, `"skip"`.
- **Sheet 8.0.1/8.0.2/8.0.3** carried as bullets under "Task tools"; 9.1-9.4 carried under "Workforce conversation boards".
- **Figure:** `figures/task-board-states.svg`, brief: one idea, a task moves forward and only `retryTask` reopens a final one; marks: arrows, dashed arrow (`ONLY THROUGH RETRYTASK`), highlighter on `pending`; rendered light and dark, brand lint 0 findings.

## 16. Revise round 1

Facts the page no longer states, because the depth pass moved them to another Reference page. They stay true and stay here for the page that takes them. Each is listed with its destination.

- **R-06 Items and the stream:** the `task-change` item (key `${collectionId}/${taskId}`, visibility `{ client: true, history: false }`, the 23 kinds) and the `task-board-meta` item (key, visibility, two emissions per drain, `data` fields `counts` and `maxTotalRetries`; 3.1). The page keeps one sentence on `counts` and `counts.retries`.
- **R-41 Patterns:** how `goalSeekLoop` ends a pass on `waiting-on-a-user` and `waiting-on-an-event`, the uncounted re-drains capped at `maxIterations`, delegation boards refused (3.4); the per-pattern board settings table and forwarded caps (10).
- **R-24 Task collections:** claim rules (one holder, not exactly-once, 2-minute lease, lapsed-lease takeback, 3-abandonment allowance; 4); the `task-board-recorder-failure` item and the `TaskCollectionRef` contract (5.4); `defineTaskCollection` options (6); task holds, their shape and `source.kind` (8.5).
- **R-08 Resources:** which sessions, users and organizations reach a stored list, `sharedToLineage` and user-state isolation (6).
- **R-12 Runtime configuration:** `userDeadlineMs` and `shutdownDrainMs` (8.5, 7.6).
- **R-17 Pause, resume and replay:** `ctx.suspendForUser` on a task's run, `SuspensionTimeoutError` (8.5). Also the rule that only the filing user can answer, and that a line the user types answers the oldest open question, which goes with the questions to R-42.
- **R-19 Background work:** when a dispatched task settles and `keptOpenBy` values, the stale-claim check, side-chain failure, the JSON round-trip requirement (7.6); `onTaskSettled` notice fields, redelivery, `maxDebtAgeMs`, `noticeUndeliverable` metadata, the `board` topic notice (7.7); `taskLedgers` and `UnknownTaskLedgerError` (7.8).
- **R-42 Tools:** the filer tools, `retryTask`, `reportProgress`, questions and holds a worker asks, the wait refusals, `createTaskToolsCapability` and `taskToolActions` naming (8). The page keeps a pointer.
- **R-25 Workforce:** conversation-board rules (9).

Changed in place: the stop-reason wording, `maxAttempts` wording (attempts left = `maxAttempts` less attempts used, a dead worker's attempt not used), `eligibility` (see 4.3.3), the refused-dispatch list (7.5.6), and a title for `name` (1.2). The page now shows `src/flows/research/blocks/analyst.ts`, a handler on `taskWorkerInputSchema` from `@flow-state-dev/orchestration/task-board`.
