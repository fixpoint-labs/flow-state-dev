# FIX-1777 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

## A task is added

| | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A task is added to a mailbox's task list by a post door, `fileTask`, the board action, a worker's board tool, or a worker's own board | The list runs in a request of its own, and the task goes to the worker it's for, with nobody running the list by hand | Goal leg a (four routes) · leg c (DevTeam post) |
| BR-2 | The filer is a coordinator mid-turn | Its filing returns as soon as the task is stored. The turn does not wait for the run | Goal leg a (call returns before the task completes) |
| BR-3 | The task names a worker (assignee) | It goes to that worker, through FIX-1778's lookup; a board alias wins over the lookup | FIX-1778's checks; leg a's assigned route |
| BR-4 | The task names no worker, and exactly one worker works the list (BR-18) | It goes to that worker | Leg a's unassigned route |
| BR-5 | The task names no worker and no worker works the list | The task is filed and waits, and the filing's answer says why. Nothing errors in the filer's turn. A task that names a worker no one holds, or two hold, is refused at filing, and one whose worker was let go after filing fails at hand-over; both are FIX-1778's rules (its BR-11 and BR-4), not this one | Workforce unit test |
| BR-6 | A filing adds nothing (the task already existed, or the write was an update) | Nothing runs | Workforce unit test; DevTeam board check, repeat post |
| BR-7 | The list is a worker's private board, not a mailbox's | As today: nothing runs on add | Workforce unit test (negative) |

## Who works a list

| | When | Then | Proved by |
|---|---|---|---|
| BR-18 | Deciding who works a mailbox's list | The workers the mailbox names for it: `workedBy:` in its `MAILBOX.md`, plus those subscribed with `worksTaskList` at run time (FIX-1779), minus any worker unsubscribed from it since. Being a member, or declaring the list's ledger, counts for nothing | Workforce unit test: a member that declares the ledger and isn't named is not handed a task |
| BR-19 | The task names no worker and more than one works the list | The task is filed and waits, and the filing's answer says to assign it. No order picks one | Workforce unit test |

## Whose run it is

| | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A task is filed | Its owner is the filer's resolved identity, recorded at filing, never taken from input (BP-031). A coordinator filing in a person's session files as that person. The task also carries `filingWorker` (FIX-1779 BR-15), the calling worker's name from the runtime; only the owner decides the claim and the bill | Goal leg b |
| BR-9 | Two members file on one list at once | Each run is its filer's; a run started by one member's filing claims none of the other's tasks | Goal leg b |
| BR-10 | A task filed before this change has no owner | It is claimed by the next run of its list, as today, and owned from its first run (BP-030, the old shape tolerated) | Workforce unit test, legacy row |

## Failures

| | When | Then | Proved by |
|---|---|---|---|
| BR-11 | Starting the list's run fails (the "run this list" hand-off is refused, before any task is claimed) | The task stays *pending*, spends no attempt, and the next run of the list picks it up. A claimed task whose hand-over to its worker is refused is an attempt that failed: it spends an attempt, per BR-12, so one refused every time ends *errored* (FIX-1780 BR-7). The filing itself still succeeds; the failure is recorded on the run's own request, not the filer's | Workforce unit test |
| BR-12 | The run's attempt fails, including a refused hand-over to the worker | Back to *pending*, or *errored* once its attempts are spent, as today. This issue starts no re-run; FIX-1780 BR-6a does | Unchanged |
| BR-13 | Two runs of one list overlap (two filings, or a host's manual drain) | One run per task: a claimed task is not claimed twice | `packages/orchestration/test/task-board/task-board-concurrent-drains.test.ts`, existing |
| BR-14 | The control `no-wake` is set | Adding a task runs nothing, and nothing else changes | Goal control |

## DevTeam

| | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A `slug: what` line is posted on `eng.feature` | The EM files it and the coder's run completes, with no drain from the EM | Goal leg c |
| BR-16 | Inbox Approve | Files; the run starts by BR-1. Deny files nothing | `goals/devforce-lab/it-waits-for-a-person-before-it-files` |
| BR-17 | The coding run belongs to the filer | The harness manager's existing run-owner refusal still holds, now with the owner known at filing | `packages/harness-manager/test/run-owner-dispatcher.spec.ts` + leg b |

## What this issue owns

- BR-1, BR-2, BR-4 to BR-19: the start on add, ownership at filing, and DevTeam's doors moving to the one rule.
- Not owned: resolving an assignee to a worker (FIX-1778, BR-3); a run-time mailbox, its list,
  `worksTaskList`, and the `taskListWorkers` read that joins both halves of BR-18 (FIX-1779); retries on their own and telling the coordinator a task
  settled (FIX-1780).

## Acceptance

- A task added by any of the four routes runs with no hand drain, as its filer (BR-1, BR-8).
- One member's filing never starts another member's task (BR-9).
- DevTeam's post and Approve start the coder with no drain of their own (BR-15, BR-16).
