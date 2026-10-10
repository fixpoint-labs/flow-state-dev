# FIX-1866 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Alice and Bob are two users of one org. A *conversation* is a
coordinator session with its own task board ([FIX-1794](../FIX-1794/BUSINESS-RULES.md)). A
*coding run* is the harness manager's supervised run. *VG* is the goal check in
[SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met).

## Filing for the coder

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice's conversation has `eng.coder` as a delegate and files a task for it | Accepted and stored. `listDelegates` reports the coder as taking `tasks` (FIX-1842 now reports `nothing`) | CI · VG a |
| BR-2 | The coder is not this conversation's delegate, is Bob's, or was fired | Refused at filing as today, one answer for all three (FIX-1791 BR-3). The roster check runs on its own, live | CI |
| BR-3 | A task names `input.project` and the conversation has no project | Stored. The project is read when the run starts, not at filing | CI |

## Which repository

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The filing conversation leads a workstream, or was filed from one | The run works in that workstream's project (today's path) | CI |
| BR-5 | The filing conversation is a project conversation | The run works in that project. The task session got the project from the hand-over, server-written | CI · VG b |
| BR-6 | The conversation has no project and the task names one Alice is a member of | The run works in that project | CI · VG a |
| BR-7 | The task names a project Alice isn't a member of, or that doesn't exist | The run is refused `not-a-member` or `no-project`, after the claim. The row fails for good, `errored`, never `cancelled`, with one notice naming why. No checkout taken | CI |
| BR-8 | The conversation has no project and the task names none | Refused `no-project` the same way, and the notice says the task can name one | CI · VG c |
| BR-9 | The conversation has a project and the task names a different one | Refused, naming both. The conversation's project is never overridden | CI |
| BR-9a | Alice has a private `storefront` and can open a shared `storefront`, and the task names one by its visibility and id | The run works in the one named. A task naming a project by id alone is refused `no-project`, saying a project is named by its visibility and id; the coder never guesses between them | CI |
| BR-10 | The project has no repository | The run works on the project's files, and what it keeps is saved back to the project | CI · VG b |
| BR-11 | The project's remote isn't one the host allows | Refused by name, as today, after the claim: `errored` for good, one notice. (On the feature board a refused run stays cancelled, as today) | CI |

## The run

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A conversation's task is claimed | One coding run, in a checkout of its own, keyed by this board, this conversation and this task. Two conversations filing for the coder never share a checkout, branch or run record | CI |
| BR-13 | The task carries no `issue` or `phase` | Accepted as an answer task (D2): the task's id stands in for the issue. The canonical-id check still holds for tasks that name both | CI |
| BR-13a | A task on a conversation board names an `issue` and a `phase` | Feature work: the implement phase, a commit required, its id checked as on the feature board | CI |
| BR-13b | The task names an `issue` but no `phase`, or a `phase` but no `issue` | Refused after the claim: the row is `errored` for good with one notice saying feature work names both. It never runs as an answer task | CI |
| BR-14 | The run ends normally with a non-empty last message | `completed`. Output: the answer (cut at 8,000 characters), the branch, and how many commits it made, zero included | CI · VG a |
| BR-15 | The run stops at its limit, ends with no answer, or throws | A failed attempt with the reason. The second failure is `errored` with the error | CI · VG c |
| BR-16 | The run asks a question | The row parks the way the conversation board parks any task, and the conversation gets a `parked` line with the question (FIX-1794 BR-25). The person's answer comes back as the task's answer, and the next attempt's prompt carries it, in the same harness session | CI |
| BR-17 | Alice sends a message into the running run | It reaches the run, as on the feature board | CI |
| BR-18 | The task's second attempt starts | Same task session, same checkout, the harness session resumed | CI |
| BR-19 | Bob's request reaches Alice's task session or its row | Refused as today: the task session is Alice's, and the run acts as her | Existing suite |

## What the conversation hears

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | The task completes | One line under `eng.coder`, carrying the answer's start, through the task entry's own notice | CI · VG a |
| BR-21 | The task ends `errored` for any reason above | One line under `eng.coder` with the error. The row is `errored`, never left `in_progress` | CI · VG c |

## Jev's judgement (D4)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | A task with a goal passes its phase's check | The judge reads the goal, the answer, and the commits (count and subjects), once, before the row settles | CI · VG d |
| BR-25 | The judge says done, or says anything under the confidence floor | `completed`, as BR-14. The output carries `judged: true` | CI · VG a |
| BR-26 | The judge says not done, at or over the floor | The attempt fails with the judge's reason; the next attempt's prompt carries it. A second miss ends `errored` with the reason, one line under `eng.coder` | CI · VG c · VG d2 |
| BR-27 | The judge says ask, at or over the floor | The row parks through the conversation with the judge's question (BR-16's path). The person's answer reaches the next attempt's prompt | CI |
| BR-28 | The judge fails (throws, times out, the gateway is down) | The task settles on the phase's check alone, `judged: false` in the output. The judge never fails a task by failing itself | CI |

## The feature board, unchanged

| # | When | Then | Proved by |
|---|---|---|---|
| BR-22 | The EM's board hands the coder a feature row | The same run as today: the implement phase, a commit required, its run records under their old keys, no notice, no judge (the row has no goal) | The six `goals/devforce-lab/` checks |
| BR-23 | A feature row and a conversation task run at once | Each in its own checkout, under its own key | CI |

**Failure taxonomy.** A refusal of where to work (no project, not a member, a remote the host
refuses) is fatal on the first attempt, never retried, and ends `errored` on a conversation's
board. A run that fails (a throw, no
answer, the limit, the judge's not done) retries once. A question, the run's or the judge's, parks. Every ending reaches the conversation once.
Nothing the coder refuses happens before the claim, so no row is left in progress by it.

**Acceptance criteria this issue owns.** VG legs a to d2 pass, and each control fails on its named
signal. BR-22 holds: the DevForce lab checks are green on the last PR. The integration test runs
coordinator → `addTask` → `eng.coder` → a line in the conversation, and the failure case ends
`errored` with a notice.
