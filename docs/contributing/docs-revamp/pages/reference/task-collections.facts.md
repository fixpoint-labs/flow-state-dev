# Fact sheet: Task collections (R-24, reference, `reference/task-collections`)

Pass 1. Cites only what a fact sheet may cite: the existing pages (`SUB` = `apps/docs/docs/orchestration/task-substrate.md`, `FP` = `apps/docs/docs/orchestration/flow-policy.md`, `DW` = `apps/docs/docs/workforce/delegating-work.md`), the exported surface and its doc comments, tests, and examples that use it (`examples/guides/custom-pattern`, `examples/guides/board-lifecycle`). No spec, no `docs/internal`, no PR or commit text, no other page's fact sheet was cited. The 22 rows other pages' records moved here were each checked against the code and are ledgered in section 15.

Where a fact comes from reading the implementation (not an exported doc comment, an exported type or a test), it is marked **[source]**. Implementation reading constrains what the page may say; it is not quoted. A fact with no tag is on an exported type, its doc comment, or a test.

Page shape from the sitemap: reference, so tables and signatures, no narrative. Tables: the task record · collection operations · claim rules a user can observe · what a newly started task knows about earlier work. Lookups: "Can two drains run one task?" · "What does a task see of its dependencies?". Sources named by the plan: `orchestration/task-substrate`, `orchestration/flow-policy`. From C-21.

## Abbreviations

All paths from the repo root. `O` = `packages/orchestration/src/`. `T` = `packages/orchestration/test/`. `P` = `packages/patterns/src/`. `PT` = `packages/patterns/test/`. `W` = `packages/workforce/src/`.

- Tasks: `ts` = `O`tasks/schema/task-status.ts; `tk` = `O`tasks/schema/task.ts; `hd` = `O`tasks/schema/hold.ts; `st` = `O`tasks/schema/steer.ts; `ti` = `O`tasks/schema/task-init.ts; `wt` = `O`tasks/workers/types.ts; `fp` = `O`tasks/flow-policy/index.ts; `idx` = `O`tasks/index.ts.
- Collection: `ty` = `O`tasks/collection/types.ts; `int` = `O`tasks/collection/internal.ts; `mt` = `O`tasks/collection/method-table.ts; `casc` = `O`tasks/collection/cascade.ts; `fil` = `O`tasks/collection/filing.ts; `hol` = `O`tasks/collection/holds.ts; `ev` = `O`tasks/collection/change-event.ts; `goc` = `O`tasks/collection/get-or-create.ts; `dtc` = `O`tasks/collection/define-task-collection.ts; `caps` = `O`tasks/collection/task-caps.ts; `part` = `O`tasks/collection/partition.ts; `fr` = `O`tasks/collection/field-rules.ts; `end` = `O`tasks/collection/ending.ts; `sb` = `O`tasks/collection/state-backed.ts; `rb` = `O`tasks/collection/resource-backed.ts.
- Board and tools: `tb` = `O`task-board/index.ts; `ws` = `O`task-board/blocks/worker-step.ts; `fpw` = `O`task-board/flow-policy-wiring.ts; `te` = `O`task-board/task-entry.ts; `rf` = `O`task-board/blocks/recorder-failure.ts; `ar` = `O`task-board/apply-replan.ts; `tt` = `O`skills/task-tools-capability.ts; `tl` = `O`skills/task-listing.ts.
- Tests: `collt` = `T`collection/collection.test.ts; `rec` = `T`collection/recovery.test.ts; `lf` = `T`collection/lease-fence.test.ts; `fst` = `T`collection/filing-settings.test.ts; `sts` = `T`collection/shared-task-set.test.ts; `pwd` = `T`task-board/task-board-prior-work-delivery.test.ts; `cd` = `T`task-board/task-board-concurrent-drains.test.ts; `tlt` = `T`task-board/task-ledgers.test.ts; `ohp` = `T`one-home-per-name.spec.ts.
- Other packages: `core` = `packages/core/src/`; `wf` = `packages/workforce/src/`; `wft` = `packages/workforce/test/`.

## 0. Findings the writer must act on before drafting

The code disagrees with `SUB`, `FP` or `DW` in these places. Code wins. Each is a row or sentence the page must get right, and none of them may be copied across from the old pages.

| # | Finding | Source |
|---|---------|--------|
| 0.1 | **Every task-substrate name is imported from `@flow-state-dev/orchestration/tasks`, never from the package root.** `SUB` and `FP` import `taskSchema`, `getOrCreateTaskCollection`, `flowPolicy`, `isTerminalStatus`, `ticketForClaim`, `withLeaseRenewal`, `beginTaskWrite` and `didWriteLand` from `@flow-state-dev/orchestration`. A test pins that the root shares no name with `./tasks`. The root carries skills, `resolveCatalogTools`, `isTaskTurn`, `taskSettledEntry`. `./tasks` is the browser-safe entry. The board is `@flow-state-dev/orchestration/task-board`, which also exports `taskBoard`, `taskWorkerInputSchema`, `taskLedgers`, `taskToolActions`, `askMidway`, `UnknownTaskLedgerError`, `TaskBoardRecorderFailureError`, `TaskBoardReportFailureError` and the `RecorderFailureReport` type; `./tasks` exports none of those. Other names on the page come from elsewhere: `readEveryCollectionPage` from `@flow-state-dev/client`, `defineSessionBoard` from `@flow-state-dev/workforce`, `sessionIdOfFiling` from `@flow-state-dev/workforce/browser`, `useView` from `@flow-state-dev/react`. | `ohp:1-12,45-60`, `O`index.ts:17-35, `idx:15-236`, `examples/guides/custom-pattern/src/plan-map-reduce.ts:15-17`, `examples/guides/board-lifecycle/src/lifecycle-flow.ts:18-20` |
| 0.2 | **There is no `topologicalClaimOrder`, and two claim orders ship, not three.** `SUB`'s example calls `topologicalClaimOrder.claim(collection, "writer-1", ctx)` and its table lists it as the default. The exports are `fifoClaimOrder` and `priorityClaimOrder`. The board's `claimOrder` takes `"fifo"` (default) or `"priority"` or a `ClaimOrder` instance. | `idx:197-200`, `O`task-board/shared.ts:27-46, `tb:688` (`claimOrder = "fifo"` default), `O`tasks/claim-orders/fifo.ts:13-17 |
| 0.3 | **`ClaimOrder.claim` takes three arguments: `(collection, workerId, ctx)`.** | `O`tasks/claim-orders/types.ts:28-38 |
| 0.4 | **A supplied `eligibility` narrows; it does not replace.** A comment on the `ClaimOrder` interface says it "replaces" the substrate's default. The code admits a row only when `isClaimable(task, …)` is true and then the caller's predicate is true. `ClaimOptions.eligibility`'s doc comment and the code agree with each other and disagree with that comment. | `ty:228-270` (doc), `mt:503-511` (`admits`), `rec:165-200` (tests: recovers inside a narrowing, leaves a lapsed row outside it alone) |
| 0.5 | **A lapsed lease does not move the row to `pending`.** `SUB`'s status diagram draws `in_progress → pending (reclaim, after a stale lease)`. The automatic path is `claim` taking the lapsed `in_progress` row in place, as a new attempt (`attempts` + 1, `abandonments` + 1). Only the manual `reclaim()` verb writes `pending`, and nothing in the shipped packages calls it. | `int:1053-1063` (`isClaimable`), `int:1396-1450` (`applyClaimToTask`), `mt:503-545`, `mt:780-805` (`reclaim`), `rec:115-131` ("recovers a default task with NO maxAttempts, as attempt 2") |
| 0.6 | **The decline reasons are 16, not 9, and `SUB`'s "those four reasons are the whole set" is wrong.** The union is in 7.2. | `ty:103-169` |
| 0.7 | **No tool returns `illegal_status_transition`.** `SUB` says the task tools catch `IllegalTaskTransitionError` and answer `{ ok: false, error: "illegal_status_transition: …" }`. The string occurs nowhere in the package. The tools answer through decline reasons and named codes (`task_finished`, `field_locked_after_start`, …, 13.2). The error class's own doc comment makes the same stale claim. | grep of `O` finds the string nowhere; `ts:77-103`; `tt:1632` |
| 0.8 | **`task-change` has 23 `kind` values, not 19.** `SUB` omits `retry_requested`, `progress_reported`, `resume_settled`, `cancel_owed`, `wait_changed`. | `ev:16-72` |
| 0.9 | **A hold's `ask.kind` has six values, not two.** `SUB` names question and confirm. Own holds are `question`, `confirm`, `external`; a suspension hold is `approval`, `review`, `input`. | `hd:78-102`, `hd:62-75` |
| 0.10 | **A task's `attempts` is charged by recovery, not only by a first claim**, but not by a turn the claim takes on the same attempt (a task whose last question was answered, or that owes a steer turn). `SUB` says "how many times the task has been claimed". | `int:1396-1450`, `hd` / `tk:553-563` (`turnOwed`) |
| 0.11 | **`createTask` refuses `wait`, `deadline` and `timeoutMs`**, not `waitForResponse`. | `tt:1257` |
| 0.12 | **`DW` lists 16 `clientData` fields for a conversation's board; the ledger exposes 22.** Added: `context`, `attachments`, `feedback`, `holds`, `steers`, `spend`. | `wf`conversation-board/ledger.ts:84-112, 13.7 |
| 0.13 | **`FP` says `flowPolicy` is imported from `@flow-state-dev/orchestration`.** It is `@flow-state-dev/orchestration/tasks`. (0.1.) | `idx:225-236` |
| 0.14 | **`getOrCreateTaskCollection` has no per-resolution cache.** Every call builds a fresh ref. Caps apply only to a ref built with them (5.5). | `caps` header ("Enforcement boundary"), `goc:147` |
| 0.15 | **`reclaim()` judges a lease lapsed on `leaseUntil < now`; the claim path on `leaseUntil <= now`.** One millisecond apart; not worth a row, listed so a writer does not state either as "the" rule. | `mt:782-784`, `int:961-964` |

## 1. Import paths and public names

- 1.1 `@flow-state-dev/orchestration/tasks` exports: `taskSchema`, `taskStatusSchema`, `isTerminalStatus`, `isTransitionAllowed`, `allowedTransitionsFrom`, `IllegalTaskTransitionError`, types `Task`, `TaskStatus`, `TaskRunLink`, `TaskInit`, `TaskFilter`; `taskHoldSchema`, `ownHoldSchema`, `suspensionHoldSchema`, `openHolds`, `holdActorOf`, `isExternalHold`, `externalHoldOf`; `TaskFilingRefusedError`; `taskSteerSchema`; `TASK_FIELD_RULES`, `lockedFields`; `ticketForClaim`; `beginTaskWrite`, `didWriteLand`; `toEmittedTask`; `getOrCreateTaskCollection`; `defineTaskCollection`; `resolveResourceCollection`; `isClaimable`, `claimDisposition`, `committedLeaseSpan`, `leaseLapsed`, `DEFAULT_MAX_ABANDONMENTS`; `TaskCapExceededError`; `fifoClaimOrder`, `priorityClaimOrder`; `startLeaseRenewal`, `withLeaseRenewal`; `flowPolicy`, `formatPriorWork`; `onTaskChangeFor`; `taskSpendView`; types `TaskCollectionRef`, `ClaimOptions`, `TaskHandle`, `TaskTransitionOptions`, `FailOptions`, `CancelOptions`, `TaskWriteOutcome`, `TaskWriteDeclineReason`, `TaskWorker`, `TaskWorkerInput`, `TaskFlowPolicy`, `TaskPriorWork`, `Observation`, `ObservationLedgerView`. `idx:15-236`.
- 1.2 `MAX_STEERS`, `MAX_QUESTION_PROMPT`, `DEFAULT_LEASE_DURATION_MS`, `MIN_LEASE_DURATION_MS`, `DEFAULT_MAX_TOTAL_RETRIES`, `SKIPPED_LABEL`, `NO_ANSWER_CAME` are **not** exported from `./tasks`. The page may state their values and must not tell a reader to import them. `idx:15-236` (absent), `st:10`, `hd:36`, `int:1120,1130`, `caps:243`, `casc:31`, `hol:27`. [source for the values]
- 1.3 `taskWorkerInputSchema` is exported from `@flow-state-dev/orchestration/task-board`, `TaskWorkerInput` from `./tasks`. `wt:23-39`.
- 1.4 `taskLedgers`, `UnknownTaskLedgerError` come from `@flow-state-dev/orchestration/task-board` (see 14). `te:262,588`.
- 1.5 Task tools (`createTaskToolsCapability`, `taskToolActions`) and the filer's tools are the skills side; names in 13.

## 2. The task record

`taskSchema` is a Zod object, so a row validates at runtime and `Task<TInput, TOutput>` narrows `input` and `output` at the call site; the schema itself types both `unknown`. `tk:19-27,685-692`.

Reading a row through `get`/`list` returns a `TaskHandle`: the `Task` plus `items()`, the worker's stream items for the window from the first claim to the terminal event. The data fields are a snapshot; `items()` is live. Retries do not reset the window. `task-change`, `task-board-meta` and `task-board-recorder-failure` items are excluded. `createTask`, `createTasks` and `claim` return the raw `Task`; every other write returns a `TaskWriteOutcome` (or a number or id list, 7). `ty:466-487`.

### 2.1 What a caller sets when filing (`TaskInit`)

