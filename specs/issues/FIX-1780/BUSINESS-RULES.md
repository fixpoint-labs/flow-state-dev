# FIX-1780 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

## Who is a filer

| | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A worker files a task through its `fileTask` tool | The task carries FIX-1779's `filingWorker` and, beside it, the conversation it filed from (`filingSession`, with its lineage), recorded at the same point and from the same runtime context as `filingWorker`. The owner FIX-1777 records plays no part | Goal leg a |
| BR-2 | A client, a post door or a host files a task (not a worker's tool) | No filer is recorded. The task runs as today and nobody is woken when it ends | Goal leg e |
| BR-3 | A tool input or a request body carries a field that looks like a filer or a conversation | It is ignored. Only the runtime context of the filing turn counts (BP-031) | Unit test on the filer record |
| BR-4a | A worker's filing is refused (a list the mailbox doesn't hold, a name nobody holds, a worker the list doesn't name) | No notice. The refusal is `fileTask`'s tool error in the same turn (FIX-1779 BR-16, FIX-1778 BR-11 and BR-11a). No task exists, so there is nothing to follow | FIX-1779's tests |
| BR-4 | A task stored before this shipped, or with no filer | Read through one `== null` guard: no notice (BP-030) | Unit test |

## When the filer is woken

| | When | Then | Proved by |
|---|---|---|---|
| BR-5 | An attempt completes | One notice: the task, `completed`, the worker that ran it, and its output summary | Goal leg a |
| BR-6 | An attempt fails and attempts are left | No notice. The task goes back to *pending* as today | Goal leg b (no notice after attempt 1) |
| BR-6a | A task went back to *pending* after a failed attempt | The list runs again, so the next attempt happens without anyone else running it. Without this a retry would wait for good and the filer would never hear. This issue owns it: FIX-1777 leaves a re-pend waiting (its BR-12). A refused hand-over spends an attempt (FIX-1778 BR-4) and re-runs the same way | Goal legs b and f reach attempt 2 |
| BR-7 | The last attempt fails, or the hand-over is refused on every attempt | One notice: `errored`, with the error or the refusal | Goal legs b and f |
| BR-8 | The worker parks the task on a question or a review (`awaitReview`) and returns | One notice: `parked`, with the question. A park answered and then completed gives a second notice, `completed`. A later park of the same task is a new notice | Goal leg c |
| BR-8b | The run stops on an approval (`ctx.suspend`), or the harness door parks it for a person's turn | No notice. Those are not covered here ([follow-ups](PLAN.md#follow-ups)) | Unit test |
| BR-8a | A notice's delivery is retried by the host (a restart, a redelivery) | The filer still gets one turn for that ending: the notice carries the task id, attempt and ending, and the entry drops one it has already answered | Unit test |
| BR-9 | Anyone cancels the task, or changes its labels, priority or assignee | No notice (D3) | Unit test on the hook's filter |
| BR-10 | The attempt ran handed off, in the worker's own session | The same notices, sent from that session after its result is recorded | Goal legs a to c run handed off |
| BR-11 | The attempt's result could not be recorded (the board's recorder-failure path), or the write was declined because a newer attempt owns the task | No notice from this attempt: it did not end the task. The board's existing report stands | Unit test |

## Where the notice lands

| | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A notice is sent | It runs a turn in the filer's conversation (the session it filed from), through the entry the worker's kind declares. The turn's reply lands in that conversation | Goal leg a |
| BR-13 | That conversation is mid-turn | The notice runs anyway, as a mailbox post does. It is never dropped for being busy | Unit test on the entry's concurrency |
| BR-14 | The filer's kind declares no task-notice entry, its session is gone or was recreated under the same id, or the worker was fired | The delivery is refused by name and recorded as a failed request on the session that settled the task. The task is unaffected | Unit test |
| BR-15 | The recorded worker and the session's flow disagree | The delivery is refused (the address must agree). Nobody else is woken | Unit test |

## Reassign and cancel

| | When | Then | Proved by |
|---|---|---|---|
| BR-16 | `reassignTask` names a *pending* or *parked* task and a worker the lookup resolves | The task keeps its id and is moved through the board's `assignTask`; a parked task goes back to *pending* (its open question is withdrawn). The list runs it for the new worker. The tool returns the same id | Goal leg d |
| BR-16a | `reassignTask` names an *errored* task and a worker the lookup resolves | It stays *errored*. A new task with the same goal, title, context and input is filed for that worker on the same list, naming the old task and this filer. The list runs it. The tool returns the new id | Goal leg d |
| BR-16b | Anyone moves a *pending* or *parked* task on a list that hands tasks over, through `assignTask` | Allowed. The freeze on such a list holds only while an attempt holds the task: an *in progress* task still declines `immutable-assignee`. A bare `assignTask` moves the task but does not start it; `reassignTask` is the way to move a task and run it (BR-16). FIX-1777 agrees: only an add starts a list | Orchestration test |
| BR-17 | `reassignTask` or `cancelTask` names a task that is *in progress* | Refused, `task-running`. Nothing changes | Unit test |
| BR-18 | It names a task that is *completed* or *cancelled* | Refused with the status. Nothing changes | Unit test |
| BR-19 | `reassignTask` names a worker nobody holds or two workers hold, or (under FIX-1778's D3 option (ii)) a worker the list doesn't name | Refused through FIX-1778's filing check (its BR-12a), naming the worker, or the list's workers. The task is not touched. If Jake picks option (i), the list check goes and the rest stay | Unit test |
| BR-20 | The same work has been reassigned three times | The fourth `reassignTask` is refused, `reassign-limit`. The coordinator must tell the person | Unit test |
| BR-21 | `cancelTask` names a *pending*, *parked* or *blocked* task | It is cancelled with the given reason, through the board's own cancel verb. No notice (BR-9) | Unit test |
| BR-22 | Two reassigns of one task race | On a waiting task the board's guarded write lets one land, and the other sees the new assignee. On an *errored* task a revision-guarded mark on the old row lets one file, and the other files nothing. The move cap holds under the same race. Each move re-checks the status in its guarded write, so a claim that lands first makes the move refuse `task-running`; an errored task's copy is filed only after its mark lands | Unit test |

## What this issue owns

- The filer record, the settle hook, the notice and its entry on the `agent` kind, and the two
  verbs (BR-1 to BR-22).
- Not owned: what the coordinator decides when woken ([FIX-1774](https://linear.app/fixpoint-labs/issue/FIX-1774));
  the list running a task when it is filed ([FIX-1777](https://linear.app/fixpoint-labs/issue/FIX-1777));
  the assignee lookup ([FIX-1778](https://linear.app/fixpoint-labs/issue/FIX-1778)); the
  `fileTask` tool ([FIX-1779](https://linear.app/fixpoint-labs/issue/FIX-1779)); stopping a running task
  ([FIX-1659](https://linear.app/fixpoint-labs/issue/FIX-1659)).

## Acceptance

- A worker that filed a task is woken in the conversation it filed from on completed, failed for
  good and parked, once each (BR-5 to BR-8, BR-12).
- A task filed by anyone else wakes nobody (BR-2).
- A coordinator can reassign or cancel a task that is not running, and a reassigned task starts
  (BR-16 to BR-21).
