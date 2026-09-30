# FIX-1664 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. The epic's rules (ER-n, [FIX-1649](../../epics/FIX-1649/BUSINESS-RULES.md))
and FIX-1662's frame rules apply as written; these are the ones the task level adds. *Proved by*
names the kind of check the plan runs.

## Opening a task

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A task is opened from Tasks, a board card, or a workstream's task list | FIX-1662's task route shows this issue's header, the four tabs and the inspector in the right panel's slot; the tab is in the URL | Goal check |
| BR-2 | The route names a board or task the Lab doesn't hold | A named state saying no such task on that board; no other read is made | CI |
| BR-3 | The task has never been claimed | Session says the task hasn't started; Interrupt is disabled with *nothing is running*; the inspector shows the row's fields and dashes | CI |
| BR-4 | The header renders | Title (or goal), the row's status word, elapsed time from the row's start while it runs, the worker, and the harness per BR-18. No branch | Goal check |

## The Session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | The task has a run | The Session is the items of the child session keyed on this board and this task, in stored order, drawn by the registry components; one live stream for it while the tab is open | Goal check under `worker-session` |
| BR-6 | The run stores a new item | It appears with no reload | Goal check |
| BR-7 | The task ran more than once | Every attempt's items, in order, in the one session | CI |
| BR-8 | The board's seat keys sessions per worker or by a custom key | The Session shows that shared session whole, with a line saying it holds other tasks' work too; it never filters by guess | CI |
| BR-9 | The run's session exists but the caller's principal can't reach it | A named state saying the run isn't visible to this user; no fallback to another session | CI |
| BR-10 | The row is parked | The Session shows the log and the row's reason; the ask is answered from Inbox (FIX-1662), and the task screen links there | CI |

## Controls

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Interrupt is pressed, or Esc with the Session focused | The run's in-progress request gets the shipped abort. The view shows *interrupted* only after that request reads `aborted` | Goal check under `optimistic-interrupt` |
| BR-12 | The abort answers that the request already finished | The view refreshes to what the request and row say; nothing is drawn as interrupted | CI |
| BR-13 | The abort is refused or fails | The error shows by the button; the run is drawn as still running | CI |
| BR-14 | The run was interrupted | App Lab writes nothing to the row; its next status is whatever the board records | CI |
| BR-15 | Hand off, reassign or Open PR is shown | Disabled, with a line naming FIX-1651 and what arrives | CI |
| BR-16 | The composer is shown | Disabled, with a line naming the operation from [the open fork](DECISIONS.md#open), or FIX-1652 if the fork goes the other way. *Also post to the workstream* is disabled with it | CI |

## Tabs and the inspector

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | Diff or Checks opens | A named empty state naming FIX-1651; the tab label carries no count | CI |
| BR-18 | The inspector renders | Worker and team from the inventory; harness from the run's reported handle, else a dash naming FIX-1652; started from the row; tokens and cost from the reported handle, else a dash, with *estimated* when the harness estimated | Goal check |
| BR-19 | The run recorded a plan or file operations | The plan lists its steps with their status; files list path and created or edited | CI, against a seeded record |
| BR-20 | The run recorded neither | Each section says this harness records none | Goal check (the stub records none) |
| BR-21 | Acceptance criteria and *review by* render | Named gaps naming FIX-1651 | CI |
| BR-22 | Linked renders | *After*: the row's dependencies. *Blocks*: rows on the same board that depend on it. Each opens its task | CI |
| BR-23 | The trace link is shown | It opens the devtool App Lab was started with, with the run's session id beside it; with no devtool given, it is disabled and says how to start one | CI |
| BR-24 | Brief opens | The row's title, goal, context and input, as stored; acceptance criteria per BR-21 | CI |

## Failure taxonomy

Nothing on the task screen is fatal. The row read failing shows the route's Retry; the run
lookup, the stream and each recorded collection failing degrade only their own tab or section
to Retry. Nothing retries on its own, and nothing is drawn from a guess or from App Lab's hope:
a state changes on screen when the store says it changed.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), with both controls failing where
named. ER-1 for the task level's tabs and panel. ER-5 for every gap here. ER-15 as its owner:
the only write this screen makes is the shipped abort, and it names the turn operation's state
for FIX-1662's composers.
