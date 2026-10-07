# FIX-1802 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A worker is *granted* when
its file says `filing: true`. Its *session* is the one it runs in: a talk session, a delegate's
session or a task session. Its *board* is the one that session keeps. A *coordinator* is the flow
built for routing posts (epic D8), not a kind that files. FIX-1794's rules hold on
every board here unchanged ([its BR-1 to BR-29](../FIX-1794/BUSINESS-RULES.md)), with "the
conversation" read as "the session". The *proved by* column is the check the plan runs.

## The grant

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker's file says `filing: true`, and its flow carries the filing capability | Its turn has the four filing tools, and the app's actions of those names work on its sessions | CI · VG legs a, b |
| BR-2 | A worker's file doesn't grant filing | Its turn has none of the four. The app's `fileTask` on its session is refused, saying the worker isn't granted filing. Nothing stored | CI · VG leg c |
| BR-3 | A file grants filing, and its flow lacks either half of the capability, or the file names no `delegates:` | Refused when the app loads, naming the worker and what is missing | CI · VG leg c |
| BR-4 | A file names `delegates:`, and nothing uses them: its flow routes no posts, and it doesn't grant filing | Refused when the app loads, naming the file | CI · VG leg c |
| BR-5 | A worker's file gains or loses the grant while a session is open | The next run reads it. A session that lost it files nothing more; its rows still run, settle and notify | CI |
| BR-6 | A caller's input or a session create carries a grant, a board, a depth or a chain | Ignored, or refused where the schema names it | CI |

## Who it files for

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A granted worker's session is first read or changed | Its delegate list is copied from the file's `delegates:`, as FIX-1791 BR-1 says | CI |
| BR-8 | It files for a worker that isn't on its session's list, is Bob's, or doesn't exist | One answer for all three, naming the worker (FIX-1794 BR-2). Nothing stored | CI · VG leg a |
| BR-9 | A delegate is added whose flow takes tasks but no delegated post | Accepted: a delegate takes a post or a task. A post to it is skipped and recorded, as an unreachable delegate is; a task for it runs | CI |
| BR-10 | It files for a delegate whose flow takes no task | Refused, naming why (FIX-1794 BR-3) | CI |

## Which board

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | A granted worker files from any session | The row lands on that session's own board, in its partition, and that board runs as the owner (FIX-1794 BR-10) | CI · VG leg a |
| BR-12 | A delegate's session (a workstream lead's included) files | The rows and their notices are that session's, not the poster's. Its answer to the post is not held | CI |
| BR-13 | Two sessions of one granted worker each file | Each runs, lists and waits on only its own (FIX-1794 BR-11) | CI |

## The split

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | A granted worker's task session files pieces, and its turn ends | Its own task waits on the board above: parked, marked as waiting on its pieces, with no notice for that park. Parking writes a parent binding, server-side: that row's partition and claim ticket. Nothing lapses while it waits (FIX-1794 BR-31) | CI · VG leg a |
| BR-15 | A piece ends | Its notice wakes the task session's turn, which may reassign or cancel a piece (FIX-1794 BR-22 to BR-25) | CI |
| BR-16 | The last open piece ends, after any turn its notice woke | The parent settles on the board above through its binding, never a coordinate from input or a payload: `completed` with the pieces' outputs when none failed for good, `errored` naming the ones that did. That board's session hears it once (FIX-1794 BR-32) | CI · VG leg a |
| BR-17 | The turn the last piece's notice woke fails, or the process dies before the settle | The last piece's ending wrote a settle-owed marker. A touch of that board or any board above it settles the parent, once: a touch replays owed settles down the chain by dispatching "run my board" into each parked row's task session, which reads only its own board. So the user's next message, or any `listTasks`, unsticks it. A replay between settle and clear settles nothing twice | CI |
| BR-18 | A turn reassigns the failed last piece | The parent stays open; the marker waits for that piece's next ending | CI |
| BR-19 | A split task is reassigned or cancelled from above while its pieces are open | A reassign is refused, as for a running task (FIX-1780 BR-16 to BR-22). A cancel cancels it and its open pieces, down the chain; nothing settles it afterwards, and the settle-owed marker clears | CI |

## How far a chain goes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A filing would put a task on a sixth board below the top of its chain | Refused, naming the limit of five. Nothing stored | CI · VG leg d |
| BR-21 | A filing would be the 51st task under one top task, at any depth, finished pieces included | Refused, naming the limit of 50. Nothing stored. A reservation whose add never landed is dropped once its lease passes; no other board's rows are read. Per chain: a coordinator posting again starts a fresh one, which board caps still bound | CI · VG leg d |
| BR-22 | Two pieces of one chain file at once, with 49 counted | Exactly one is accepted and the other refused, naming the limit; the count ends at 50 | CI |
| BR-22a | Two sessions' chains have top tasks with the same id | Each keeps its own count | CI |
| BR-23 | Any session in a chain is listed | Every one is Alice's, and every assignee passed BR-8 (FIX-1794 BR-33) | VG leg a |

## Failure taxonomy

A refused filing writes nothing and says why. A load-time refusal (BR-3, BR-4) names the file,
and the rest of the app loads as FIX-1789 decides. A piece fails and retries as FIX-1794 says. A
lost parent settle stays owed on its row (BR-17). Nothing here deletes a row, session or notice.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to e pass on Shift Manager with two
users, and each control fails on its named signal. FIX-1792's BR-13a and the closure's leg b rely
on BR-1, BR-8 and BR-11.
