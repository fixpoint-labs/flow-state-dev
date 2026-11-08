# FIX-2479 · Every app-visible text that says *row*

[Spec](SPEC.md) · [Decisions](DECISIONS.md#d3) · **App-visible text**

The complete list D3 renames, measured on `main` (2026-11-07). An app sees each one: a thrown
error, a returned refusal or detail, or a tool description a model reads. Two wire values and 81
message sites.

**The rule for the new wording.** Where *row* is a task (the task board, dispatch, the harness
manager, the ledger), it says *task*. Elsewhere it says *resource*. *Collection items* says
*collection resources*. Only the noun changes; the sentence keeps saying the same thing.

## Wire values (2)

| Value | Today | After |
|---|---|---|
| A task's own hold | `source.kind: "row"` | `"task"`; `"row"` still reads ([D1](DECISIONS.md#d1)) |
| The dispatch refusal | `"external-dispatcher"` | `"external-flow-runner"` |

Two internal values follow the hold marker and aren't on this list: the `@internal`
`refuseWithOpenHold: "row"` option, and `OwnerRunRefusal`'s `"no_row"`, which no other module
imports.

## Messages (81)

How they were found: every string literal in `packages/*/src` that says *row*, *rows* or
*collection item(s)* in its text, not inside an interpolation, and not in a comment or a test.
Parts of one message within four lines of each other count as one site. Three of them are
quoted in published pages ([D4](DECISIONS.md#d4)): #15, #16 and #17. #18 is the fifth found in
review (Gitar).

**Left out, and why:** store adapters, and `scheduled`'s store conformance tests (a store's
word); `contracts`' `ResourceStateStore.delete` message (the store contract); the schedule index
(a store table); child-session records in `client` and `engine`'s runtime config (sessions, not
resources); UI info-card rows (rendered rows); a bare variable in `workforce`'s conversation
board.

### `core`

| # | Where | Says today |
|---|---|---|
| 1 | `core/src/blocks/dispatcher.ts:334` | dispatcher chooses its entry per row. |
| 2 | `core/src/blocks/dispatcher.ts:341` | or "task" (a claim on a durable row, minted by the task board that holds the dispatcher). |
| 3 | `core/src/blocks/dispatcher.ts:545` | [dispatcher] "…" chooses its entry per row but declares … at least one entry, each named once, so every entry a row can land on is verified. |
| 4 | `core/src/flow/defineFlow.ts:928` | Flow "…" holds board "…", which hands rows out through |
| 5 | `core/src/flow/defineFlow.ts:964` | to the flow — the block that runs each row this dispatcher dispatches. |
| 6 | `core/src/flow/defineFlow.ts:972` | `workers`, which is the only place a claim on a durable row is minted. |
| 7 | `core/src/flow/defineFlow.ts:1210` | block knowing — a task board that dispatches would claim rows in one place while its |
| 8 | `core/src/types/faceted-collection.ts:269` | pattern "…" has parameters. A content change can't address a parameterized row by key; |
| 9 | `core/src/types/faceted-collection.ts:478` | the row "…" isn't this collection's row under "…". |
| 10 | `core/src/types/resource-collection.ts:400` | … must not evict: an eviction would delete another user's row. |

### `devtool`

| # | Where | Says today |
|---|---|---|
| 11 | `devtool/src/react/hooks/use-debug-collection-items.ts:78` | Failed to fetch collection items |

### `engine`

| # | Where | Says today |
|---|---|---|
| 12 | `engine/src/context/create-request-host.ts:765` | this request was not dispatched for a parent-board task, so there is no row to settle |
| 13 | `engine/src/durability/owner-runs.ts:114` | names no entry or row |
| 14 | `engine/src/execution/runAction.ts:356` | . One entry settles against one ledger; a row claimed on another board's ledger |
| 15 | `engine/src/resources/owner-private.ts:47` | A row of an owner-private collection is readable only by the user it belongs to. |
| 16 | `engine/src/resources/owner-private.ts:53` | A row of an owner-writes collection is written only by the user it belongs to. |
| 17 | `engine/src/resources/owner-private.ts:243` | Collection pattern "…" can reach the rows of owner-… collection "…". |
| 18 | `engine/src/resources/owner-private.ts:272` | That segment is reserved for the user an owner-private collection's row belongs to, |

### `harness-manager`

| # | Where | Says today |
|---|---|---|
| 19 | `harness-manager/src/guards.ts:216` | fail there and spend the row's whole retry budget on a name no retry can fix. |
| 20 | `harness-manager/src/manager.ts:1206` | continuing to work a row another attempt now holds. |
| 21 | `harness-manager/src/manager.ts:1313` | manager, or before the row was opened. |
| 22 | `harness-manager/src/manager.ts:2006` | worker, so its rows cannot be read or asked a question on. |
| 23 | `harness-manager/src/manager.ts:2392` | the run was opened (its claim names no live row of this attempt) |
| 24 | `harness-manager/src/manager.ts:2604` | the run row was opened |
| 25 | `harness-manager/src/manager.ts:2664` | The run's worktree row was not updated: … |
| 26 | `harness-manager/src/manager.ts:3525` | the row was completed |
| 27 | `harness-manager/src/manager.ts:3670` | the row was completed |
| 28 | `harness-manager/src/manager.ts:4337` | [harness-manager] task … is a "…" row on a manager |
| 29 | `harness-manager/src/manager.ts:4362` | that payload, so a second row under a different id would run the same work |
| 30 | `harness-manager/src/run-owner.ts:89` | continues it; this drain leaves the row as it is. |
| 31 | `harness-manager/src/scripted-harness.ts:26` | Row a row |
| 32 | `harness-manager/src/scripted-harness.ts:51` | scripted run: note the row |
| 33 | `harness-manager/src/scripted-harness.ts:65` | Planning the change for this row. Committing the work on the row's branch. |
| 34 | `harness-manager/src/session-flow.ts:905` | The worktree's row was not updated: … |

### `orchestration`

| # | Where | Says today |
|---|---|---|
| 35 | `orchestration/src/inbox/check.ts:153` | item … shows …, its row has … |
| 36 | `orchestration/src/skills/task-tools-capability.ts:1783` | whose request filed them (filedByTask). Rows carry each task's status note, never its output: |
| 37 | `orchestration/src/task-board/blocks/dispatch-row.ts:166` | assignee, and the fallback hands a row over by the name on it. |
| 38 | `orchestration/src/task-board/board-mode.ts:71` | `wait: false`: a plan board's drain waits on every row, the ones it hands to another hands rows off and waits on none. `wait: true`: a delegation b… |
| 39 | `orchestration/src/task-board/board-mode.ts:88` | a delegation board hands every row to another session and its drain waits on none, so |
| 40 | `orchestration/src/task-board/board-mode.ts:97` | for a plan board, whose drain runs and waits on its rows. |
| 41 | `orchestration/src/task-board/dispatch-assignee.ts:279` | but a uniform worker cannot dispatch — a dispatch is addressed by the row's assignee. `defaultWorker`, which hands each row over under the assignee… |
| 42 | `orchestration/src/task-board/dispatch-assignee.ts:323` | collection — a child session would resolve an empty ledger and never find the row lineage root and the child addresses the same rows the board clai… |
| 43 | `orchestration/src/task-board/dispatch-assignee.ts:364` | other rows, where two blocks choosing the same key with different shapes corrupt |
| 44 | `orchestration/src/task-board/goal-seek-loop.ts:346` | its drain returns while the rows it handed to other sessions still run, so the judge would rule on unfinished work. Loop over a plan board, whose d… |
| 45 | `orchestration/src/task-board/index.ts:1361` | `dispatcher({ action, session })` there, naming the task entry a row filed |
| 46 | `orchestration/src/task-board/index.ts:1368` | board hands every row to another session already. Drop newSession, or drop `mode` for a plan board, whose rows run inline unless filed `session: "n… |
| 47 | `orchestration/src/task-board/task-entry.ts:325` | board "…" keeps its rows per partition, and the dispatch names none |
| 48 | `orchestration/src/task-board/task-entry.ts:422` | no such row on board "…" — it was deleted, or this board resolved to a |
| 49 | `orchestration/src/task-board/task-entry.ts:443` | the row was deleted and recreated under the same id after this dispatch was addressed |
| 50 | `orchestration/src/task-board/task-entry.ts:453` | the row was deleted and recreated under the same id after this dispatch was |
| 51 | `orchestration/src/task-board/task-entry.ts:475` | the row is "…", so no claim is outstanding on it |
| 52 | `orchestration/src/task-board/task-entry.ts:491` | this dispatch was sent from assignee "…" but the row now routes to |
| 53 | `orchestration/src/task-board/task-entry.ts:670` | its lease ran out before this dispatch started, and the row carries no lease |
| 54 | `orchestration/src/task-board/task-entry.ts:693` | no verdict for the renewal, so nothing says the row is still this dispatch's to run |
| 55 | `orchestration/src/task-board/task-entry.ts:699` | its lease ran out before this dispatch started and the row was taken back |
| 56 | `orchestration/src/task-board/task-entry.ts:719` | "…" and then reported no such row. The claim cannot be re-minted from a row the collection denies holding. |
| 57 | `orchestration/src/task-board/task-entry.ts:762` | this board's collection reported no verdict for the run link, so nothing says the row |
| 58 | `orchestration/src/task-board/task-request.ts:904` | [task-board] task "…": its row couldn't be read to tell the filer its question; it stays in the Inbox: … |
| 59 | `orchestration/src/tasks/collection/define-task-collection.ts:211` | [tasks] defineTaskCollection "…": recordEnding must be a function of the row and its ending |
| 60 | `orchestration/src/tasks/collection/define-task-collection.ts:286` | …: partitionBy keeps one set of rows per partition at the owner's user scope, |
| 61 | `orchestration/src/tasks/collection/define-task-collection.ts:293` | partition's rows, so one partition's add would be refused or evict a row by another's. |
| 62 | `orchestration/src/tasks/collection/find-task-partitions.ts:48` | [tasks] findTaskPartitions: ledger "…" does not keep its rows per partition (partitionBy). |
| 63 | `orchestration/src/tasks/collection/get-or-create.ts:294` | …: this ledger keeps its rows per partition (partitionBy), so it is resolved |
| 64 | `orchestration/src/tasks/collection/partition.ts:91` | [tasks] ledger "…" keeps its rows per partition, and its partitionBy |
| 65 | `orchestration/src/tasks/collection/partition.ts:110` | [tasks] ledger "…" keeps its rows per partition, and this context has no |
| 66 | `orchestration/src/tasks/collection/partition.ts:131` | [tasks] ledger "…" keeps its rows per partition, so a task id must be |
| 67 | `orchestration/src/tasks/collection/partition.ts:172` | [tasks] ledger "…" addresses its rows by task id, not by pattern parameters |
| 68 | `orchestration/src/tasks/collection/read-committed.ts:26` | [tasks] board "…" can't read a row as stored (no getCommitted): a steer written by another |
| 69 | `orchestration/src/tasks/helpers/wait-on-task.ts:900` | [orchestration] wait "…": its cancel failed, and so did recording it as owed; the row stays open: |

### `scheduled`

| # | Where | Says today |
|---|---|---|
| 70 | `scheduled/src/defineScheduleCollection.ts:224` | the organization that created it; write the row from that organization, or attribute a pre-existing row with the upgrade recipe in the persistence… |

### `workforce`

| # | Where | Says today |
|---|---|---|
| 71 | `workforce/src/clear-shadowed-references.ts:165` | Cannot address this org's reference rows: … contains ":" or a reading the wrong cell and reporting nothing to clear. Clear these rows with the |
| 72 | `workforce/src/hire.ts:619` | reference is read from its file and sealed, a document seeds a row and then evolves — |
| 73 | `workforce/src/inventory/open-inventory.ts:245` | `workerWriter`. A worker has no session, so its row has to be written from inside some |
| 74 | `workforce/src/inventory/open-inventory.ts:292` | the worker rows could not be written — … |
| 75 | `workforce/src/inventory/worker-writer.ts:82` | the worker rows cannot be written: this request carries no organization, and the |
| 76 | `workforce/src/inventory/worker-writer.ts:107` | … of … worker rows could not be written:\n - |
| 77 | `workforce/src/inventory/worker-writer.ts:119` | Write the org's worker rows into the live inventory. Boot machinery, called once by |
| 78 | `workforce/src/loader/read-declared-roster.ts:221` | while a resource seeds a row that then becomes the source. Keep one. |
| 79 | `workforce/src/manifest.ts:748` | it seeds a row and can be written. |
| 80 | `workforce/src/projects/project-writes.ts:513` | Read a project by its address: its row, every workstream's entry, and its progress worked out from them. |
| 81 | `workforce/src/workers/installation.ts:739` | Flow "…" declares no project rows, so a session of it can't be linked to project "…". |