| Field | Type | Notes | Source |
|-------|------|-------|--------|
| `id` | `string?` | Generated when omitted (`task_<time>_<counter>_<random>`). Must be one path segment on a partitioned ledger. | `ti:22-23`, `int:90-109`, `O`tasks/generate-id.ts:21-36, `part:123-130` |
| `goal` | `string` | Required. | `ti:24` |
| `title`, `context` | `string?` | Label; prose the worker reads. | `ti:26-28` |
| `attachments` | `FileContent[]?` | Set by the filing path from the turn's files, never from model input. | `ti:29-36` |
| `status` | `TaskStatus?` | Default `"pending"`. `held: true` wins over it. A row stored `cancelled` keeps `error` and `causedBy`. | `int:97`, `int:134-135` |
| `held` | `boolean?` | File it `held`. | `ti:62-68` |
| `assignee`, `deps`, `priority`, `maxAttempts`, `input`, `labels`, `metadata` | optional | `metadata` has the notice markers stripped on filing. | `ti:38-50`, `int:124` |
| `questions` | `QuestionInit[]?` | Holds the task is filed on (9). At most 20, each prompt at most 1,000 characters, none empty, `onNo` only on a confirm; else `questions_not_kept`. | `ti:69-78`, `hol:138-163`, `fil:18-21` |
| `session` | `"new" \| "ongoing"?` | Default `"new"`. A board refuses a value it does not list (`setting_not_supported`). A plain board lists only `"new"`. | `ti:79-84`, `fil:108-117,148-161` |
| `resultTo` | `"filer" \| "conversation"?` | Default `"filer"`. `"conversation"` means one attempt: `maxAttempts` unset reads as 1, any other is refused (`conversation_result_one_attempt`). | `ti:85-90`, `int:115-117`, `fil:162-168` |
| `target`, `targetSessionId` | `string?` | Workstream filing settings; `targetSessionId` is written by the board's filing path. | `ti:91-103` |
| `followUpOf` | `string?` | The finished task this follows up, resolved to its root. A follow-up takes no `session`, `target` or `resultTo` (`follow_up_takes_no_*`); the root's are copied on. | `ti:51-56`, `fil:127-147`, `fil:240-256` |
| `filedByTask` | `string?` | The task whose request filed it. | `ti:57-61` |
| `sealed` | `Record<string, unknown>?` | Payload the filing code writes for whatever runs the row; no tool reaches it. | `ti:104-108`, `tk:661-672` |
| `error`, `causedBy` | `string?` | For a row filed already cancelled (a replan's skip). | `ti:109-118` |

Defaults a filing gets: `status` `pending`, `attempts` 0, `createdAt` = `updatedAt` = now, a fresh `incarnationId`, `createdBy` = the running session's user, `filedUnder` = the request's tenant and org when it has one. `int:90-150`.

### 2.2 The stored record (`Task`)

Who writes a field: **filing** (the `TaskInit` above), **collection** (the substrate, inside a write), **run** (a worker's run through a claim-fenced write), **caller** (a patch method). Client-visible is about the `task-change` item (11): the item carries the whole row minus four fields. `ev:140-166`.

| Field | Type | Written by | Meaning | Source |
|-------|------|------------|---------|--------|
| `id` | `string` | filing | Stable identifier. | `tk:20` |
| `goal`, `title`, `context` | `string`, `string?`, `string?` | filing | | `tk:21-35` |
| `attachments` | `AttachmentReference[]?` | filing | The brief's files, in the order attached; owned by the board's scope. Fixed once the task starts. | `tk:36-45` |
| `status` | `TaskStatus` | collection | One of six (3). | `tk:47`, `ts:13-20` |
| `attempts` | `number` (default 0) | collection | Advanced by every claim except one taking a turn on the same attempt. | `tk:48`, `int:1411-1412` |
| `maxAttempts` | `number?` | filing / caller (until start) | Retry budget. Set and `attempts - abandonments < maxAttempts`: a failure re-pends. Unset: a failure is terminal. | `tk:55`, `int:540-543` |
| `retryLedger` | `{ granted: number; deniedByBudget: boolean }?` | collection | This task's record against the board's `maxTotalRetries`. Absent reads as zero granted. | `tk:83-91`, `int:600-616` |
| `abandonments` | `number?` | collection | Times its lease lapsed and the claim took it back. Absent reads as 0. | `tk:124`, `int:1422` |
| `steers` | `TaskSteer[]?` | collection | Messages sent into the task while open; append-only, at most 20. | `tk:135`, `st:10-30` |
| `followUpOf` | `string?` | filing | | `tk:145` |
| `filedByTask` | `string?` | collection (from the filer's claim or session) | `listTasks` filters by it. | `tk:155` |
| `session`, `resultTo` | `"new"\|"ongoing"`, `"filer"\|"conversation"` (optional) | filing | Absent reads `"new"`, `"filer"`. Never changed. | `tk:165,174` |
| `target`, `targetSessionId` | `string?` | filing | | `tk:183,193` |
| `assignee` | `string?` | filing / caller | Worker-registry routing key; `claim`'s `workerId` argument is not stored. | `tk:195`, `mt:503` (`_workerId`) |
| `deps` | `string[]?` | filing / caller (until start) | Ids that must be `completed` before a claim. | `tk:196` |
| `priority` | `number?` | filing / caller | Higher wins under the priority claim order; unset reads 0. | `tk:197`, `O`tasks/claim-orders/priority.ts:19-34 |
| `leaseUntil` | `number?` | collection | When the current claim expires. | `tk:198` |
| `leaseDurationMs` | `number?` | collection | How long the current claim was granted. Read it with `committedLeaseSpan(task)`. | `tk:223`, `int:996-1000` |
| `claimedBy` | `{ sessionId, requestId, tenantId? }?` | collection | Where the current attempt was claimed. **Not sent to a client.** | `tk:248-257`, `ev:140` |
| `run` | `{ sessionId, requestId, attempt, startedAt? }?` | run | The run working the task, or last worked it. Cleared by the next claim, not by settlement. Sent to a client. | `tk:287-304`, `int:1431-1439` |
| `spend` | stored shape, nullable | run | What the task's runs spent. Read folded, through `taskSpendView`. | `tk:324`, `idx:22-29` |
| `input`, `output` | `unknown` | filing; `complete` / checkpoint | `output` is written by `complete` unless the worker checkpointed. | `tk:326-327`, `int:1320-1328` |
| `checkpointed` | `true?` | run | `output` is a checkpoint from `reportProgress`; `complete` keeps it. | `tk:336` |
| `statusNote` | `string?` | run | The worker's last one-line note. Never the status. | `tk:342` |
| `cancelledVia` | `"tool" \| "action"?` | collection | How the cancel was made. | `tk:351` |
| `error`, `feedback` | `string?` | collection | `error` of a hard fail or a cancel's reason or a cascade's `dep <id> failed`; `feedback` of a soft fail. | `tk:352-353`, `int:1335-1347` |
| `labels`, `metadata` | `string[]?`, `Record?` | filing / caller | `patchMetadata` merges; `addLabel`/`removeLabel` edit. | `tk:355-356`, `mt:866-885` |
| `revision`, `writeLog`, `writeLogTruncated`, `incarnationId` | provenance | collection | Write receipts (7.4). `writeLog` keeps the 4 newest. | `tk:374,388,414,439`, `O`tasks/write-provenance.ts:68 |
| `createdBy` | `string?` | collection | The user whose request filed it. **Not sent to a client.** | `tk:450`, `ev:140` |
| `filer` | `{ sessionId, requestId? }?` | collection | The session whose request filed it; where its ending is delivered. **Not sent to a client.** | `tk:651`, `ev:140` |
| `filedUnder` | `{ tenantId?, orgId? }?` | collection | The filing request's tenant and org. **Not sent to a client.** | `tk:592`, `ev:140` |
| `wait`, `resumeOwed`, `cancelOwed` | wait slot and two owed markers | collection | A request waiting on this row's ending (`getTask` with `wait`). Never a model-facing field. | `tk:470-491,505,604` |
| `keptOpenBy` | `"suspended" \| "filed" \| "steer" \| null` | run (claim gate) | What keeps a running task open with no lease: its request is suspended, work it filed, or a steer no request took. Only on `in_progress`. | `tk:525` |
| `holds` | `TaskHold[]?` | collection | What holds the task for a person or an outside event (9). | `tk:544` |
| `turn`, `turnOwed`, `askedInTurn`, `retryPending` | counters and markers | collection | Turn generation (every claim advances it); one more turn owed on the same attempt; the turn that asked midway; reopened by a retry and not claimed since. | `tk:553,563,573,582` |
| `cascadeOwed` | `{ due, endedAt? }?` | collection | A cascade is owed for this row's ending (8). | `tk:621-633` |
| `causedBy` | `string?` | collection | The task whose ending cancelled this row. | `tk:659` |
| `sealed` | `Record?` | filing | See 2.1. | `tk:672` |
| `createdAt`, `updatedAt`, `startedAt`, `completedAt` | `number` / `number?` | collection | Epoch ms. `startedAt` is stamped on the first claim and kept across later ones; `completedAt` on `complete`, `errored` and `cancelled`. | `tk:674-677`, `int:1423`, `int:1320-1347` |

The two lists above overlap on purpose: the page's task-record table should show the fields a user sets and reads (`id` … `metadata`, `output`, `error`, `feedback`, `attempts`, `run`, the four timestamps) and group the server-written bookkeeping (`revision`, `writeLog`, `incarnationId`, `wait`, `resumeOwed`, `cancelOwed`, `cascadeOwed`, `turn`, `turnOwed`, `askedInTurn`, `retryPending`, `keptOpenBy`) as one row that says "maintained by the collection; do not write".

### 2.3 Filtering (`TaskFilter`, for `list` and `count`)

Filters AND together. `status` (one or an array), `assignee`, `hasLabel`, `hasAllLabels`, `resumeOwed: true`, `cancelOwed: true`, `cascadeOwed: true`, `filedByTask`, `sealed` (each key matched with `===` against plain values). `ti:125-186`.

### 2.4 Which fields the filer may still change (`TASK_FIELD_RULES`)

Until the task first starts (never claimed; a retry's return to `pending` does not reopen them): `goal`, `title`, `context`, `attachments`, `input`, `deps`, `priority`, `labels`, `metadata`, `assignee`, `maxAttempts`, `held`. Until it finishes: a cancel, and a `message`. Never, in any state: `followUpOf`, `session`, `resultTo`, the attempts used. A finished task refuses every field. `hasStarted(task)` is `startedAt != null || attempts > 0`. `fr:1-75`.

`setPriority`, `addLabel`, `removeLabel`, `patchMetadata` are collection methods, not governed by this table, and write to a finished task (7.3).

## 3. Statuses and what moves a task between them

Six: `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`. `completed`, `errored`, `cancelled` are terminal ("settled"). `ts:13-36`.

| From | To | What moves it | Source |
|------|----|---------------|--------|
| `pending` | `in_progress` | A claim, when the row is claimable (6.1). | `ts:45`, `mt:503-545` |
| `pending` | `held` | `hold(id)`, `patchSettings({ held: true })`, or filed `held: true`. Declined `started` once the task has ever started. | `ts:45`, `mt:702`, `ty:656-666` |
| `pending` | `cancelled` | `cancel`, or a cascade. | `ts:45` |
| `held` | `pending` | `release(id)`, `patchSettings({ held: false })`. `unchanged` when not held. | `ts:47`, `mt:706` |
| `held` | `cancelled` | `cancel`, or a cascade. | `ts:47` |
| `in_progress` | `completed` | `complete(id, output)`. | `ts:46`, `mt:642` |
| `in_progress` | `errored` | `fail` with no budget left (or `noRetry`, or the board's `maxTotalRetries` spent), or a claim finding a lapsed row already abandoned 3 times (settles it in the claim write). | `ts:46`, `mt:658-700`, `mt:503-545` |
| `in_progress` | `pending` | `fail` with `attempts - abandonments < maxAttempts` (a retry, `task-change` kind `retried`); or the manual `reclaim()`. | `ts:46`, `int:540-543`, `mt:780-805` |
| `in_progress` | `cancelled` | `cancel`, or a cascade. | `ts:46` |
| `errored`, `cancelled` | `pending` | **`retry(id)` only**, outside the table (a person's or an app's move). | `mt:717-732`, `int:454-495` |
| `completed`, `errored`, `cancelled` | none | Terminal. | `ts:48-50` |

- 3.1 A move to the status a task already holds is allowed (`isTransitionAllowed(from, to)` is true when `from === to`). Any other move off the table throws `IllegalTaskTransitionError` with `taskId`, `from`, `to`; nothing is written. `ts:62-103`.
- 3.2 `allowedTransitionsFrom("in_progress")` returns `["completed", "errored", "pending", "cancelled"]`; for a terminal status `[]`; for a status the table does not know `[]` (no throw). `ts:44-63`.
- 3.3 A task waiting on a person keeps its status and gains a hold; before it starts it is `pending`, midway it is `in_progress` with no lease. Held (the filer's hold, a status) is separate from holds (9). `tk:527-543`.
- 3.4 A stored status the board does not know is declined `unknown-status`; the row is left as stored. `ty:126-131`, `ts:57-62`.
- 3.5 Completing a task keeps a checkpoint the worker reported instead of the result (`checkpointed`). `int:1320-1328`.
- 3.6 `retry` keeps id, steers, output so far, items window and spend; a failure's `error` becomes the next attempt's `feedback` (a cancel's reason does not); it is counted in `retryLedger`; it undoes a cascade's `skipped` label and `causedBy`; it closes the ended attempt's unanswered holds; it runs no cascade or notice. `ty:679-698`, `int:454-495`.
- 3.7 `retry` declines: `disallowed` (a row that has not ended, or that completed), `settling` (its last ending is still owed: a cascade, a resume or a cancel), `dependency-ended` (a dependency failed or was cancelled), `retry-budget` (where `maxTotalRetries` is enforced and spent). `int:454-465`, `ty:679-698`.

## 4. Collection operations

`TaskCollectionRef<TInput, TOutput>` is what `getOrCreateTaskCollection` returns, the same shape over either backing. Mutations are compare-and-set. `get`, `list`, `count` are synchronous reads of the latest committed view. Every write to an existing task resolves to a `TaskWriteOutcome` (7), except `claim` (`Task | null`), `reclaim` and `payOwedCascades` (`number`), `payHoldDeadlines` (`string[]`); `createTask` / `createTasks` resolve to `Task` / `Task[]` and a refused filing throws (`TaskFilingRefusedError`, `TaskCapExceededError`, plain `Error`); `takeSteers`, `ask`, `awaitExternal` extend the outcome with `taken` / `questions`. `ty:503-543`.

### 4.1 Members

| Member | Signature (short) | What it does | Source |
|--------|-------------------|--------------|--------|
| `collectionId` | `string` | Matches `data.collectionId` on emitted `task-change` items. | `ty:559` |
| `partition` | `string?` | The partition this ref reads and writes, on a ledger declared with `partitionBy`. | `ty:560-570` |
| `now` | `() => number` | The clock that stamps and judges leases. Compare leases against it, not `Date.now()`. A hand-written ref should return `Date.now()`. | `ty:571-592` |
| `maxTotalRetries` | `number \| null` | The cumulative retry budget this ref enforces; `null` means none in force (also on the resource backing, which counts but does not enforce). | `ty:593-599` |
| `createTask(init)` | `Promise<Task>` | File one task. | `mt:495-497` |
| `createTasks(inits)` | `Promise<Task[]>` | File a batch (4.2). | `mt:499-501` |
| `claim(workerId, options?)` | `Promise<Task \| null>` | Claim the next claimable task (6). `workerId` is trace attribution only. | `ty:606`, `mt:503-545` |
| `complete(id, output, options?)` | `Promise<TaskWriteOutcome>` | `in_progress → completed`; keeps a checkpoint as the output. | `mt:642-645` |
| `fail(id, error, options?)` | `Promise<TaskWriteOutcome>` | Soft or hard (3, 5.4). `FailOptions.noRetry` makes it hard whatever budget is left. | `mt:658-700`, `ty:444-465` |
| `cancel(id, reason?, options?)` | `Promise<TaskWriteOutcome>` | Advisory by construction: `ifAllowed` is forced on. A settled task declines `terminal`. `reason` is stored as `error`. `CancelOptions.via` records `cancelledVia`. | `mt:770-778`, `ty:750-762` |
| `hold(id)` / `release(id)` | `Promise<TaskWriteOutcome>` | `pending ↔ held`; take no options. | `mt:702-708` |
| `patchSettings(id, patch)` | `Promise<TaskWriteOutcome>` | Until the task first starts, change `held`, `deps` (replaced whole), `maxAttempts`, `goal`, `title`, `context`, `input`, `priority`, `labels` (replaced whole), `metadata` (merged) or `assignee` (`TaskSettingsPatch`). Declines `started` / `terminal`; `unchanged` when nothing changes. New `deps` are checked like a filing's and cancel the task if a dependency ended meanwhile. | `mt:710-715`, `ty:667-689`, `int:315-338,375-421` |
| `retry(id)` | `Promise<TaskWriteOutcome>` | Optional. See 3.6, 3.7. | `mt:717-732` |
| `steer(id, { message, from, by?, key? })` | `Promise<TaskWriteOutcome>` | Optional. Keep a message on an open task (9.3). | `mt:734-748` |
| `takeSteers(id, { claim, takenIn })` | `Promise<TaskWriteOutcome & { taken? }>` | Optional. Mark the steers that arrived since the claim as taken by that attempt, in the read named `takenIn`. Needs the claim's ticket. Resolves to the outcome plus the ids taken; a re-run under the same `takenIn` takes none. | `mt:750-768` |
| `renewLease(id, leaseUntil, { claim })` | `Promise<TaskWriteOutcome>` | Push the lease out. Ticket required. Writes one field; publishes no `task-change`. Throws on a non-finite deadline or a missing ticket. | `mt:552-563`, `ty:763-807` |
| `reclaim(now?)` | `Promise<number>` | Reset every `in_progress` task whose lease has passed to `pending`; returns the count; one `task-change` `resumed` each. Unbounded (does not spend the abandonment allowance). A row with an open hold is left alone. | `mt:780-805`, `ty:1017-1032` |
| `linkRun(id, run, { claim })` | `Promise<TaskWriteOutcome>` | Record which run is working the task. Writes `run` only. Publishes `run_linked`. Ticket required. | `mt:576-579`, `ty:810-837` |
| `reportProgress?(id, { statusNote?, output? }, { claim })` | `Promise<TaskWriteOutcome>` | Optional. A checkpoint becomes the output from then on. Publishes `progress_reported`. | `mt:647-656`, `ty:838-862` |
| `recordSpend?(id, write, { claim })` | `Promise<TaskWriteOutcome>` | Optional. Fenced by row identity only: a terminal row and a lapsed claim still take it. Publishes no `task-change`. | `mt:565-574`, `ty:863-883` |
| `setKeptOpenBy?(id, value, options)` | `Promise<TaskWriteOutcome>` | Optional. Record what a running task waits on, or that it waits on nothing. | `mt:581-593`, `ty:889-943` |
| `ask?`, `awaitExternal?` | `Promise<TaskWriteOutcome & { questions? }>` | Optional. See 9. | `ty:951,972` |
| `answer?` | `Promise<TaskWriteOutcome>` | Optional. See 9. | `mt:595-640` |
| `payHoldDeadlines?()` | `Promise<string[]>` | Optional. The ids of the tasks it closed a question on. | `ty:1001`, `mt:629-640` |
| `createTask`, `createTasks`, `payOwedCascades?` | `Task`, `Task[]`, `number` | Not outcomes. | `ty:602-603,1182` |
| `setAssignee(id, assignee)` | `Promise<TaskWriteOutcome>` | Declines on a terminal task, and `immutable-assignee` on an `in_progress` task of a dispatching board. `unchanged` when equal. A follow-up declines `follow-up`. | `mt:806-830`, `ty:1065-1066` |
| `setPriority`, `addLabel`, `removeLabel`, `patchMetadata` | `Promise<TaskWriteOutcome>` | Write to a terminal task too. Answer only `recorded` or `unchanged`; `patchMetadata` merges and answers `recorded` even when nothing changes. | `mt:830-852`, `ty:1065-1066` |
| `payOwedCascades?()` | `Promise<number>` | A touch of the board: pay every cascade owed past its due time; returns how many. | `mt:898`, `ty:1182` |
| `get(id)` | `TaskHandle \| undefined` | | `mt:905` |
| `getCommitted?(id)` | `Promise<TaskHandle \| undefined>` | Optional. The row as stored now, where `get` reads it as this request first did. | `ty:1205` |
| `refresh?(id)` | `Promise<void>` | Optional (resource backing). Bring one row up to its committed state; writes nothing. | `ty:1194` |
| `list(filter?)`, `count(filter?)` | | | `mt:919-926` |
| `clearResumeOwed?`, `markCancelOwed?`, `markWait?`, `lapseWait?`, `releaseWait?`, `dropNoticeReadByWait?`, `takeNotice?`, `filerOf?`, `tellMidwayQuestions?` | | Optional. The wait and notice writes a board uses for `getTask`'s `wait` and a filer's ending notice; both built-in backings implement them. A ref without them cannot host a wait. | `ty:1081-1178` |

The reference should list the members a pattern or user calls (`createTask` … `list`, `count`, `renewLease`, `reclaim`, `steer`, `takeSteers`, `ask`, `answer`, `retry`) and say that a hand-written ref without the optional wait and notice methods cannot host a wait; both built-in refs have them.

### 4.2 Filing a batch

- 4.2.1 `createTasks` checks every row before writing any: filing settings, then dependencies (an id not on the board or in the batch, a dependency already failed or cancelled, a loop), then that the filing task is not cancelled. A refusal throws `TaskFilingRefusedError { rule, taskId }` and files none of it. Ids in the same batch count as on the board, so a batch can file a whole chain. A batch row filed already `failed`/cancelled counts as an ended dependency; a plain ref never checks a batch for a repeated id: on the state backing a repeat throws a plain `Error` (`[tasks] task with id "x" already exists`) and files nothing, on the resource backing it throws at the second `create` and the earlier rows stay filed. `duplicate_task_id` is raised only by Workforce's conversation board. `mt:439-480`, `fil:307-358`, `fst:182-254`.
- 4.2.2 On the state backing the insert is one conditional write, so a store failure also leaves nothing. On the resource backing the check runs first and the rows are then created one at a time, so a failure part-way through leaves the earlier rows in place. `sb:231-250`, `rb:658-668`, `caps` header ("Resource-backed" bullet). [source]
- 4.2.3 After the rows commit, a dependency that ended while they were written cancels its dependents (repeated until nothing more cancels). `mt:439-480`. [source]
- 4.2.4 A refusal rule code (`TaskFilingRule`): `questions_not_kept`, `dependency_not_on_board`, `dependency_ended`, `dependency_loop`, `setting_not_supported`, `follow_up_takes_no_session`, `follow_up_takes_no_target`, `follow_up_takes_no_result_to`, `conversation_result_one_attempt`, `setting_not_from_task_session`, `duplicate_task_id`, `follow_up_of_unrun`, `parent_cancelled`. The error's message starts with the code. A plain collection raises ten of the thirteen; `setting_not_from_task_session`, `duplicate_task_id` and `follow_up_of_unrun` come from Workforce's conversation board's own filing path. `fil:18-74`, `state-backed.ts:236-239`, `resource-backed.ts:658-665`, `workforce/src/conversation-board/board.ts:1233-1235,1530-1531`.
- 4.2.5 A replan batch (`planAndExecute`, `supervisor`'s plan) differs: a task whose dependency already ended is filed `cancelled` and `skipped`, with the batch tasks that depend on it. Every other refusal (a dependency on no task, a loop) fails the run. `ar:225-262`, `PT`plan-and-execute.test.ts:304-390.
- 4.2.6 Exceeding a creation cap throws `TaskCapExceededError { cap: "total" \| "enqueued", limit, attempted }` after the write no-ops; nothing is inserted. `caps:143-169`.

### 4.3 Reads

- 4.3.1 `list(filter)` and `count(filter)` read the committed view the ref holds. On the resource backing the view is hydrated when the ref is built, and two refs resolved in one request over one collection see each other's adds at once. A write another request makes is visible to a later request, not to one already running. `ty:503-542`, `sts:30-60`, `SUB` "Backings".
- 4.3.2 `getCommitted(id)` (and `refresh(id)`) bring a row up to what is stored now. `ty:1194-1205`.

## 5. Backings, options and caps

### 5.1 `getOrCreateTaskCollection(options)`

Async whichever backing; always `await`. Throws before touching storage when `backing` is neither `"state"` nor `"resource"` (so the board's `"request"` and `"sequencer"` names are refused here) or when `state` is present but `null`/`undefined`. `goc:147`, `goc:366-401`.

| Option | Backing | Meaning | Source |
|--------|---------|---------|--------|
| `ctx` | both | The block context. | `goc:122-125` |
| `backing` | both | `"state"` or `"resource"`. | `goc:75,91` |
| `collectionId` | both | Names the collection; matches `data.collectionId` on items. | `goc:39-43` |
| `now` | both | Clock injection. Default `Date.now`. | `goc:39-47` |
| `changeVisibility` | both | Visibility stamped on the `task-change` items. Default `{ client: true, history: false }`. **Not an option of `taskBoard`.** | `goc:48-54`, `goc:217`, `T`tasks/change-visibility.test.ts:45-100 |
| `state` | state | A state ref (e.g. `ctx.sequencer`). Omitted: the tasks live on the request. | `goc:75-94` |
| `stateKey` | state | The field holding the `Record<id, Task>`. Default `"tasks"` on a passed `state`; the `collectionId` on the request. A passed ref's schema must hold a record at that key. | `goc:230`, `goc:87-94` |
| `maxTotalTasks`, `maxEnqueuedTasks`, `maxTotalRetries` | state | The caps (5.5). Accepted on the state arm only: asking for one on the resource arm is a type error. | `goc:75`, `caps:174-218` |
| `collection` | resource | The resource collection ref, e.g. `ctx.resources.orgTasks`. | `goc:91-99` |
| `immutableAssignee` | resource | Refuse `setAssignee` on an `in_progress` task. Set for a board with dispatching assignees. | `goc:100-107` |
| `partition` | resource | Required when the collection was declared with `partitionBy`, refused otherwise; a non-empty string. | `goc:108-114`, `goc:355-374` |
| `readFor` | resource | The conversation a user view reads for, in place of the running session. | `goc:115-126` |

- 5.1.1 The board maps its own `collection` config onto this: `request` (the default, `collectionId` defaults to the board `name`) = `backing: "state"` with no `state`; `sequencer` = `backing: "state"` with the board sequencer's own state (and `stateKey`); a `defineTaskCollection` value = the resource backing, resolved from `ctx.resources`; `factory` = a caller's `(ctx) => TaskCollectionRef`, passed through unchanged (its `collectionId` reads `"factory-supplied"`). `tb:1485-1625` [source], `tb:567` (`TaskBoardBacking`).
- 5.1.2 A `state` backing with no `state` keeps the tasks on the request: they survive every block boundary in the request and end with it. With `state` passed they live as long as that state: a sequencer's state is checkpointed and restored on resume; a generator's own state is not. `goc:58-75`, `caps:56-74`.
- 5.1.3 Two boards in one request each get their own slot: the default `stateKey` is the `collectionId`. `goc:230`.
- 5.1.4 A task added through a request-backed ref before `board.drain` runs is seen by the drain when both name the same `collectionId`; this is what a seed handler does. `examples/guides/custom-pattern/src/plan-map-reduce.ts:48-98`.

### 5.2 `defineTaskCollection(options)`: a durable ledger

Declares a resource collection `<id>/**` at `session`, `user` or `org` scope, validated against the `Task` envelope with `input` narrowed to `stateSchema`. Pass it to `taskBoard({ collection })`; the board registers and resolves it. `dtc:1-26,202-260`.

| Option | Meaning | Source |
|--------|---------|--------|
| `id` | Literal collection id: the resource pattern (`<id>/**`), the `ctx.resources` lookup key, the board's `collectionId`. One plain segment: no `*`, `[param]`, `/`, or prototype-poisoning name. | `dtc:107-113`, `dtc:202-213` |
| `scope` | `"session"`, `"user"` or `"org"`. | `dtc:114-115` |
| `sharedToLineage` | One ledger across the session lineage, so a dispatched child session settles against the same rows. Session scope only. | `dtc:116-126` |
| `partitionBy` | `(ctx) => string \| Promise<string>`: one set of rows per partition, at the owner's user scope. `user` scope only; not with `maxInstances`. Sees only server-set identity (`sessionId`, `lineageId?`, `userId`, `orgId?`, `tenantId?`). Task ids must be one path segment. Rows load a partition at a time; the collection keeps a `byTaskId` index so a bare id can be found (the finder, `findTaskPartitions`, is exported only from `/internal`, outside semver, and is not named on the page). | `dtc:127-150`, `dtc:272-296`, `part:19-73` |
| `recordEnding` | `(row, ending) => row`: runs inside every ending write; only the returned `metadata` is kept. Must be pure (it may run twice). `ending` is `completed`, `errored`, `retried` or `cancelled`. | `dtc:151-164`, `end:33-84` |
| `settings` | `{ session?: ["new"\|"ongoing"], resultTo?: ["filer"\|"conversation"] }`: the filing settings the ledger honours beyond the defaults (`["new"]`, `["filer"]`). | `dtc:165-173`, `fil:74-79,108-117` |
| `cascadeFiled` | `{ owes(row, ending), pay(ctx, row) }`: cancels the open tasks a failed, retried or cancelled task filed elsewhere. | `dtc:174-180`, `dtc:85-102` |
| `delivery` | How endings reach the sessions that filed them. | `dtc:181-188` |
| `stateSchema` | Zod schema for each task's `input` (default `z.unknown()`). | `dtc:189-194` |
| `maxInstances` | Cap on rows retained. A capacity limit, not a lifetime ceiling: `delete` frees a slot. | `dtc:195-196`, `caps:75-90` |

- 5.2.1 A `defineTaskCollection` value carries no `client` config, so a browser reads none of its rows until the declaring layer adds one (`client: { state: { read: true }, expose: [...] }`, as Workforce's ledger does, 13.7). `dtc:250-259` (no `client`), `core`types/resource.ts:95-112.
- 5.2.2 `freezeLedgerAssignee` / the dispatching board marks the ledger so `setAssignee` is declined on any resolution of it while an attempt holds a task. Over-reach: one declaration reused across two flows whose storage does not overlap freezes both. `dtc:298-371`. [source]

### 5.3 Where each backing lives and how long it lasts

| Backing | Tasks live | Lifetime | Source |
|---------|-----------|----------|--------|
| `state`, no `state` | On the request (`ctx.request`), at the `collectionId` | The request | `goc:58-75` |
| `state`, `state: ctx.sequencer` (or another state ref) | On that state, at `tasks` | One sequencer invocation; checkpointed with the sequencer; a generator's own state is not | `goc:58-75`, `caps:56-74` |
| `resource` | A resource collection declared with `defineTaskCollection` | As long as the resource at its scope | `dtc:1-26` |

### 5.4 Retry budgets

The page states these rows on `reference/task-board` (Retries) and keeps only a pointer and the ref property `maxTotalRetries` (`null` on the resource backing).

- 5.4.1 `maxAttempts` (per task): `fail` re-pends while `attempts - abandonments < maxAttempts`, capturing the error as `feedback`; otherwise terminal `errored`. Unset: single attempt. `int:540-543`, `SUB` "Soft fail vs hard fail".
- 5.4.2 `maxTotalRetries` (per ledger): cumulative failure retries the collection may authorize. The budget is spent at authorization, not at the next claim. `0` is legal (run every task once). `null` is unbounded. Only failure retries count: `reclaim` and an answered question do not. A retry refused by the budget settles the task `errored` with `retryLedger.deniedByBudget: true`. Enforced on the state backing only; the resource backing counts and reports `maxTotalRetries: null`. A task persisted before the count existed reads zero. `caps:180-243`, `int:581-640`.

### 5.5 Creation caps

A filed task's `status` is `pending`, or `held` when `held: true`, or the `status` given (`cancelled` keeps its `error` and `causedBy`). `int:97,132-135`.

| Cap | Meaning | Default where the board or a pattern builds the collection | Source |
|-----|---------|------------------------------------------------------------|--------|
| `maxTotalTasks` | Lifetime count of all tasks, terminal included; never refunded | 500 | `caps:221` |
| `maxEnqueuedTasks` | `pending` count at creation; refreshes as tasks leave `pending` | 100, lowered to `maxTotalTasks` when that is smaller | `caps:224`, `caps:355-368` |
| `maxTotalRetries` | See 5.4.2 | 50 | `caps:243` |

- 5.5.1 Values must be positive integers, or `null` for unbounded (`maxTotalRetries` may be `0`). An explicit `maxEnqueuedTasks` above the resolved `maxTotalTasks` throws. `caps:254-271`, `caps:322-365`.
- 5.5.2 Defaults apply on the defaulting surfaces (`taskBoard`, the board capability, `eventActors`). A direct `getOrCreateTaskCollection({ backing: "state" })` applies none: an omitted axis is unbounded. `caps:180-204`.
- 5.5.3 No cap is a stored counter; each is derived from the ledger at check time. They last as long as the ledger. A ref built without the options enforces nothing and can insert past the bounds: every writer for a bounded board must resolve through the board's own factory or capability, or be handed `board.caps`. `caps:37-132`.
- 5.5.4 `eventActors` opts its retry budget out with `null`. `P`eventActors/index.ts:242-264.

## 6. Claim rules a user can observe

### 6.1 What a claim takes

- 6.1.1 A row is claimable (`isClaimable(task, lookup, now)`) when it has no open hold, every id in `deps` names a task that is `completed` (a missing task counts as unmet), and it is either `pending`, or `in_progress` with a lapsed lease, or `in_progress` owing a turn on the same attempt. A `held` row is never claimable whatever its `deps`. `int:932-942,1053-1063`, `T`collection/one-claim-gate.test.ts:32-60.
- 6.1.2 `claim` scans the claimable rows in order (default: ascending `createdAt`, ties by id), and commits the first one that still passes on the committed row, as one conditional write. It claims at most one. `int:1100-1103`, `mt:503-545`.
- 6.1.3 A caller's `eligibility(task, rows)` **narrows** the claimable set (0.4). Do not assert `status === "pending"` in it: an abandoned task is `in_progress`, so that switches recovery off for the claim. `ty:228-270`, `rec:165-200`.
- 6.1.4 `order(a, b)` replaces the default comparator. `priorityClaimOrder` sorts by `priority` descending (unset reads 0), then `createdAt`, then id. `fifoClaimOrder` adds nothing: it is the default order. `O`tasks/claim-orders/priority.ts:19-34, `fifo.ts:13-17`.
- 6.1.5 A claim sets `status: in_progress`, `attempts` + 1 (unless it takes a turn on the same attempt), `turn` + 1, `leaseUntil` = now + lease, `leaseDurationMs`, `claimedBy`, `startedAt` (kept if already set), clears `keptOpenBy`, `retryPending`, `turnOwed` (and `run`, unless it only takes a turn on the same attempt), and marks every steer taken by the new attempt. A recovery also advances `abandonments`. `int:1396-1450`.
- 6.1.6 A claim returns `null` when nothing is claimable, and also when it lost a race. It may still write: a row whose abandonment allowance is spent is settled `errored` in the claim write and the scan goes on to the work behind it. `mt:503-545`, `rec:220-290`.
- 6.1.7 `ticketForClaim(collectionId, claimedTask, partition?)` mints the ticket a fenced write presents. Its fields: `collectionId`, `taskId`, `attempt`, `createdAt`, `turn`, and `incarnationId`, `assignee`, `createdBy`, `partition`, `followUpOf` when set. `O`tasks/claim-ticket.ts:151-174.

### 6.2 The lease

- 6.2.1 Every claim carries a lease. `ClaimOptions.leaseDurationMs` default **120,000 ms (2 minutes)**. A value below 1,000 ms, above 2,147,483,647 × 3 ms (about 74.5 days), or not finite **throws**; nothing is rounded into range. `int:1120,1130,1142,1160-1180`, `ty:271-301`, `rec:341-360`.
- 6.2.2 A row you claim by hand gets no renewal; you renew it with `renewLease(id, deadline, { claim })`. A worker the board drives is renewed for you (the board starts a renewal driver per claim). `ty:271-301`, `tb:1104` [source].
- 6.2.3 Renewal drivers: `withLeaseRenewal({ collection, ticket, claimedTask, signal, run })` wraps single-call work and hands `run` a signal that aborts on request cancel or lease loss; `startLeaseRenewal(...)` returns `{ signal, stop }` for multi-step work and `stop()` must be called on every path out. One renewal goes out every third of the lease (`RENEWAL_DIVISOR = 3`): 40 s on the default. Settle the task inside `run`: the settling write is fenced and refused once the lease has lapsed. `O`tasks/lease-renewal.ts:57-66,100-190, `lf:86-133`.
- 6.2.4 A ticketed write on an `in_progress` task whose lease has lapsed declines `lost-claim`, including a renewal that commits after the lease it extends, and a settlement from a worker that ran past its lease. `lf:86-133`, `int:845-920`.
- 6.2.5 The one exception: `renewLease(id, deadline, { claim, adoptLapsedLease: true })`, for a claimant that has not started work. It takes the row back on the same attempt if nobody else has (`recorded`), else declines `lost-claim`. Ignored on any write but a renewal. `ty:371-419`, `lf:154-265`.
- 6.2.6 A row kept open (`keptOpenBy`) or waiting on an open hold has no lease and is left alone by `reclaim`; the lease answers "is a live worker on this right now". `ty:889-943`, `mt:780-805`.

### 6.3 One holder, and not exactly-once

- 6.3.1 Two claims racing for one task: one gets it, the other gets `null`. The loser is not an error. Two concurrent claims over two tasks return distinct tasks. `collt:164-185`.
- 6.3.2 This is a bound on concurrent holders, not exactly-once dispatch. A lease that runs out sends the task back (a crashed worker or a stalled one), so work can run twice. Only one attempt can record a result: a ticketed write from a worker that no longer holds the task is refused. Side effects the losing worker already caused stand. `O`tasks/claim-orders/types.ts:1-24 (doc), `lf:86-133`, `SUB` "What a durable board guarantees about ownership".
- 6.3.3 No ticket, no ownership check: a coordinator settling or cancelling on its own board presents none. The check is opt-in at the call. `ty:350-361`, `lf:265-280`.
- 6.3.4 The guarantee covers concurrent executions inside one process. Two OS processes over a filesystem-backed store compare under an in-process lock, so each compares against its own view; use SQLite or Postgres for a board two processes share. `SUB` "The limit"; not pinned by a test; keep as the existing page's claim.

### 6.4 Abandonment, separate from `maxAttempts`

- 6.4.1 A task whose lease lapses is claimed again as a fresh attempt, up to **3 times** (`DEFAULT_MAX_ABANDONMENTS`, exported, no option raises it). The next claim that finds it lapsed settles it `errored` instead, in the claim write, with `[tasks] task "<id>" was abandoned by its worker 3 times without completing. Not re-dispatched.` That is four runs at most (the first plus three recoveries). `int:512`, `int:1078-1097`, `int:1089-1097`, `mt:503-545`, `rec:220-235`.
- 6.4.2 The allowance is its own. `fail` retries while `attempts - abandonments < maxAttempts`, so two crashes of a `maxAttempts: 3` task leave all three tries (two failure retries; the first two failures re-pend and the third is terminal). A task with no `maxAttempts` still gets the 3 recoveries. `int:520-543`, `rec:281-318`.
- 6.4.3 The settlement publishes a `task-change` (so a stream does not keep showing `in_progress`) and pays the task's cascade. `rec:236-252`, `mt:529-545`.
- 6.4.4 Recovery takes about one lease plus one idle-wake period. A board's idle worker wakes on a `task-change` for its collection, or on its own timeout of `max(idlePollMs × 100, 50)` ms (5,000 ms at the default `idlePollMs` of 50). An expiring lease writes nothing, so nothing wakes a sleeper on it. `tb:694,721-725` [source], `O`tasks/collection/predicates.ts:19-45. (Board option; belongs to R-23, named here for the recovery number.)

### 6.5 Settling, and what a decline does to it

- 6.5.1 `complete` and `fail` with no options: an illegal transition throws `IllegalTaskTransitionError`. `cancel` forces `ifAllowed: true` after spreading the caller's options, so it never throws on one: a terminal task declines `terminal`. With `ifAllowed: true`, a refused write becomes a `declined` verdict instead; with `claim`, the ownership check runs too. `cancel` is advisory without being asked. `ty:315-361`, `mt:770-778`.
- 6.5.2 Without options a legal transition goes through even when another attempt already recorded a result: `completed → completed` is legal, so a second unguarded `complete` overwrites the first output. `SUB` "Recording a result that may no longer apply"; `ts:65-69` (same-status allowed).
- 6.5.3 `refuseUntakenSteers: true` on a `complete` declines `untaken-steers` while the task holds a message its attempt has not taken. `ty:362-369`.
- 6.5.4 A task with an open hold settles only by a cancel: `complete`, `fail`, lease renewal decline `open-question`. `ty:144-151`, `int:845-920`.
- 6.5.5 A hand-written `TaskCollectionRef` has three obligations: implement `renewLease` fenced by the claim ticket; make its own `claim()` consider lapsed rows, take them over as a new attempt and settle one whose abandonment allowance is spent; refuse any ticketed write once the lease has run out (except a renewal passing `adoptLapsedLease`). It also has to take the trailing options argument on every write and decide the guards inside its own atomic section. Use the exported `isClaimable(task, lookup, now)` and `committedLeaseSpan(task)`. A ref ignoring the options still lets a board finish: a result that arrives after its lease is dropped and the drain goes on, but its writes are not guarded. The page states this once, in the hand-written ref list. `ty:503-542,763-807`, `SUB` "A `TaskCollectionRef` of your own".

## 7. What a write reports

### 7.1 `TaskWriteOutcome`

```ts
type TaskWriteOutcome =
  | { outcome: "recorded" }
  | { outcome: "unchanged" }
  | { outcome: "declined"; reason: TaskWriteDeclineReason; status: TaskStatus };
```

`recorded`: a field changed and a `task-change` went out (a renewal is the exception: it changes `leaseUntil` and emits none). `unchanged`: the task already held that state; nothing written, no item. On the resource backing the underlying write still runs, so a `resource_change` may fire for an `unchanged`. `declined`: refused; `status` is the status observed inside the write. A decline is a value, not an error. A missing task, a store failure, or a write that keeps conflicting with other writers until it gives up (CAS exhaustion, no named error class), throws. `ty:172-222`.

### 7.2 Decline reasons (`TaskWriteDeclineReason`, 16)

Precedence when several hold: `immutable-assignee`, `terminal`, `not-my-task`, `disallowed`, `lost-claim`. The rest are decided by their own verbs. `ty:65-176`.

| Reason | Meaning | Source |
|--------|---------|--------|
| `immutable-assignee` | A dispatching board, and an attempt holds the task (`in_progress`, one waiting on a person included). A pending or held task can still be reassigned. | `ty:104`, `mt:806-830` |
| `terminal` | The task already reached `completed`, `errored` or `cancelled`. | `ty:105` |
| `not-my-task` | The ticket names a different board, a different task, or an id since reused for a new task. Nothing about the target's state can make the write legal. | `ty:106` |
| `disallowed` | The state machine rejects the move from a non-terminal status (`pending → errored`). | `ty:107` |
| `lost-claim` | The ticket names this task but no longer owns it (reclaimed or re-queued, or its lease ran out while `in_progress`). | `ty:108` |
| `follow-up` | An assignee change on a follow-up: it keeps its root's worker. | `ty:114` |
| `started` | A `hold` / `patchSettings` on a task that has ever started. | `ty:121` |
| `unknown-status` | The stored status is not one the board knows. | `ty:126` |
| `untaken-steers` | A `complete` fenced with `refuseUntakenSteers` while a steer is untaken. | `ty:133` |
| `steer-limit` | A steer past 20 (an open question reserves one place for its answer). | `ty:141` |
| `open-question` | The row holds an open hold: a settlement, a lease renewal, or a second wait is refused. | `ty:150` |
| `answered` | An answer with other words or from another sender to an already-answered question. | `ty:153` |
| `no-such-question` | An answer naming no question or confirm on the row. | `ty:156` |
| `settling` | A retry of a row whose last ending is still owed (cascade, resume or cancel). | `ty:163` |
| `dependency-ended` | A retry of a row one of whose dependencies failed or was cancelled. | `ty:166` |
| `retry-budget` | A retry where `maxTotalRetries` is enforced and spent. | `ty:169` |


- 7.2.1 `setAssignee` is the only field setter that refuses anything. `setPriority`, `addLabel`, `removeLabel`, `patchMetadata` answer only `recorded` or `unchanged`. `ty:1065-1066`.
- 7.2.2 `lifecycle` methods that take `ifAllowed` / `claim` are `complete`, `fail`, `cancel`; `renewLease` and `linkRun` require `claim`; `hold`, `release`, `patchSettings` take no options. `ty:315-369`, `mt:702-715`.
- 7.2.3 If the options argument is dropped by a ref of your own, the verdict is whatever your methods return; the framework does not invent one. `ty:503-542`.

### 7.3 `TaskTransitionOptions`

`ifAllowed?: boolean` (decline a terminal task or a refused transition instead of throwing); `claim?: TaskClaimTicket` (decline `not-my-task` / `lost-claim`); `refuseUntakenSteers?: boolean`; `adoptLapsedLease?: boolean` (renewal only); `write?: TaskWriteToken`; `viaTool?: boolean` (set by the task tools only). `FailOptions` adds `noRetry?: boolean`. `CancelOptions` adds `via?: "tool" | "action"` and `whileHoldOpen?: string`. `ty:315-450`, `ty:444-465`, `ty:29-48`.

### 7.4 Telling whether a write landed

- 7.4.1 A write can commit and the call still throw. `const write = beginTaskWrite(tasks.get(id))` **before** the write, pass it as `options.write`, and after a throw read `didWriteLand(tasks.get(id), write)`: `true` (committed; its receipt is on the task), `false` (changed nothing: never landed, or the task already held that state), `undefined` (cannot tell: no provenance, the receipt aged out, or a different incarnation). `O`tasks/write-provenance.ts:83-110,151-175,254-280, `SUB` "Telling whether your write landed".
- 7.4.2 A task keeps its 4 newest receipts. `O`tasks/write-provenance.ts:68.
- 7.4.3 The methods whose options carry a token: `complete`, `fail`, `cancel`, `renewLease`, `linkRun`. `createTask`, `createTasks`, `claim`, `reclaim`, `hold`, `release`, `patchSettings`, `setAssignee`, `setPriority`, `addLabel`, `removeLabel` and `patchMetadata` advance `revision` but take no token. `ty:414-429`, `ty:405-420`.
- 7.4.4 A hand-written ref maintains none of this; absence reads `undefined`. `ty:414-429`.

### 7.5 `task-board-recorder-failure` (a result the board could not write down)

- 7.5.1 When a board's own result write committed but could not be announced, or the board cannot tell, it emits a persisted data item of type `task-board-recorder-failure`, visibility `{ client: false, history: false }`. Payload `RecorderFailureReport`: `collectionId`, `taskId`, `recorder` (`"complete"` or `"fail"`), `verdict`, `error` (the announcement failure's message), `runId?`. `rf:54-90`.
- 7.5.2 `verdict` is `"committed"` (the write landed; only the announcement failed) or `"undetermined"` (the board cannot tell whether it landed; permanent for every custom store and for a ref without write provenance). A write that demonstrably committed nothing produces no report. `rf:56-70`.
- 7.5.3 The failure waits for the drain's tail so sibling tasks finish, then the run fails with `TaskBoardRecorderFailureError` (`code: "task-board-recorder-failure"`, `reports`). A report that cannot be delivered is fatal at once: `TaskBoardReportFailureError` (`code: "task-board-report-failure"`), whatever `onError` says. `rf:210-250`. [source for the tail timing]
- 7.5.4 Late results dropped: a ref ignoring the options does not abandon every sibling when a result arrives late; the write-back conflict is contained and the late result is dropped. A store that is unreachable, or commits then fails on the way out, still throws and can fail the drain. `ty:503-542`.

## 8. Dependencies and cascades

- 8.1 `deps` ids must be `completed` before a claim. Unmet deps wait. A dependency whose task is missing counts as unmet. `int:932-942`.
- 8.2 Filing checks dependencies (4.2.1, 4.2.4): `dependency_not_on_board` (also for another board's id; to wait on other work, wait on it, or file the task held and release it later), `dependency_ended`, `dependency_loop`. `patchSettings({ deps })` checks the same way. `fil:307-358`, `fst:182-254`, `SUB` "Dependencies are checked when you file".
- 8.3 A task that fails for good or is cancelled cancels every open task that depends on it, then those tasks' dependents, to the end of the chain. Each is `cancelled`, labelled `skipped`, `error` = `dep <id> failed` or `dep <id> was cancelled`, `causedBy` = the task that ended. Retried or completed tasks owe nothing to their dependents. `casc:1-31,58-102`, `PT`plan-and-execute.test.ts:259-360.
- 8.4 The debt (`cascadeOwed`, `due` = write + a short interval) is written in the ending's own write and paid by the same call right after. A crash in between leaves it on the stored row; the next touch (a board's drain, or `payOwedCascades()`) pays it. A touch also cancels any unstarted (pending or held) task whose dependency has failed or been cancelled, which catches a dependent another process filed. `casc:17-25,145-213`, `mt:439-480`.
- 8.5 A task that fails, retries or is cancelled also cancels the open tasks it filed, on a ledger that declares `cascadeFiled` (Workforce's conversation ledger does; a plain board has none). `casc:13-25`, `dtc:174-180`.
- 8.6 A lapsed lease's reclaim writes no ending and cascades nothing: the re-run adopts the work. `casc:21-24`.
- 8.7 `retry` cancels no dependents; a dependent the failure cancelled stays cancelled until it is retried too. `int:454-495`.
- 8.8 A `planAndExecute` plan reports `errored` as `failed`, `cancelled` as `skipped`, `in_progress` as `in-progress`; `pending` and `completed` pass through. `PT`plan-and-execute.test.ts:259-360, `P`plan-and-execute/blocks/synthesize.ts:26-44 [source].

## 9. Holds, questions, steers

### 9.1 `TaskHold` (the shape in `Task.holds`)

Two sources, told apart by `source.kind`. `hd:1-112`.

| Field | Both | Meaning |
|-------|------|---------|
| `id` | yes | Unique on its task. A suspension hold's is its suspension id; an own hold's is minted when it opens. |
| `actor` | yes | `"user"` (the Inbox lists these) or `"system"` (an external wait). |
| `openedAt` | yes | Epoch ms. |
| `due` | optional | When it ends unanswered. Absent: waits until answered or cancelled. |
| `ask` | yes | `{ kind, prompt, title? }`. Own hold: `kind` is `question`, `confirm` or `external`, plus `onNo?: "cancel" \| "continue"` on a confirm (written on every confirm, `"cancel"` unless filed otherwise). Suspension hold: `kind` is `approval`, `review` or `input`. |
| `source` | yes | `{ kind: "task", closedBy: ({ by: "answer" } \| { by: "event", event, key })[] }` for an own hold; `{ kind: "suspension", requestId, suspensionId }` for the mirror of a task run's `suspendForUser` stop. |
| `midway` | own only | `true` when asked midway by the turn holding the claim, rather than at filing. |

- 9.1.1 A prompt is at most 1,000 characters, a task takes at most 20 questions, an `onNo` is allowed only on a confirm; no prompt may be empty. `hd:36`, `hol:138-163`.
- 9.1.2 `openHolds(row)` is the one predicate: an own hold is open while no steer carries its id (`TaskSteer.answers`); a suspension hold while it is on the row; none on an ended row. `holdActorOf(row)` is `"user"` while any open hold is a person's, else `"system"` while an external wait is open, else `undefined`. `hol:61-102`.
- 9.1.3 Holds differ from `held`: `held` is a status, set by the filer before a start; holds say what the row waits on for a person or an outside event, and the claim never takes a row with an open hold, at filing or midway. A held row settles only by a cancel. `int:1053-1063`, `tk:527-543`.
- 9.1.4 Filed on `questions`, the task stays `pending` and starts no attempt until each is answered; each answer joins the first attempt's brief. A worker asks midway with `ask(id, asks, { claim })` from the turn holding the claim: the write drops the lease and the turn ends unsettled, the task stays `in_progress`, and the last answer owes one more turn on the same attempt (not charged against `maxAttempts`). `ty:917-962`, `mt:595-608`.
- 9.1.5 `awaitExternal(id, wait, { claim })` opens one external wait (`actor: "system"`, kind `external`, never midway, no deadline), released by any steer that answers it. `wait` is `{ prompt, title?, events: { event, key }[] }`; at least one event, no blank name, key or prompt. The Inbox lists only `"user"` holds. `ty:947-992`, `hol:173-209`.
- 9.1.6 `answer(id, { questionId, message, from, by?, key? })`: kept as a steer carrying the hold's id; the last open answer lets the work go on in the same write. The same words from the same sender again is `unchanged`, even after the task has finished. Other words or sender: `answered`; finished row: `terminal`; unknown id: `no-such-question`. Who may answer which hold is the caller's rule. `ty:990`, `hol:220-283`.
- 9.1.7 A question has no deadline unless the host sets `userDeadlineMs` on the request host. Past it, `payHoldDeadlines()` (the board calls it for you, from the pass that pays what a board owes) closes the question with "No answer came before this question's deadline. Go on from your brief without it." and the work goes on as if answered. A question with no `due` is never closed that way. `goc:418-447`, `hol:27`, `ty:1001`.
- 9.1.8 A turn waits once: it cannot ask while its run waits on a stop, and its run cannot stop for a person while its own questions are open (`open-question`). `ty:144-151`, `mt:581-608`.
- 9.1.9 A cancel closes every hold; a cancelled row with a suspension hold keeps it only as the address of the `cancelled` resume it owes. `hol:1-18`.

### 9.2 Field editing rules for holds and settings

See 2.4. `held`, `deps` and `maxAttempts` change through `patchSettings` until the task first starts (4.1). `fr:1-75`.

### 9.3 Steers

- 9.3.1 `steer(id, { message, from, by?, key? })`. `from` is `"filer"` or `"user"` from callers; stored steers also have `"board"` (closing a question at a deadline) and `"service"` (words from outside the app, sender in `by`). At most 20 per task (`steer-limit`); a finished task takes none (`terminal`); `key` makes a repeat a no-op (`unchanged`). It changes no status, claim, lease or attempt, and records no ending. `st:1-50`, `mt:734-748`.
- 9.3.2 A steer to a task waiting on work it filed sets `keptOpenBy: "steer"` so a turn can start. `ty:715`.
- 9.3.3 A claim marks every steer taken by the new attempt (`takenBy`), and the worker input carries them all as `steers`. A request already working the task reads later ones with `takeSteers(id, { claim, takenIn })`; `takeSteers` resolves to an outcome with the `taken` ids, not the messages; run again under the same `takenIn` it takes none and names none. The re-read that returns the same messages is the board's steer-context helper (`steersTakenIn`), not a collection method. `int:1447`, `mt:750-768`, `skills/steer-context.ts:142-155`.
- 9.3.4 A steer is `taken` for the current attempt when `takenBy === attempts`. `getTask` lists steers oldest first with `at`, `answers?`, `taken`. `tt:278-294`.

## 10. What a newly started task knows about earlier work

### 10.1 The worker input (`TaskWorkerInput`, packed at claim time)

A worker is a plain block taking `TaskWorkerInput<TIn>`. Declare `taskWorkerInputSchema` as its `inputSchema` to receive every field; a declared schema is a filter, so a field it omits reaches no worker. `wt:1-39`, `ws:83-150`.

| Field | Type | Present when | Source |
|-------|------|--------------|--------|
| `taskId` | `string` | always | `wt:40` |
| `goal` | `string` | always | `wt:41` |
| `title` | `string?` | the task has one | `wt:42` |
| `context` | `string?` | the task has one (prose to render into the prompt, not a directive) | `wt:44-50` |
| `attachments` | `AttachmentReference[]?` | the task was filed with files | `wt:51-56` |
| `input` | `TIn?` | the task has one | `wt:57` |
| `deps` | `Record<depId, output>?` | at least one declared dependency has an `output` that is not `undefined`. Keyed by dep task id. Absent (not `{}`) when empty. Every dependency is `completed` by the time of a claim. | `wt:58-73`, `ws:98-108` |
| `attempts` | `number` | always (the attempt now running) | `wt:74` |
| `feedback` | `string?` | the last attempt failed with a retry left (soft fail), or a failed task was retried | `wt:75`, `mt:665-675`, `int:472` |
| `steers` | `{ message, from, question?, by? }[]?` | the task holds any, taken or not | `wt:76-96` |
| `followUpOf` | `string?` | the task is a follow-up | `wt:97-101` |
| `metadata` | `Record?` | the task has any | `wt:102` |
| `sealed` | `Record?` | the task was filed with one | `wt:103-108` |
| `priorWork` | `unknown` (a `TaskPriorWork`) | the board's flow policy selected at least one observation or a narrative | `wt:109-128`, `ws:109-125` |

- 10.1.1 Each optional field is an absent key, not a key holding `undefined`: a dispatched run's payload must be JSON-safe, and a present `undefined` is rejected by name. `ws:127-160`.
- 10.1.2 The worker returns its result; the board (or pattern) records it with `complete`. `wt:12-18`.
- 10.1.3 A task dispatched into a session of its own gets the same packed fields (`deps` and `priorWork` included) in its dispatch payload, which must be JSON-safe; a dependency output that is not JSON-safe refuses the dispatch after the claim. `O`task-board/blocks/dispatch-task.ts:170-180. [source]
- 10.1.4 Which pattern fills which field. Plan-shaped patterns (`planAndExecute`, `supervisor`, `parallelTasks`) file tasks through one mapping: planner `id` (generated `step-N` / `task-N` when absent), `title`, `context`, `deps`, `assignee`, `priority`, `input`, `maxAttempts` become the matching `TaskInit` fields (`supervisor` defaults `maxAttempts` to 3), `parallelTasks` also sets `input` to the goal. `eventActors` files `goal`, `assignee`, `input` (the entry), `metadata`. `routedSpecialists`, `roundRobin` and `debate` file `goal`, `assignee`, `metadata` and no `input`. `feedback`, `attempts` and `steers` come from the board whichever pattern filed the task. `P`shared/planning-entry.ts:11-15,90-155, `P`eventActors/index.ts:288-297, `P`routedSpecialists/index.ts:421-428. [source for the mapping]
- 10.1.5 `planAndExecute`'s step-executor adapter passes the executor only `{ stepId (the task id), goal, context?, dependencyResults? (the `deps` map) }`. It does not pass `priorWork`. Its evaluator and replanner do not read `priorWork` either. A sentence about what a task "sees" on that page is scoped to `context` and `dependencyResults`. `P`plan-and-execute/index.ts:430-460, grep: no `priorWork` anywhere under `P`.

### 10.2 Flow policy: which earlier tool calls a new task sees

- 10.2.1 The board keeps an in-memory **observation ledger** for each drain: every tool call any worker makes (the worker's tool executor writes one whether or not the tool is `cacheable`, and writes a cache hit too with `cached: true`). An entry is `{ seq, collectionId, taskId?, workerId?, toolName, args, result?, error?, cached, ts }`. It is cleared when the drain ends, on completion and on error, so a later drain starts empty. It holds at most 10,000 entries (oldest dropped); the board does not expose that number. `fp:28-51,91-180`, `fpw:285,339`, `core`blocks/internal/tool-executor.ts:208-220,338-345, `cd:1-60`.
- 10.2.2 Before each dispatch the board calls the configured `TaskFlowPolicy.select({ task, ledger, collection, ctx })` once. A selection with at least one observation (or a non-empty `narrative`) becomes `TaskWorkerInput.priorWork`; otherwise the key is absent. The board never injects prior work into a prompt: surfacing it is the worker's call. `ws:109-125`, `fp:186-234`, `T`task-board/task-board-flow-policy-backcompat.test.ts:22, `pwd:19-60`.
- 10.2.3 `TaskPriorWork`: `observations: { taskId?, toolName, args, result?, error?, cached, ts }[]`, `narrative?`, `meta?: { policy, selected, available, tokensApprox? }`. `fp:186-219`.
- 10.2.4 The board's default is `flowPolicy.declaredDepsOnly()`; `planAndExecute` pins `recentTrajectory({ n: 8 })`; `supervisor` pins `declaredDepsOnly()`. An unrecognised `flowPolicy` value falls back to the default rather than throwing. `tb:541`, `fpw:208`, `P`plan-and-execute/index.ts:732, `P`supervisor/index.ts:387-391, `fpw:176-193`.

| Policy | What it selects | Source |
|--------|-----------------|--------|
| `flowPolicy.none()` | Nothing. | `fp:246-265` |
| `flowPolicy.declaredDepsOnly()` | Observations made by the tasks in the new task's `deps`. Empty when it has none. | `fp:253-281` |
| `flowPolicy.ancestors({ transitive? })` | Like `declaredDepsOnly`; with `transitive: true` also its dependencies' dependencies, read from the live collection. | `fp:267-293` |
| `flowPolicy.recentTrajectory({ n, maxTokens? })` | The last `n` observations across all tasks, regardless of dependencies; then the newest that fit `maxTokens`. | `fp:277-307` |
| `flowPolicy.allCompleted({ maxTokens? })` | Every observation from a task now `completed`. | `fp:290-320` |
| `flowPolicy.compact({ recentN, summarizer? })` | The last `recentN` observations. `summarizer` is accepted and unused. | `fp:309-338` |
| `flowPolicy.custom(select, label?)` | Whatever `select` returns; `label` is stamped on `meta.policy` (default `"custom"`). | `fp:320-347` |

- 10.2.5 `maxTokens` uses a characters-over-4 estimate of `args` plus `result` or `error`; it keeps the newest entries that fit and stops at the first that does not. A `maxTokens` of 0 or less selects none. `fp:136-155`.
- 10.2.6 `ObservationLedgerView` for custom policies: `all()`, `recent(n)`, `fromTasks(ids)`, `fromAncestors(task, collection, { transitive? })`, `fromCompleted(collection)`, `bounded(observations, maxTokens)`. `fp:55-79`.
- 10.2.7 `formatPriorWork(priorWork)` renders `Prior work in this run:` then one `- [taskId] tool(args) → result: …` line each, or `→ error: …` when the observation has an error (never both, no pipe), `(cached)` appended for a cache hit; args cut at 200 characters, a result at 400, an error at 200. Empty string for no observations. `fp:353-375`.
- 10.2.8 Concurrent drains of one board in one process each keep their own ledger: a second drain installing and tearing down does not take the first's `priorWork` away. `cd:1-60`.
- 10.2.9 Not pinned by any test, so leave out: whether tool calls inside a task dispatched into a session of its own reach the drain's ledger.

### 10.3 Tool-result memoization (the second half of flow policy; one line on the page, a link out)

- 10.3.1 A tool opts in with `cacheable` on its `BlockConfig`: `true` for defaults, or `{ ttl?, scope?, keyFn?, cacheIf? }`. `ttl: 0` disables caching. `core`types/block.ts:1130-1175.
- 10.3.2 `taskBoard({ toolCache })` is `boolean | { enabled?, defaultTtl?, maxEntries?, defaultScope? }`. Default: on when any tool in the workers declares `cacheable`; `false` always wins. Store defaults: 5 minutes, 5,000 entries (LRU), scope `"run"`. The store is built per drain and lives in memory. A cache hit emits a normal `tool_output` item with `cached: true` and `cacheAgeMs`; a cross-task hit also carries `sourceTask: { collectionId, taskId }`. `tb:548-557`, `fpw:200-206,271-284`, `core`blocks/tool-cache.ts:185-186, `core`blocks/internal/tool-executor.ts:325-345.
- 10.3.3 The ledger is independent of the cache: a tool that is not cacheable still lands in the ledger. `core`blocks/internal/tool-executor.ts:196-220.

## 11. Items and notices a collection emits

- 11.1 Every mutation that writes a lifecycle change emits a `task-change` data item, `{ collectionId, taskId, kind, task, prevStatus? }`, keyed `${collectionId}/${taskId}` so the latest per task replaces the previous. Default visibility `{ client: true, history: false }`. `task` is the post-mutation row minus `claimedBy`, `createdBy`, `filer`, `filedUnder` (`SERVER_ONLY_TASK_FIELDS`; `toEmittedTask` is exported). `prevStatus` is omitted when the mutation did not change status. `goc:36,206-231`, `ev:16-166`.
- 11.2 `kind` (23): `added`, `claimed`, `completed`, `errored`, `retried`, `retry_requested`, `held`, `released`, `settings_changed`, `resumed`, `cancelled`, `label_changed`, `metadata_changed`, `priority_changed`, `assignee_changed`, `run_linked`, `progress_reported`, `resume_settled`, `steered`, `cancel_owed`, `wait_changed`, `asked`, `answered`. `ev:16-72`.
- 11.3 `retried` is a failure with attempts left (an ending); `retry_requested` is a person's or an app's retry (not an ending). `resumed` is `reclaim`. `run_linked` is published on the run's own session. `ev:20-60`.
- 11.4 Writes that emit no `task-change`: `renewLease`, `takeSteers`, `recordSpend`, `setKeptOpenBy`. They still reach a view of the board through a board notice. `ty:763-807,863-943`, `ev:97-116`.
- 11.5 Every committed write of a row also publishes a **board notice** naming `{ board, taskId }` to the session that filed the row (the running session when the row names none), carrying no rows; a view reads the board again when one arrives. A row added to a resource-backed ledger is also announced on the ledger's own scope topic (naming its partition). `goc:188-209`. [source for the publish]
- 11.6 `onTaskChangeFor(collectionId)` is the wake filter for `.waitForCondition({ wakeOn })`: true only for `task-change` items of that collection. `O`tasks/collection/predicates.ts:19-45.

## 12. Where the data lives (the four questions)

Owner, who can see it, where it is stored, how many.

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
|-------------|-------------|----------------|--------------------|----------|
| A task record on a **request-backed** board (the default `taskBoard` collection; `getOrCreateTaskCollection({ backing: "state" })` with no `state`) | The running request; `createdBy` stamps the filing user | The flow's blocks through the ref. A browser sees only the `task-change` items, which `taskBoard` stamps `{ client: true, history: false }`; those carry every field except `claimedBy`, `createdBy`, `filer`, `filedUnder`. | `ctx.request` state, at `[collectionId]`; ends with the request | One per task. `taskBoard` defaults: 500 total, 100 enqueued, 50 retries (5.5). A direct `getOrCreateTaskCollection` has no default cap. |
| A task record on a **sequencer-backed** board; also the entries `routedSpecialists`, `roundRobin` and `debate` keep | The sequencer invocation | Same as above | The sequencer's state at `tasks` (or `stateKey`); checkpointed with the sequencer and restored on resume | `routedSpecialists`: one per iteration where a specialist was picked (`maxIterations`, default 10, `P`routedSpecialists/index.ts); `roundRobin`, `debate`: one per agent per round; same caps as above |
| A task record on a **resource-backed** ledger (`defineTaskCollection`) | The scope you declare: `session`, `user` or `org`; `sharedToLineage` shares one ledger across a session lineage; `partitionBy` keeps one set per partition at the owner's user scope | The flow's blocks through the ref. A browser reads entries only if the declaring layer sets `client.state.read` (and `expose`/`exclude` to limit fields). `defineTaskCollection` sets none. | A resource collection at `<id>/<task id>` (`<id>/<partition segment>/<task id>` on a partitioned ledger), in the user's own cell on a partitioned ledger even on a flow that isolates its user state | One per task. No cap is enforced by the resource backing except `maxInstances` (a capacity limit that `delete` frees); it counts retries but does not enforce `maxTotalRetries` |
| A Workforce conversation's board (`CONVERSATION_LEDGER_ID = "tasks"`) | The user whose conversation filed the task | The same user only, from any of their sessions, in a browser read; never another user's. 22 board fields are sent; `input`, `output`, `metadata` and the write log are not (13.7). | One durable collection at the user scope, entries keyed under the filing conversation's partition (`<session id>~<digest of its lineage id>`) | One record per task filed |
| `task-change` items | The session that made the change | The client, by default; never the model (`history: false`) | The response's item stream | One per committed lifecycle change; keyed so the latest per task replaces |
| Board notices | The session that filed the record | Subscribers of that session's `tasks` topic | Transient | One per committed write |
| Observation ledger | The drain | Policies (`select`) and workers reading `priorWork`; not a client | Memory; cleared when the drain ends | Up to 10,000 entries, oldest dropped |
| Tool-result cache | The drain | Cacheable tool calls in that drain | Memory (LRU); built per drain | Up to `maxEntries` (default 5,000), each for `defaultTtl` (default 5 minutes) |
| `holds`, `steers`, `retryLedger`, `writeLog` | The task record | As the record | In the record | A task takes at most 20 holds' worth of questions and 20 steers (an open question reserves a place for its answer); `writeLog` keeps 4 receipts |

Sources: rows 1-3 `goc:58-75,217`, `caps:37-132`, `dtc:1-26,127-150`, `part:19-30`, `tb:1485-1625`; row 4 `wf`conversation-board/ledger.ts:84-152, `wf`conversation-board/filing-session.ts:95-112, `wft`conversation-board-browser-read.test.ts:31-90; ledger and cache `fpw:271-340`, `fp:91-180`; counts `caps:221-243`, `st:10`, `hd:36`, `O`tasks/write-provenance.ts:68; client visibility of resource collections `core`types/resource.ts:95-112. The routedSpecialists/roundRobin/debate rows keep the tasks on `ctx.sequencer`: `P`routedSpecialists/index.ts:300-312, `P`round-robin/blocks/record-contribution.ts:52-62, `P`debate/blocks/record-argument.ts:45-60. [source for the two-line mapping to `maxIterations`]

## 13. Task tools

Skills-side. The reference names them and their results; the exact prose of each tool description is not a contract. `tt:1175-2330`.

### 13.1 The tools

- 13.1.1 Filer's tools (`createTask`, `getTask`, `listTasks`, `updateTask`) are for a model's turn; `reportProgress` is a worker's own turn only (offered only on a turn working a task, takes no `id`); `retryTask` exists only as an action (a person's or an app's move; a model files a follow-up instead). `tt:2201-2203`, `tt:724`, `tt:2210-2246`.
- 13.1.2 `taskToolActions(...)` offers `createTask`, `getTask`, `listTasks`, `updateTask` and `retryTask` as flow actions (`reportProgress` is a worker-turn tool with no action), and throws, given a board, unless the board is resource-backed (the `taskToolActions(collectionId, resolve, roster?, options?)` form takes a caller's resolver, has no such check, and throws only when `resolve` is missing), named `<tool>_<suffix>`, where the suffix is the collection id with every character outside `[a-zA-Z0-9_-]` turned into `_`. `tt:2461`, `O`skills/task-tool-suffix.ts:18.
- 13.1.3 `listTasks` input: `status`, `assignee`, `filedByTask` (all optional, AND). Rows carry `id`, `goal`, `title?`, `status`, `assignee?`, `attempts`, `statusNote?`, `filedByTask?`, `run?`, `waitedOn?`, hold fields and `current?` (the latest completed follow-up's id) and never the output. The board's own read (an action or a view) also carries `spend`, `updatedAt`, `createdAt`, `startedAt?`, `completedAt?`, `leaseUntil?`, `error?`, `deps?`, `attachments?`; a model's tool does not. `tt:1039-1100`, `tl:20-100`.
- 13.1.4 `getTask({ id })` answers `{ ok: true, task, cancelled? }`: `id`, `goal`, `title?`, `status`, `assignee?`, `context?`, `deps?`, `priority?`, `labels?`, `metadata?`, `attempts`, `maxAttempts?`, `session?`, `resultTo?`, `target?`, `input?`, `output?`, `checkpoint?`, `statusNote?`, `error?`, the wait fields (`holds`, `keptOpenBy`), `followUpOf?`, `filedByTask?`, `run?`, `completedAt?`, `steers?`, `current?`. `input`, `metadata`, `output` longer than 20,000 characters as JSON come back cut, flagged `inputCut`, `metadataCut`, `outputCut`. `cancelled` lists the tasks it filed that this ending cancelled, when the read is how it hears of the ending. An unknown id: `{ ok: false, error: "task_not_found", taskId }`. `tt:248-300`, `tt:143-152`, `tt:2004-2200`.
- 13.1.5 `getTask({ id, wait: true, deadline? })` (offered only where a board wakes a waiting turn): default 5 minutes, one wait per step. Refusals (`wait_*`) live in the board's page; not part of this one.

### 13.2 `createTask`

Fields (16): `goal` (required), `title`, `context`, `assignee`, `deps`, `priority`, `input` (a JSON object), `labels`, `metadata`, `followUpOf`, `held`, `questions` (strings, or `{ kind: "question" | "confirm", prompt, onNo? }`), `session`, `resultTo`, `target`, `maxAttempts`. `tt:1175-1250`.

Result: `{ ok: true, taskId, status?: "held" }` or `{ ok: false, error }`. `tt:1470-1480`.

| `error` starts with | When | Source |
|---------------------|------|--------|
| `no_delegation_board` | the resolver finds no board for this caller | `tt:143` |
| `unknown_assignee` | a roster does not name the assignee; lists who is available | `tt:361-366` |
| `assignee_required` | the roster names several workers, no default worker claims unassigned tasks, and the task is not held | `tt:385-402` |
| `already_open` | the same goal for the same assignee and target while a task for it is still open | `tt:1305` |
| `create_task_does_not_wait` | `wait`, `deadline` or `timeoutMs` passed | `tt:1257`, `tt:1480-1490` |
| `enqueued_task_cap_exceeded`, `total_task_cap_exceeded` | a creation cap (5.5) | `tt:1442-1462` |
| `task_files_not_kept` | the turn's files could not be kept with the task | `tt:1546-1552` |
| a `TaskFilingRule` code (4.2.4) | the filing breaks a board rule | `tt:1453-1462` |
| (follow-up with an assignee) | refused at input | `tt:1488-1492` |

Default assignee on a model's filing with none named: no roster, or a board whose default worker claims unassigned tasks: filed unassigned; a roster of one worker: filed for that worker; held: unassigned; otherwise `assignee_required`. `tt:371-402`.

### 13.3 `updateTask`

Flat fields beside `id`; `labels`, `deps`, `input` replace the whole value, `metadata` merges. The per-field rule is 2.4. Refusals are results, not throws, naming the field, the state and the next move; nothing is written. `tt:1647-1750`.

| Code | When | Source |
|------|------|--------|
| `field_locked_after_start` | an until-start field on a started task | `tt:1641` |
| `task_finished` | any write to a finished task | `tt:1632` |
| `cancel_takes_no_edits` | `status: "cancelled"` sent with another field | `tt:1717` |
| `message_takes_no_edits` | `message` sent with a field or status | `tt:1729` |
| `nothing_to_update` | no field and no status beside `id` | `tt:1738` |
| `filing_setting_fixed` | `session`, `resultTo` or `target` sent | `tt:1698` |
| `unknown_assignee` | the roster does not name it | `tt:361` |
| `steer_limit` | a message to a task that already holds 20 | `tt:1981` |
| `message_not_supported` | the board keeps no messages | `tt:1804` |
| `no_such_question` | an `answers` id that is not an open question or confirm | `tt:1894,1940` |
| `wait_is_not_a_question` | `answers` names an external wait | `tt:1898` |
| `question_answered` | other words for an answered question | `tt:1938,1968` |
| `question_is_the_users` | the filer's tool answering a question the user answers from their Inbox | `tt:1904` |
| `question_takes_message` | a question answered without `message`, or with `done` | `tt:1920` |
| `confirm_takes_done` | a confirm answered without `done` | `tt:1912` |
| `done_without_answers` | `done` without `answers` | `tt:1881` |
| `answer_takes_no_edits` | an answer sent with a field or status | `tt:1885` |
| `questions_not_supported` | the board keeps no questions | `tt:1924` |
| `task_not_found` | no such task, or one the caller cannot reach | `tt:144` |

The page's earlier ledger entry (a code `answers_not_question`) is not in the code; the two codes the old list lacks are `filing_setting_fixed` and `wait_is_not_a_question`.

### 13.4 `retryTask` (action only)

Input `{ id }`. Result `{ ok: true }` or `{ ok: false, taskId?, error }`; nothing written on refusal. Codes: `task_finished` (completed; file a follow-up), `not_finished` (still open), `dependency_ended`, `settling`, `retry_budget_spent`, `task_not_found`, `retry_not_supported` (the ref has no `retry`). `tt:2210-2275`.

### 13.5 `reportProgress`

`{ statusNote?, output? }`: a note and/or a checkpoint. Neither changes the status. Refused with `progress_takes_a_note_or_output` (neither sent), `not_a_task_turn` (the turn is not working a task), `task_finished`, `progress_not_supported` (the ref has no `reportProgress`) and `progress_declined` (the turn does not hold the task running). `tt:724-790`, `ty:838-862`.

### 13.6 `holdTaskForUser`

A model's way to ask midway: `holdTaskForUser({ question })`; code uses `askMidway(ctx, tasks, [{ prompt }])`, whose second argument is the `TaskCollectionRef` of the ledger the request resolves, not a `taskBoard()` handle. `tt:827`; the behaviour is `ask` (9.1.4).

### 13.7 Workforce's conversation ledger (reading across a user's sessions)

- 13.7.1 `CONVERSATION_LEDGER_ID` is `"tasks"`; the actions are named for it: `createTask_tasks`, `getTask_tasks`, `listTasks_tasks`, `updateTask_tasks`. The task list is also a session view `listTasks_tasks`, the same rows, watched with `useView`; it also lists the steps its worker filed for itself when planning is wired. `wf`conversation-board/ledger.ts:61, `wf`conversation-board/board.ts:2110-2118, `wf`conversation-board/session-board.ts:19-20,275-278.
- 13.7.2 A browser reads the ledger as the `tasks` collection through any of the user's sessions; the session must be on a flow that declares it (the built-in worker flow, the coordinator flow, or one built with `defineSessionBoard`), else the read fails with a 404 `Unknown resource "tasks"`. It covers the tasks of every session the user filed from and never returns another user's. `DW` "Showing a user's boards in your app", `wft`conversation-board-browser-read.test.ts:31-65.
- 13.7.3 A row's `topic` is the identifying part of its key after the pattern prefix: `<partition segment>/<task id>`. Its first segment, URI-decoded, goes to `sessionIdOfFiling` (exported from `@flow-state-dev/workforce/browser`) to give the session that filed the task: everything before the last `~`, or the whole value when there is none. `part:19-30`, `wf`conversation-board/filing-session.ts:95-112, `wf`browser.ts:66, `wft`conversation-board-browser-read.test.ts:43.
- 13.7.4 `clientData` fields (22): `id`, `title`, `goal`, `context`, `attachments`, `status`, `assignee`, `run`, `priority`, `attempts`, `maxAttempts`, `deps`, `labels`, `error`, `feedback`, `holds`, `steers`, `spend`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`. A task's input, output and metadata are never sent. `wf`conversation-board/ledger.ts:84-112, `wft`conversation-board-browser-read.test.ts:67-90.
- 13.7.5 The read answers in pages (50 by default, up to 200 with `limit`; `readEveryCollectionPage` follows `nextCursor`). `DW` same section; `client`resource-client/read-every-page.ts:70-95 (cursor loop). The 50 and 200 are the existing page's claim; not re-derived here.

## 14. `taskLedgers` (a task entry that takes tasks from ledgers it never built a board for)

- 14.1 `taskLedgers({ name, resolve, uses?, onError?, allowSessionState?, endRules? })` returns a `TaskBinding`; pass it as an entry's `from` (`task: { actions: { work: { block, from: taskLedgers({ name, resolve }) } } }`). `defineFlow` gates the entry with no board in the flow. `te:202-275`.
- 14.2 `name` names the assembled blocks and the binding, so a refusal says which entry it came from. `uses`: declarations the resolved ledgers need in scope. `onError`: `"skip"` (default) or `"fail"`, the worker-failure policy as on a board. `allowSessionState`: accept an entry whose blocks keep session state (refused by default). `endRules`: what else holds a task open at a request's end. `te:202-249`.
- 14.3 `resolve(ledgerId, ctx, partition, taskId) => Promise<TaskCollectionRef | undefined>`. `ledgerId` is the id the dispatch carries (`boardId` on the envelope) and is **untrusted**: resolve against `ctx`, never a process-wide map. `partition` is present when the sending board's ledger keeps one set of rows per partition: resolve the ledger at it; a ledger resolved at any other partition is refused before a row is read. `taskId` is the row the dispatch names; it is untrusted too, and the row it names is re-read and checked on the returned ledger. `te:211-241`.
- 14.4 When `resolve` returns `undefined`, the gate throws `UnknownTaskLedgerError { code: "unknown-task-ledger", entry, taskId, ledgerId }` before any row is read; nothing is written. `te:588-605`, `tlt:225-250,345-360`.
- 14.5 Every check a board's gate runs (row, attempt, identity, status, assignee, lease, run link) runs on the resolved ledger. A sender board over a shared ledger dispatches under the ledger's id, so a resolver keyed on ledger ids finds it. `te:251-262`.
- 14.6 `defineFlow` refuses an entry that declares `from` and is also dispatched to by a board in the same flow: "One entry runs behind one gate; drop `from`, or declare a second entry for the board." `core`flow/defineFlow.ts:1046-1056, `tlt:143-165`.
- 14.7 The `boardId` of a `taskLedgers` binding is `<name> (by ledger)`. `te:264`.

## 15. Rows moved here by other pages' depth passes (22)

Each row is a claim, checked against the code. `carried` = true as stated, carried to the page. `corrected` = carried with the fix named. `dropped` = not carried, with the reason.

| # | From | Row (short) | Verdict | Where / why |
|---|------|-------------|---------|-------------|
| 1 | `catalog/patterns/routed-specialists` | Records: one Task per iteration in a TaskCollection with id `collectionId` (default `name`); query after the run with `collection.list({ status: "completed" })`; workspace via `createWorkspace(schema)` | **corrected** | One task per iteration, id default `name`: true (`P`routedSpecialists/index.ts:171-174,356). Fields: `goal` = reasoning or `iteration N`, `assignee` = specialist, `metadata.iteration`, `metadata.reasoning`, `output` = specialist's return value (`index.ts:421-428,538-541`). The workspace is a separate session-scoped writable resource (`schemas.ts:25-33`). **Dropped:** "query it after the run". The collection lives on the sequencer's own state (`state: ctx.sequencer`, `index.ts:300-312`), per invocation; the pattern reads its completed tasks inside its final map into the output's `history` (`index.ts:625-650`); a caller outside the run has no reach to it. Say "returned as `history`". Sections 10.1.4, 12. |
| 2 | `catalog/patterns/event-actors` | Actor run's task: `assignee` is the actor name, `metadata.depth`, `metadata.type`, `metadata.topic` | **carried** | Also `goal` = `<actor> on <type>:<topic>` and `input` = the entry. Collection id `eventActors:<name>`, request-backed, caps resolved with the retry budget opted out. `P`eventActors/index.ts:242-297,442-456. Sections 10.1.4, 12. |
| 3 | `catalog/patterns/supervisor` | Unmet deps wait; an errored task cancels its transitive dependents with `skipped`; a plan with an unknown or cyclic dep is refused whole and the run fails | **carried, qualified** | Unmet deps wait (8.1); cascade (8.3); unknown/cyclic refused whole by `TaskFilingRefusedError`, a throw from `createTask(s)` (8.2, `fst:182-254`). Qualification: in a **replan** a task whose dependency already ended is filed skipped, not refused; unknown and loop still fail the run (`ar:225-262`, `PT`plan-and-execute.test.ts:361-390). The `deps` plan example and first sentences staying on the catalog page is a layout note, not a fact. |
| 4 | `catalog/patterns/plan-and-execute` | The board selects the last eight tool observations (`recentTrajectory`) onto `priorWork`; the adapter passes no `priorWork`; evaluator and replanner do not read it; one sentence only if scoped to `context` and `dependencyResults` | **carried** | 10.1.5, 10.2.4. Verified: `recentTrajectory({ n: 8 })` pin `P`plan-and-execute/index.ts:732`; the adapter forwards `taskId→stepId`, `goal`, `context`, `deps→dependencyResults` only (`index.ts:430-460`); `priorWork` appears nowhere under `P`. |
| 5 | `catalog/workforce/delegating-work` | Reading tasks: `listTasks_tasks` and `getTask_tasks` scope, the tasks collection read across a user's sessions, the topic's first segment, `sessionIdOfFiling` | **carried** | 13.7.1-13.7.3, and 12. `getTask_tasks` is one of the four `<tool>_tasks` actions (`wf`conversation-board/board.ts:2110). The "scoped to one session" statement is the board's own reach (`readResolver`, `board.ts:1863`): the code builds the view from the session's own board; no test pins "never another conversation's" beyond the browser-read test (`wft`:51). |
| 6 | `catalog/workforce/delegating-work` | The task record's `clientData` fields, and `listTasks_tasks` as a session view | **corrected** | `DW` lists 16 fields; the ledger exposes 22 (13.7.4). The view: 13.7.1. |
| 7 | `catalog/tools/index` | What a task records of earlier work, whether or not a tool is cacheable (one line, a link) | **carried** | 10.2.1, 10.3.3: the ledger writes every tool call a worker's tool executor runs, cache hit or not. `core`blocks/internal/tool-executor.ts:196-220,338-345. |
| 8 | `reference/glossary` | Task record fields and the six statuses with what moves a task between them | **carried** | 2, 3. |
| 9 | `reference/glossary` | Task collection operations: add, claim, complete, fail, park; state or resource-collection backing | **corrected** | There is no `add` or `park` method. Filing is `createTask` / `createTasks` (4.1); the verbs are `claim`, `complete`, `fail`, `cancel`, `hold`, `release`, `reclaim`, `retry`, `steer`, `ask`, `answer`. "Park" is a request waiting (the `wait` slot, `getTask`'s `wait`), not a collection verb. Backing: `state` or `resource` (5.1, 5.3). **Dropped:** `add` and `park` as operation names. |
| 10 | `reference/glossary` | Flow policy: what a newly started task sees of earlier tasks | **carried** | 10.2. |
| 11 | `reference/task-board` | Claim rules a user can observe: one holder, not exactly-once, 2-minute lease, lapsed lease taken back, 3-abandonment allowance separate from `maxAttempts` | **carried** | 6.2, 6.3, 6.4. |
| 12 | `reference/task-board` | `task-board-recorder-failure` item and the `TaskCollectionRef` contract (`TaskTransitionOptions`, verdict `committed`/`undetermined`, late results dropped) | **carried** | 7.3, 7.5, 6.5.5. |
| 13 | `reference/task-board` | `defineTaskCollection` options | **carried** | 5.2. |
| 14 | `reference/task-board` | Task holds: shape (id, ask kinds, `openedAt`, `due`, `actor`, `source.kind`), how holds differ from the `held` status, claim skips open holds | **corrected** | Ask kinds are six, not two (0.9). 9.1. |
| 15 | `reference/task-board` | Task tools: `createTask`, `getTask`, `listTasks`, `updateTask`, `reportProgress`, `retryTask` action: fields, results, refusal codes | **corrected** | 13. Code fixes: the wait fields `createTask` refuses are `wait`, `deadline`, `timeoutMs` (0.11); `answers_not_question` does not exist, `filing_setting_fixed` and `wait_is_not_a_question` do (13.3). The `getTask` wait refusals (`wait_*`) are left to the board's page. |
| 16 | `reference/patterns` | What a newly started task knows: `TaskWorkerInput` fields (`deps`, `feedback`, `steers`, `followUpOf`, `sealed`, `priorWork`) and which pattern fills each | **carried, scoped** | 10.1, 10.1.4. "Which pattern fills each" is only partly pattern-specific: `deps`, `feedback`, `steers`, `attempts`, `priorWork` come from the board, not a pattern; `followUpOf` and `sealed` are set by whoever files. |
| 17 | `reference/patterns` | Audit-task record by `routedSpecialists`, `roundRobin`, `debate`, `eventActors` (assignee, goal, metadata, input/output) | **carried** | `roundRobin`: `goal` `<agent> (round N)`, `assignee` agent name, `metadata: { round }`, output `{ text }`; `debate`: the same with `metadata: { round, stance }`; both create, claim and complete in one block on the sequencer's state, collection id default `name`. `P`round-robin/blocks/record-contribution.ts:52-62, `P`debate/blocks/record-argument.ts:45-60, `P`round-robin/index.ts:210, `P`debate/index.ts:276. 10.1.4, 12. |
| 18 | `reference/patterns` | Where data lives, task-collection fields: Iteration tasks, Actor tasks, Audit tasks (roundRobin, debate), Board tasks, with owner, client visibility, count | **carried** | 12. Each pattern's tasks sit on request (`eventActors`, board default) or sequencer state; client sees only `task-change` items (default `{ client: true, history: false }`). |
| 19 | `reference/background-work` | `taskLedgers` options, `resolve` signature, `UnknownTaskLedgerError` fields, `defineFlow` refusal of same-flow `from`, `onError` default `skip` | **carried** | 14. |
| 20 | `build/research-team` | What a newly started task sees: `goal`, `deps` keyed by task id; a block's return is recorded as the task's output | **carried** | 10.1 (`deps` is `Record<depId, output>`; present only for deps whose `output` is not `undefined`). "A block's return is the task's output": `complete(id, output)` with the worker's return, unless a checkpoint was reported (3.5, 10.1.2). |
| 21 | `build/research-team` | `createTasks`: all-or-nothing batch, deps may point inside the batch, the drain sees tasks filed earlier in the request | **carried, qualified** | Refusals are all-or-nothing on both backings (4.2.1); on the state backing the insert is atomic too, on the resource backing a store failure mid-batch leaves earlier rows (4.2.2). Ids inside the batch count as on the board (4.2.1). A drain sees tasks filed earlier in the request when both name the same `collectionId` on a request-backed board (5.1.4). |
| 22 | `build/write-a-pattern` | `getOrCreateTaskCollection` options: how `backing` maps to the board's `collection.backing` (board `request` = collection `state` with no `state`), plus `createTask` fields and `list({ status })` | **carried** | 5.1, 5.1.1, 2.1, 2.3. |

## 16. Left out, for lack of an observable surface or because it is not Reference

- Recovery arithmetic in seconds (about 125 s by default, 40 s between renewals): derived from `DEFAULT_LEASE_DURATION_MS`, `RENEWAL_DIVISOR` and the idle timeout, not pinned by a test as a total. State the three numbers, not the sum, or leave it.
- The wake and notice writes in 4.1 (`markWait`, `lapseWait`, `releaseWait`, `takeNotice`, `dropNoticeReadByWait`, `clearResumeOwed`, `markCancelOwed`) and the `wait` slot's lapse rules: a board's wait/notice machinery; the board's page owns it.
- The `getTask` `wait` refusals and `MAX_WAIT_DEPTH`: the board's page.
- `taskBoard` options themselves (`claimOrder`, `concurrency`, `onIdle`, `onError`, `idlePollMs`): R-23.
- `immutableAssignee`'s over-reach and under-reach across flows (5.2.2): behaviour a user can hit, but it is a limit of how one declaration is reused; mention in one sentence or leave.
- `TASK_FIELD_RULES` is exported from `./tasks`, but `lockedFields` is the helper a user is more likely to need; the table in 2.4 is enough.
- The test file in `T`collection/ is named for each topic; the page may link tests only through the repo, not from published prose.

## 17. Doubts for pass 5

- D1. **Whether the observation ledger sees tool calls inside a task dispatched into its own session** (10.2.9): no test, no exported doc says. Left out.
- D2. **`SUB`'s "Recovery takes about one lease plus one idle-wake period, roughly 125 seconds"**: true by arithmetic (`120 s` lease + `idlePollMs 50 × 100 = 5 s`), but the idle timeout is a board option; keep it on R-23 or give the three numbers.
- D3. **The two-process filesystem-store limit (6.3.4)** has no test in the collection suite; kept as the existing page's claim. A reviewer may want it checked against the store adapters.
- D4. **`getTask`'s result nests the row under `task`** (`{ ok: true, task }`); `SUB` describes it as "the task whole". The page should say the shape.
- D5. **Observation `workerId`** is in the `Observation` type but the board's writer never sets it (`fpw:285-300` appends no `workerId`). Do not list it as populated.
- D6. **"22 fields" for `clientData`** counts `CONVERSATION_BOARD_CLIENT_FIELDS`. If a later change adds one, the page and the code drift; the page could say "the board's fields" and link the list.
- D7. **`TaskCollectionRef` doc comment on `ClaimOrder`** (0.4) contradicts the code. The page follows the code; a stale comment exists.

## 18. Pass 3: what the draft leaves out of the sheet

The draft carries all 22 rows of section 15 except the two parts dropped there (the `add` and `park` operation names, row 9; "query it after the run", row 1). The page words them as `createTask` / `createTasks` and "returned as `history`". Rows 2 to 8 and 10 to 22 are carried as the ledger says. Also not on the page, and why:

- Section 16's list (recovery total in seconds, the wait and notice writes beyond one sentence, `getTask`'s `wait` refusals, `taskBoard` options, `lockedFields`, test-file pointers): another page's, or not Reference.
- Section 0.15 (`reclaim` and the claim path judge a lapse one millisecond apart): the page states neither as the rule.
- `MAX_STEERS`, `MAX_QUESTION_PROMPT`, `DEFAULT_LEASE_DURATION_MS` and the other unexported constants appear as values only, never as imports (1.2).
- Observation `workerId` (D5) and whether a dispatched task's tool calls reach the ledger (10.2.9, D1) are not stated.
- The `claimOrder` sentence about `eligibility` follows the code (0.4), not the stale comment on `ClaimOrder`.
