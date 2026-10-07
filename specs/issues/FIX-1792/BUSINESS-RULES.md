# FIX-1792 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. A *tree* is a workforce folder an app loads; a *coordinator* is a
worker on FIX-1791's coordinator flow; its *conversation's board* is FIX-1794's, kept in the
partition only that conversation reaches (epic [D6](../../epics/FIX-1786/DECISIONS.md#d6)). The
*proved by* column is the check the plan runs.

## Loading a tree

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A tree is loaded | Coordinators are read from `WORKER.md` files only. Nothing reads a `mailboxes/` folder, a `MAILBOX.md` or a `flows/mailboxes/` folder, and no rule names them: the conversion deleted every one in the repo ([D2](DECISIONS.md#d2)) | CI · `check.mjs --after` · VG leg b |
| BR-4 | `fsdev gen` runs | Codegen has no `flows/mailboxes` slot, and the generated module has no `mailboxKinds` | CI · V2 |
| BR-5a | Discovery lists its domains | `mailboxes` isn't one. Who a coordinator hands work to is its delegate read | CI · `check.mjs --after` |

BR-2, BR-3, BR-4a, BR-5 and BR-6 are retired: they refused an old `MAILBOX.md`, a
`flows/mailboxes/` folder, an old key on a `WORKER.md` or a pre-rename `CHANNEL.md` by name, and
D2's answer drops every such refusal. Their numbers stay unused so citations hold.

## Converting a file

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A file is converted | Same id (`<team>.<name>`), same `description:` and body; `flow: coordinator`; `members:` becomes `delegates:` in the same order; `boards:` and `boardActions:` go. The DevTeam's `feature` and `release` files become workstreams instead (BR-15) | Each converted goal's re-run |
| BR-7a | An app, panel or goal reaches a converted coordinator by the mailbox's id | The id is the worker's. It finds the user's conversation with `findWorkerSession({ worker })`, which matches on the key set (FIX-1788 S5a), so it returns the conversation and never a delegate's or a task's session. No code addresses a session by the bare id | CI · VG leg a |
| BR-8 | Its mailbox declared `routing:` with a `fallback:` | `routing: best-fit` and that `fallback:`; one post gets one answer, from the delegate best fit picks | `a-routed-post-gets-one-answer` re-run |
| BR-9 | Its mailbox declared no `routing:` | `routing: everyone`; each delegate answers each post once, and no answer wakes anyone | `a-fresh-host-wakes-its-member-agents` re-run · VG leg a |
| BR-10 | A converted coordinator names a delegate that no file declares | Refused at load, naming it (FIX-1791 BR-11). The pentest scenario asserts the refusal, not the old skip | `a-post-reaches-both-declared-seats` re-run |
| BR-11 | A file declared `flow:` naming a kind of the tree's own | No conversion: both such files go with the goals they served ([DECISIONS](DECISIONS.md#decided-not-asked)) | The checker |
| BR-12 | A converted `WORKER.md` that isn't a coordinator is loaded | It keeps the flow it names; nothing moves onto `agent` | CI |

## Boards

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | Work used to go on a converted file's board | It goes on a session board at its user's scope, never an org row: the coordinator's conversation's, or, where a member filed, that worker's own ([the table](DECISIONS.md#the-table)). Whoever files there has orchestration's task tools, because at least one of its `delegates:` can take a task; no `WORKER.md` says `filing:`. A worker none of whose delegates takes a task has no task tools, and nothing files on its sessions | Each converted goal's re-run · V4 |
| BR-13a | A member filed on its mailbox's board when a post reached it (manager-queue-lab's manager, multi-seat-collab's planner, the row goal's filer, the DevTeam's EM) | It files itself: its `WORKER.md` lists who it files for in `delegates:`, and that list gives it the task tools. Its turn has the eight: `addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks`, from `createTaskToolsCapability(resolver, roster)` with its session's board as the resolver and its task-taking delegates as the roster. An app flow, such as the EM's `em`, composes the capability on its generator block and spreads `taskToolActions(<board id>, resolver, roster)` into its `actions`. No coordinator files for it | The converted goals' re-runs · V4 · V5 |
| BR-14 | Kitchen-sink's help desk is converted | Its `escalations` board goes with the escalation feature, which is removed and not replaced (product owner, 2026-10-06): the `escalate` tool, the board, its panel and the `no-filing` control go, and no instruction asks anyone to file a case. Specialists still answer. The help desk has the task tools, as any coordinator whose delegates take tasks (BR-13) | Kitchen-sink's suite · the rewritten talk goals |
| BR-15 | The DevTeam lab starts | The storefront project's two workstreams, `feature` and `release`, are opened by the lab's member through the project's own action, not written as rows. The EM leads both: an ordinary worker that takes the project coordinator's delegated post (FIX-1791 S9). `triage` and `oncall` are coordinators | CI |
| BR-16 | A coding run works for the feature workstream | It finds the project through the workstream; no claim is read or written | `it-codes-in-the-projects-repository` re-run |
| BR-17 | Another member of the DevTeam org reads the feature workstream | Sees its entry, not its tasks | `it-keeps-its-rows-on-the-mailboxes-board`, rewritten |

## Old data

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A store holds mailbox sessions, mailbox board rows, claim rows, a project's list of mailboxes, or the inventory's mailbox and membership rows | Dropped. No code reads, moves, migrates or refuses them, and no view lists them. There are no consumers yet ([D2](DECISIONS.md#d2)) | `check.mjs --after`: nothing names the removed surface |

BR-19 to BR-22 are retired into BR-18: they kept old data unread, or refused a `workstreams` write
by name, and D2's answer drops both. The project's `workstreams` field is simply gone (S10).

## The repository

| # | When | Then | Proved by |
|---|---|---|---|
| BR-23 | The last PR lands | No `MAILBOX.md` is left in the repo. No file names any export on the removal inventory, and discovery's pinned domains don't list `mailboxes` | `check.mjs --after` · VG leg b |
| BR-24 | A goal ran on a mailbox | It runs on the converted files and passes, or it retires here with its reason and the goal leg that proves its outcome, which has passed on `main`. No converted step waits on another issue. Retired: `a-mailbox-holds-the-work-a-seat-drains` (its subjects are gone; on [PLAN's condition](PLAN.md#at-implement-time)), `lists-a-filed-case-without-a-reload` (the escalation feature is removed; nothing files a case) and `a-pre-rename-lab-is-refused-by-name` (the pre-rename refusal is removed, D2) | VG leg b |
| BR-25 | A converted host, fixture or test creates a session or a row | It carries an org; nothing gains a default org (FIX-1442) | CI · kitchen-sink's named-org test |

## Failure taxonomy

This issue adds no refusal. The load-time refusal its converted files meet is FIX-1791's, an
undeclared delegate (BR-10), which collects every problem and registers nothing. Old data is
dropped: nothing reads, moves or refuses it. Nothing retries.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): its goal check passes on one commit after
failing under `GOAL_CONTROL=mailbox-left` and on today's `main`, and every goal the plan marks
convert or rewrite passes on that commit, the last PR's. ER-6's first two clauses are BR-1, BR-7
and BR-10. Its third, an old `MAILBOX.md` refused by name, is cut by D2's answer (product owner,
2026-10-07); the epic's rule needs the same amendment.
