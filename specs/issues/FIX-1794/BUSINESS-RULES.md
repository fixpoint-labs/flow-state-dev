# FIX-1794 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A *conversation* is a
session on one of Alice's coordinators; its *board* is the task board it keeps. A *task session*
is the session a task runs in. The *proved by* column is the check the plan runs.

## Filing

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice, in the app or through the coordinator's tool, files a task naming one of this conversation's delegates | It is stored on this conversation's board, pending, and the filing returns. Its owner is the user whose scope holds it; nothing on the input decides it | CI · VG leg a |
| BR-2 | The assignee isn't on this conversation's delegate list, is Bob's, or is a name nobody holds | Refused with one answer for all three, naming the worker. Nothing stored | CI · VG leg d |
| BR-3 | The assignee is on the list but fails FIX-1791's check now (fired, or its flow takes no task) | Refused, naming why. Nothing stored | CI |
| BR-4 | The delegate record carries a target (a FIX-1793 workstream) | Refused, saying a workstream takes posts, not tasks | CI |
| BR-5 | The task names no assignee, and the conversation has exactly one delegate | It goes to that delegate | CI |
| BR-6 | The task names no assignee, and the conversation has none or several | Stored, pending, and the filing's answer says to assign it. No order picks one | CI |
| BR-7 | A filing would put a task more than five boards below the top of its chain ([D2](DECISIONS.md#d2)). Moves with the split if [Q](DECISIONS.md#q) moves it; this issue then refuses any filing from a task session, saying it can't split yet | Refused, naming the limit. Nothing stored | CI |
| BR-8 | A filing carries a board, a ledger, an owner, a depth or a partition | Ignored, or refused where the schema names it. Each comes from the conversation's server-written data | CI |
| BR-9 | The same task is filed twice, by id | The second adds nothing. If the row is still pending, it triggers the board's run again, which is idempotent; otherwise it starts nothing | CI |

## Who runs a board

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A task is added | The conversation's board runs in a request of its own, in the conversation, as its owner. The filing doesn't wait for it, and nobody runs it by hand | CI · VG leg a |
| BR-10a | The board's run is refused when the filing asks for it | The filing still succeeds, and the row records that its start is owed. The next filing or action on the board starts it, and so does filing the same id again (BR-9). An accepted filing is never left pending with nothing to start it | CI |
| BR-11 | Alice has two conversations, each with a pending task for one delegate, and one runs | It claims, lists, waits on and settles only its own. The other's task stays pending until its own conversation runs | CI · VG leg c |
| BR-12 | Bob opens, posts to or files on Alice's conversation | Refused, as today (engine ownership). Nothing claimed | Existing suite · VG leg d |
| BR-13 | Bob's conversation runs a board declared exactly like Alice's | It reads and claims only Bob's rows ([POC](poc/board-partition/README.md) X1) | CI · VG leg d |
| BR-14 | A conversation is deleted and created again under the same id | Its board starts empty. The old rows stay in the store, unread, and no run of the new one claims them | CI |
| BR-15 | A task's run lapses (its session died), including a task session on another flow | The next run of its board takes it back through its own partition, within the board's abandonment allowance, as today | CI (V2, across a flow) |

## The task session

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | A task is handed over | It runs in a new session, a child of the conversation, owned by Alice, born linked to the delegate (FIX-1788 BR-18), on the flow the delegate names. It reads and settles its row on the board that filed it | CI · VG legs a and b |
| BR-17 | A task's second attempt is handed over | It re-enters the same task session | CI |
| BR-18 | A task is reassigned to another worker | Its next attempt opens a new task session for the new worker; the old one keeps its history | CI |
| BR-19 | Alice calls `findWorkerSession({ worker, taskId, coordinatorSessionId })` | The task's session, or none. Never another user's, and never another conversation's: two of her conversations that file the same task id for the same worker each find their own | CI · VG leg a |
| BR-20 | Alice calls `ensureWorkerSession` with a `taskId` whose task has no session yet | Refused, saying a task's session is opened when the task is handed over. Nothing created | CI |
| BR-21 | A task's input names another board, partition or task | It can't reach them. The row it settles is the one its hand-off named, checked against its claim | CI |

## How it ended

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | An attempt completes | One notice in the conversation: the task, `completed`, the worker and its output summary. The coordinator's turn reads it | CI · VG leg a |
| BR-23 | An attempt fails with attempts left | No coordinator turn. The board runs again and the next attempt starts | CI · VG leg e |
| BR-24 | The last attempt fails, or the hand-over is refused every time | One notice: `errored`, with the error | CI · VG leg e |
| BR-25 | The worker parks the task on a question | One notice: `parked`, with the question. Answered and completed later, a second notice, `completed` | CI |
| BR-26 | A notice is delivered twice | One coordinator turn per task, attempt and ending | CI |
| BR-26a | The process dies after an ending is recorded and before its notice is sent | The ending's record carries the notice as owed. The next run of the board, or action on it, sends it, once | CI |
| BR-27 | The conversation is mid-turn when a notice arrives | It runs after, never dropped | CI |
| BR-28 | The conversation was deleted, or its worker fired, before the notice | The notice is refused and recorded on the task session. The task's ending stands | CI |
| BR-29 | A task is cancelled, relabelled or reprioritized | No notice | CI |

## Reassign and cancel

FIX-1780's [BR-16 to BR-22](../FIX-1780/BUSINESS-RULES.md#reassign-and-cancel), unchanged except
where they name a worker: the new worker is one of this conversation's delegates, through BR-2's
check. A reassigned task runs at once.

## The chain

BR-30 to BR-32 are the split, and ship here only if [Q](DECISIONS.md#q) keeps it; otherwise
they move to its follow-up with goal leg b, and BR-33 holds at one level.

| # | When | Then | Proved by |
|---|---|---|---|
| BR-30 | A coordinator delegate's task session splits its task | It files the pieces on its own board, for its own delegates, under BR-1 to BR-9. The pieces are Alice's | CI · VG leg b |
| BR-31 | It has filed its pieces and its turn ends | Its own task waits on the board above: parked, marked as waiting on its pieces, with no notice for that park. Nothing lapses while it waits | CI · VG leg b |
| BR-32 | The last open piece ends, after any turn its notice woke | Its task settles on the board above: `completed` with the pieces' outputs when none failed for good, `errored` naming the ones that did. It settles through the binding written when it parked (that row's partition and claim ticket), never a coordinate from input or a payload, and still does after a restart. That board's conversation hears it | CI · VG leg b |
| BR-33 | Any session in a chain is listed | Every one is Alice's. Bob's workers never appear, because every assignee passed BR-2 | VG legs b and d |

## Failure taxonomy

A refused filing writes nothing and says why in the same answer. A failed attempt retries
within the task's attempts, then ends `errored` and is heard once. A run that dies is taken back
by the next run of its board. A start or a notice lost to a crash stays owed on its row, and the
next touch of the board sends it. A notice that can't land is recorded on the task session and
changes nothing. Nothing here deletes a row, a session or a notice.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to e pass on Shift Manager with
two users, and each control fails on its named signal. Epic [ER-9](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)
holds, which the closure's leg b relies on.
