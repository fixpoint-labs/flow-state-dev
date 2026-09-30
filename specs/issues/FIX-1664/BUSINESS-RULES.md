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
| BR-3 | The row names no run: never claimed, handed off but not yet started in its session, or stored before the [task-run link](PLAN.md#the-task-run-link) existed | Session says no run has started for this task; Interrupt is disabled with *nothing is running*; the inspector shows the row's fields. The screen updates when the row does; it never looks for a run any other way | CI |
| BR-4 | The header renders | Title (or goal), the row's status word, elapsed time from the row's start while it runs, and the worker. No harness (a gap, BR-18) and no branch | Goal check |

## The Session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | The row names a run | The Session is the items of the session the row's link names, in stored order, drawn by the registry components; one live stream for it, open only while the Session tab is | Goal check under `worker-session` |
| BR-6 | The run stores a new item | It appears with no reload | Goal check |
| BR-7 | The task ran more than once | Every attempt the named session holds, in order. An earlier attempt that ran in another session (a re-drain from another conversation, or a custom key) isn't shown; the header says which attempt is showing | CI |
| BR-8 | The named session is shared with other tasks (a per-worker or custom session policy) | The Session shows only the items stamped with this task's id, with a line saying the session is shared. It never shows the whole session as this task's, and never filters by time or order | CI |
| BR-9 | The run's session exists but the caller's principal can't reach it | A named state saying the run isn't visible to this user; no fallback to another session | CI |
| BR-10 | The row is parked | The Session shows the log and the row's reason; the ask is answered from Inbox (FIX-1662), and the task screen links there | CI |

## Controls

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Interrupt is pressed, or Esc with the Session focused | The request the row's link names gets the shipped abort. The view shows *interrupted* only after that request reads `aborted` | Goal check under `optimistic-interrupt` |
| BR-12 | The abort answers that the request already finished | The view refreshes to what the request and row say; nothing is drawn as interrupted | CI |
| BR-13 | The abort is refused or fails | The error shows by the button; the run is drawn as still running | CI |
| BR-14 | The run was interrupted | App Lab writes nothing to the row; its next status is whatever the board records | CI |
| BR-15 | Hand off, reassign or Open PR is shown | Disabled, with a line naming what arrives and its owner from the [registry](#gap-registry) | CI |
| BR-16 | The composer is shown | Disabled, with its owner line from the [registry](#gap-registry), which follows [the open fork](DECISIONS.md#open). *Also post to the workstream* is disabled with it | CI |

## Tabs and the inspector

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | Diff or Checks opens | A named empty state with its owner from the [registry](#gap-registry); the tab label carries no count | CI |
| BR-18 | The inspector renders | Worker and team from the inventory; started from the row. Harness, tokens and cost are one named gap ([registry](#gap-registry)): no shipped read gives a client what the run reported | Goal check |
| BR-19 | The run recorded a plan or file operations | The plan lists its steps with their status; files list path and created or edited | CI, against a seeded record |
| BR-20 | The run recorded neither | Each section says this harness records none ([registry](#gap-registry)) | Goal check (the stub records none) |
| BR-21 | Acceptance criteria and *review by* render | Named gaps, owners from the [registry](#gap-registry) | CI |
| BR-22 | Linked renders | *After*: the row's dependencies. *Blocks*: rows on the same board that depend on it. Each opens its task | CI |
| BR-23 | The trace link is shown | It opens the devtool App Lab was started with, with the run's session id beside it; with no devtool given, it is disabled and says how to start one | CI |
| BR-24 | Brief opens | The row's title, goal, context and input, as stored; acceptance criteria per BR-21 | CI |

<a name="gap-registry"></a>
## Gap registry

**The one place each gap's owner is written.** Every disabled control, empty tab and empty
field on the task screen takes its owner line from this table, as a prop at the surface (ER-5);
SPEC, PLAN and DOCS point here rather than repeat it. When a gap's owner ships, or the open fork
is answered, this table changes and the rest follows.

| Gap on the task screen | Day one | Owner | Rules |
|---|---|---|---|
| Typing to the worker, and *also post to the workstream* | Disabled composer | A child of FIX-1649 if [the open fork](DECISIONS.md#open) files it, else not in the first cut | BR-16 |
| Hand off, reassign, Open PR | Disabled | FIX-1651 | BR-15 |
| Diff, Checks | Empty tab, no count | FIX-1651 | BR-17 |
| Acceptance criteria, *review by* | Empty section | FIX-1651 | BR-21, BR-24 |
| Harness, tokens, cost | Empty field | FIX-1652 | BR-4, BR-18 |
| A harness that records no plan or files | A line saying so | FIX-1652 | BR-20 |

## Failure taxonomy

Nothing on the task screen is fatal. The row read failing shows the route's Retry; the
session read, the stream and each recorded collection failing degrade only their own tab or
section to Retry. A read that answers with a truncated page says *more than shown* with Retry;
App Lab never pages through a listing to find something. Nothing retries on its own, and
nothing is drawn from a guess or from App Lab's hope: a state changes on screen when the store
says it changed.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), with both controls failing where
named. ER-1 for the task level's tabs and panel. ER-5 for every gap here. ER-15 as its owner:
the only write this screen makes is the shipped abort, and it names the turn operation's state
for FIX-1662's composers.
