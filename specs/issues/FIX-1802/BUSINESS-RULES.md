# FIX-1802 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A worker *files* in a
session when that session's delegate list holds at least one worker whose flow takes a task; that
is the whole grant ([D1](DECISIONS.md#d1)). The list starts as a copy of the file's `delegates:`
(FIX-1791 BR-1), and it is the one the assignee check reads, per call (FIX-1794 T1). Its *session* is the one it runs in: a talk session, a delegate's
session or a task session. Its *board* is the one that session keeps. A *coordinator* is the flow
built for routing posts (epic D8), not a kind that files. FIX-1794's rules hold on
every board here unchanged ([its BR-1 to BR-29](../FIX-1794/BUSINESS-RULES.md)), with "the
conversation" read as "the session". The *proved by* column is the check the plan runs.

## The grant

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A session's delegate list holds a delegate that takes a task, from the file or added since, and its flow carries the task tools | Its turn has Orchestration's eight task tools over its session's board, and the app's actions of those names (`<tool>_<board>`) work on that session. The list grants no access ([epic ER-17](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do)): it decides which tools a turn carries, and every task's assignee is checked against the user's roster and FIX-1788's links when filed and again when delivered | CI · VG legs a, b |
| BR-2 | A session's delegate list holds no delegate that takes a task: none at all, or only ones that take posts (a routing coordinator) | Its turn has none of the eight. Its session keeps no board, so the app's `addTask` action on it answers `no_delegation_board`. Nothing stored | CI · VG leg c |
| BR-3 | A worker's file lists a task-taking delegate, and its flow doesn't carry the task tools | Its turn has none, and its flow has no such actions. Nothing is refused at load | CI |
| BR-4 | A file lists delegates and nothing uses them: its flow routes no posts, and none takes a task | Accepted at load. Nothing files and nothing posts | CI |
| BR-5 | A session gains its first, or loses its last, task-taking delegate mid-conversation, through `addDelegate` or `removeDelegate` | The next call reads it: an add shows the tools and opens the actions, and removing the last hides them. A session that lost it adds and changes nothing more (`no_delegation_board`); its rows still run, settle and notify. A change to the file reaches only sessions whose list is copied after it (FIX-1791 BR-1) | CI |
| BR-6 | A session create carries delegates, a depth or a chain in its state | Refused with a 400 naming the field: each is server-written state (FIX-1788 S1, FIX-1791 BR-8). An action's or a tool's input that carries a delegate list, a board, a depth or a chain is ignored, or refused where the schema names it (FIX-1794 BR-8) | CI |

## Who it files for

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A filing worker's session is first read or changed | Its delegate list is copied from the file's `delegates:`, as FIX-1791 BR-1 says | CI |
| BR-8 | It adds or assigns a task for a worker that isn't on its session's list, is Bob's, or doesn't exist | One answer for all three, the tools' roster refusal (`unknown_assignee`), naming the worker and the delegates it can file for (FIX-1794 BR-2). Nothing stored | CI · VG leg a |
| BR-9 | A delegate is added whose flow takes tasks but no delegated post | Accepted: a delegate takes a post or a task. A post to it is skipped and recorded, as an unreachable delegate is; a task for it runs | CI |
| BR-10 | It files for a delegate whose flow takes no task | Refused as BR-8: the roster holds only delegates that take a task, and the answer lists them (FIX-1794 BR-3) | CI |
| BR-10a | A standard worker's `delegates:` names a worker that isn't standard, on any flow | Refused at load, naming it: FIX-1791 BR-11's rule, carried to every standard worker that lists delegates (epic ER-6) | CI |

## Which board

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | A filing worker files from any session | The row lands on that session's own board, in its partition, and that board runs as the owner (FIX-1794 BR-10) | CI · VG leg a |
| BR-12 | A delegate's session (a workstream lead's included) files | The rows and their notices are that session's, not the poster's. Its answer to the post is not held | CI |
| BR-13 | Two sessions of one filing worker each file | Each runs, lists and waits on only its own (FIX-1794 BR-11) | CI |

## The split

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A filing worker's task session files pieces, and its turn ends | Its own task waits on the board above: parked, marked as waiting on its pieces, with no notice for that park. Parking writes a parent binding, server-side: that row's partition and claim ticket. Nothing lapses while it waits (FIX-1794 BR-31) | CI · VG leg a |
| BR-15 | A piece ends | Its notice wakes the task session's turn, which may reassign or cancel a piece (FIX-1794 BR-22 to BR-25) | CI |
| BR-16 | The last open piece ends, after any turn its notice woke | The parent settles on the board above through its binding, never a coordinate from input or a payload: `completed` with the pieces' outputs when none failed for good, `errored` naming the ones that did. That board's session hears it once (FIX-1794 BR-32) | CI · VG leg a |
| BR-17 | The turn the last piece's notice woke fails, or the process dies before the settle | The last piece's ending wrote a settle-owed marker. A touch of that board or any board above it settles the parent, once: a touch replays owed settles down the chain by dispatching "run my board" into each parked row's task session, which reads only its own board. So the user's next message, or any `listTasks`, unsticks it. A replay between settle and clear settles nothing twice | CI |
| BR-18 | A turn reassigns the failed last piece | The parent stays open; the marker waits for that piece's next ending | CI |
| BR-19 | A split task is changed from above while its pieces are open | `assignTask` is declined, `immutable-assignee`, as for any task an attempt holds. A change that lands (`cancelTask`, `completeTask`, `failTask` or `blockTask`, under the tools' existing transitions) cancels its open pieces, down the chain; its own later settle is declined by the claim fence, and the settle-owed marker clears | CI |

## How far a chain goes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A filing would put a task on a sixth board below the top of its chain | Refused as a full board is (`total_task_cap_exceeded`): the sixth board takes no task. Nothing stored. The depth is fixed | CI · VG leg d |
| BR-21 | A filing would be the 101st task under one top task, at any depth, finished pieces included | Refused the same way. Nothing stored. A reservation whose add never landed is dropped once its lease passes; no other board's rows are read. Per chain: a coordinator posting again starts a fresh one, which board caps still bound | CI · VG leg d |
| BR-21a | The app sets its own chain cap on its Workforce setup | Every chain in that app stops at that number instead of 100, under BR-21 and BR-22. Depth stays five | CI · VG leg d |
| BR-22 | Two pieces of one chain file at once, one below the cap | Exactly one is accepted and the other refused; the count ends at the cap | CI |
| BR-22a | Two sessions' chains have top tasks with the same id | Each keeps its own count | CI |
| BR-23 | Any session in a chain is listed | Every one is Alice's, and every assignee passed BR-8 (FIX-1794 BR-33) | VG leg a |

## Failure taxonomy

A refused filing writes nothing and says why, in the task tools' existing answers. Nothing about
the grant refuses a file at load; the one load refusal is BR-10a's, carried from FIX-1791. A piece fails and retries as FIX-1794 says. A
lost parent settle stays owed on its row (BR-17). Nothing here deletes a row, session or notice.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to e pass on Shift Manager with two
users, and each control fails on its named signal. FIX-1792's BR-13a and the closure's leg b rely
on BR-1, BR-8 and BR-11.
