# FIX-1792 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. A *tree* is a workforce folder an app loads; a *coordinator* is a
worker on FIX-1791's coordinator flow; its *conversation's board* is FIX-1794's, kept in the
partition only that conversation reaches (epic [D6](../../epics/FIX-1786/DECISIONS.md#d6)). The
*proved by* column is the check the plan runs.

## Loading a tree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A team's `mailboxes/<name>/` folder holds a `MAILBOX.md` | The load stops and registers nothing. The message names the file, the `teams/<team>/workers/<name>/WORKER.md` it belongs at, each of its lines' conversion, and the upgrade page | CI · VG leg a |
| BR-2 | A tree holds several, in several teams | Every one is named in the same stop, not the first only | CI |
| BR-3 | A `mailboxes/` folder holds no `MAILBOX.md` | Passed over, like any folder that isn't a slot. It declares nothing: a team folder declares through the file in it | CI |
| BR-4 | `fsdev gen` runs on a workforce root that holds `flows/mailboxes/` | Refused by name, whatever the folder holds, saying a flow that runs workers belongs in `flows/workers/` on the worker-flow list. The generated module has no `mailboxKinds`. Unlike BR-3, the folder is a code slot: every file in it was a kind codegen registered, so the folder itself is the declaration | CI · V2 |
| BR-4a | An app loads a workforce root that holds `flows/mailboxes/`, with or without a fresh generated module | The load stops and registers nothing, naming the folder and where its flows go, as BR-4. An upgraded app that never re-runs `fsdev gen`, or wires flows by hand, is still refused | CI · VG leg a |
| BR-5 | A `WORKER.md` declares `members:`, `boards:`, `boardActions:` or `mintFor:` | Refused, naming each key and what replaced it: `delegates:`, the conversation's board, nothing (rooms are gone) | CI · VG leg b |
| BR-5a | A `WORKER.md`'s `discover:`, or a `discover` call, names the `mailboxes` domain | Refused as a domain that isn't one, as any unknown domain is today. Discovery's domains no longer include `mailboxes`; who a coordinator hands work to is its delegate read | CI |
| BR-6 | A team still holds a `channels/` folder or a `CHANNEL.md` | Refused by name as today; the message names the `WORKER.md` conversion, never `MAILBOX.md` | CI · VG leg a |

## Converting a file

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A file is converted | Same id (`<team>.<name>`), same `description:` and body; `flow: coordinator`; `members:` becomes `delegates:` in the same order; `boards:` and `boardActions:` go. The DevTeam's `feature` and `release` files become workstreams instead (BR-15) | Each converted goal's re-run |
| BR-7a | An app, panel or goal reaches a converted coordinator by the mailbox's id | The id is the worker's. It finds the user's conversation with `findWorkerSession({ worker })`, which matches on the key set (FIX-1788 S5a), so it returns the conversation and never a delegate's or a task's session. No code addresses a session by the bare id | CI · VG leg c |
| BR-8 | Its mailbox declared `routing:` with a `fallback:` | `routing: best-fit` and that `fallback:`; one post gets one answer, from the delegate best fit picks | `a-routed-post-gets-one-answer` re-run |
| BR-9 | Its mailbox declared no `routing:` | `routing: everyone`; each delegate answers each post once, and no answer wakes anyone | `a-fresh-host-wakes-its-member-agents` re-run · VG leg c |
| BR-10 | A converted coordinator names a delegate that no file declares | Refused at load, naming it (FIX-1791 BR-11). The pentest scenario asserts the refusal, not the old skip | `a-post-reaches-both-declared-seats` re-run |
| BR-11 | A file declared `flow:` naming a kind of the tree's own | No conversion; [DECISIONS](DECISIONS.md#decided-not-asked) says where each such file goes | The checker |
| BR-12 | A converted `WORKER.md` that isn't a coordinator is loaded | It keeps the flow it names; nothing moves onto `agent` | CI |

## Boards

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | Work used to go on a converted file's board | It goes on a session board at its user's scope, never an org row: the coordinator's conversation's, or, where a member filed, that worker's own ([the table](DECISIONS.md#the-table)). Whoever files there is granted: its `WORKER.md` says `filing: true`, and it files through `createTaskFilingCapability()` (FIX-1802 BR-1, BR-11), coordinators included. A coordinator converted with no board has no grant, and the app's `fileTask` on its conversation is refused (FIX-1802 BR-2) | Each converted goal's re-run · V5 |
| BR-13a | A member filed on its mailbox's board when a post reached it (manager-queue-lab's manager, multi-seat-collab's planner, the row goal's filer, the DevTeam's EM) | It files itself: its `WORKER.md` gains `filing: true` and lists who it files for in `delegates:`, and its flow carries `createTaskFilingCapability()` (an app flow, such as the EM's `em`, puts the capability on its generator block's `uses` and spreads the entries into its own `internal` and `task` maps). Its turn has `fileTask`, `listTasks`, `reassignTask` and `cancelTask` (FIX-1802 BR-1 to BR-4). A worker without the grant files nothing, and no coordinator files for it | The converted goals' re-runs · V5 · V6 |
| BR-14 | Kitchen-sink's help desk is converted | Its `escalations` board goes with the escalation feature, which is removed and not replaced (product owner, 2026-10-06). No tool, board, panel or goal control files or lists a case. Specialists still answer | Kitchen-sink's suite · the rewritten talk goals |
| BR-15 | The DevTeam lab starts | The storefront project's two workstreams, `feature` and `release`, are opened by the lab's member through the project's own action, not written as rows. The EM leads both: an ordinary worker that takes the project coordinator's delegated post (FIX-1791 S9). `triage` and `oncall` are coordinators | CI |
| BR-16 | A coding run works for the feature workstream | It finds the project through the workstream; no claim is read or written | `it-codes-in-the-projects-repository` re-run |
| BR-17 | Another member of the DevTeam org reads the feature workstream | Sees its entry, not its tasks | `it-keeps-its-rows-on-the-mailboxes-board`, rewritten |

## Old data

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A store holds sessions on the `mailbox` flow | Left as they are. A request to one gets `Unknown flow "mailbox"`. No view lists them | CI · VG leg d |
| BR-19 | A store holds org-scoped mailbox board rows, some pending | Left as they are, byte for byte. No run claims them and no conversation's board lists them ([D2](DECISIONS.md#d2)) | CI · VG leg d |
| BR-20 | A store holds claim rows, or project rows that list mailboxes | Left as they are; nothing reads the list or the claims | CI |
| BR-21 | A create or update of a project carries `workstreams` | Refused, naming the key and the workstream action that replaced it | CI |
| BR-22 | A store holds the inventory's mailbox and membership rows | Left as they are; the inventory read lists none, and discovery has no `mailboxes` domain to list them under | CI · `check.mjs --after` |

## The repository

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | The last PR lands | The only `MAILBOX.md` files are the refusal goal's two old files, at their pinned paths. Nothing outside the refusal's own files names any export on the removal inventory | `check.mjs --after` · VG leg e |
| BR-24 | A goal ran on a mailbox | It runs on the converted files and passes, or it retires here with its reason and the goal leg that proves its outcome, which has passed on `main`. No converted step waits on another issue. Retired: `a-mailbox-holds-the-work-a-seat-drains` (its subjects are gone; on [PLAN's condition](PLAN.md#at-implement-time)) and `lists-a-filed-case-without-a-reload` (the escalation feature is removed; nothing files a case) | VG leg e |
| BR-25 | A converted host, fixture or test creates a session or a row | It carries an org; nothing gains a default org (FIX-1442) | CI · kitchen-sink's named-org test |

## Failure taxonomy

Every refusal at load is fatal, collects every problem, and registers nothing: a half-loaded lab
is the quiet failure the refusal exists to prevent. Old data degrades: it stays in the store,
unread, and nothing deletes or rewrites it. Nothing retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): its goal check passes on one commit after
failing under `GOAL_CONTROL=silent-skip` and on today's `main`, and every goal the plan marks
convert or rewrite passes on that commit, the last PR's. ER-6's three clauses are BR-1, BR-7 and BR-10.
