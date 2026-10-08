# FIX-1817 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Alice and Bob are two users of one org. A *conversation* is the
session whose board filed the task (FIX-1794); a *task session* is the session the task runs in.
The *proved by* column is the check the plan runs.

## Stopping on a question

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker's task turn ([PLAN S1](PLAN.md#surfaces)'s test) calls `parkOnQuestion` with a question | The row it was handed parks, holding the question; the turn ends; no lease runs. The conversation gets one `parked` notice with the question (FIX-1794 BR-25) | CI · VG leg a |
| BR-1a | The task turn is working an asked row (filed with `waitForResponse: true`, [FIX-1816](../FIX-1816/BUSINESS-RULES.md#asking)) | In v1 it has no `parkOnQuestion` tool, by epic [ER-22](../../epics/FIX-1815/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), which this issue owns (FIX-1816 BR-5b mirrors it). The worker answers with what it has, or fails, and the ask ends with that. The carve-out reads the row being worked: an assigned follow-up of a finished asked task is not asked, and has the tool | CI |
| BR-2 | A turn that is not a task turn (a person's message, a post): not a turn the gate serves, the one test [PLAN S1](PLAN.md#surfaces) owns | Has no `parkOnQuestion` tool | CI |
| BR-3 | The tool is called twice in one turn, or after the turn's claim was displaced (a cancel or reassign landed) | The second call, or the displaced one, is declined, naming the row's status. Nothing written | CI |
| BR-4 | The worker parks, and its turn then returns an answer anyway | The row stays parked. The answer is not recorded (FIX-1234's recorder rule) | Existing suite · CI |
| BR-5 | A task session that filed pieces (FIX-1802) also asks a question in the same turn | The second park is declined, naming the first. A task waits on one thing at a time | CI |

## Answering

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | The conversation that filed the task answers it, by tool or action | In one write the row goes back to `pending` with the answer, and its start is owed (FIX-1794 S5's marker). The board's own run hands it to the **same** task session | CI · VG leg a |
| BR-7 | The re-entered turn runs | Its message is the answer, labelled as the answer to the question it asked. The model is also handed the session's earlier turns: the task as filed, what the worker did, its question | CI, red on `main` (POC F1, R1) · VG leg a |
| BR-8 | The re-entry is claimed | It is not charged against the task's attempts. A real failure afterwards is charged as usual | CI, red on `main` (POC R1) |
| BR-9 | A task is answered twice, or after it was cancelled or reassigned | Declined, naming its status. Nothing re-queued | CI |
| BR-10 | `answerTask` names a task that isn't parked on a question: pending, running, parked for its pieces (FIX-1802), or parked for a person's turn (FIX-1690) | Declined, naming why. Nothing written | CI |
| BR-11 | Another conversation of Alice's, or Bob, names the task | The same answer as an unknown task (the board's partition, FIX-1794 D1) | CI |
| BR-12 | The process dies after the answer's write and before the board runs | The owed start survives. The next touch of the board runs it (FIX-1794 BR-10a) | CI |
| BR-13 | Nobody answers | The task waits. Nothing times out. `cancelTask` ends it, with no notice | Existing suite |
| BR-14 | The worker asks again after an answer | Another `parked` notice. Each answer is one more turn in the same session | CI |
| BR-15 | An answered task completes or fails for good | One `completed` or `errored` notice, as today | CI · VG leg a |
| BR-16 | A piece filed by a task session parks on a question | Its `parked` notice wakes the task session that filed it (FIX-1802 BR-15), which answers by the same verb on its own board | CI |

## After it finishes

| # | When | Then | Proved by |
|---|---|---|---|
| BR-17 | Alice sends a message through the worker's door into a finished task's session (completed, errored or cancelled) | It runs as a turn in that session, handed its whole history. The row doesn't change. No notice | CI · VG leg b |
| BR-18 | Bob sends to it | Refused, as today (engine ownership) | Existing suite |
| BR-19 | The worker was fired, or its flow is gone | Refused (FIX-1788 BR-19, BR-19a). These are the only refusals | Existing suite |
| BR-20 | A follow-up task names a finished task (`followUpOf`) | A new row on the same board, with its own id. Its hand-off opens no session: it runs in the finished task's session. The session is reached by the finished task's id. Its ending is heard like any task's | CI · VG leg c |
| BR-21 | The named task hasn't finished | Refused, naming its status. Nothing stored | CI |
| BR-22 | The follow-up names an assignee | Refused at input: a follow-up takes the finished task's worker, and another worker is another session | CI |
| BR-22a | `followUpOf` and `waitForResponse: true` are set on one `addTask` call (mirror of FIX-1816 BR-4a) | Allowed. FIX-1816's assignee check runs against the root task's worker. BR-21's and BR-25's refusals, and BR-22's, come before anything is filed, so nothing parks. The asked follow-up runs in the root task's session, with no `parkOnQuestion` (BR-1a) | CI |
| BR-23 | The named task is on another conversation's board, or Bob's | The same answer as an unknown task. Nothing stored | CI |
| BR-24 | A follow-up names a follow-up | It runs in the same session, the first task's | CI |
| BR-25 | A follow-up names a task whose session already has an unfinished task | Refused, naming that task. One task at a time in a session | CI |
| BR-26 | Any task write names the finished task's own row, by tool or action | Declined, naming its status; nothing written (FIX-1794 leg e). `completeTask`, `failTask` and `blockTask` answer `illegal_status_transition`. `assignTask`, `cancelTask` and `answerTask` (BR-9; its fenced `unpark`) answer `terminal_task_write_declined`. `parkOnQuestion` can't reach it: no claim is live (BR-3) | Existing suite · CI for `answerTask` |
| BR-27 | A person's message reaches a task session while a follow-up task runs there | It follows the session's concurrency policy (`allow`, `queue` or `reject`), as any turn does | Existing suite |

## Failure taxonomy

A declined park, answer or follow-up writes nothing and says why in the same answer. An answer
lost to a crash is not lost: the start it owes is on the row, and the next touch of the board
runs it. A task never ends because of a question; only a person, a cancel or a real failure ends
it. Nothing here deletes a row, a session or a notice.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to c pass on Shift Manager on a
real model, and each control fails on its named signal. Epic ER-2 and ER-3 hold, which the
closure's leg b relies on.
