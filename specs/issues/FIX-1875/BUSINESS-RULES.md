# FIX-1875 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. "The board" means a conversation's board unless a
row says otherwise. Epic rules this issue owns are ER-1 to ER-4; every row below serves one.

## Recording work

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | `addTask` (tool or action) records a row with an assignee | The row is pending and waiting for dispatch. No run, no task session, however often the board is touched | CI · goal `rec:waits` |
| BR-2 | `addTask` records a row with no assignee, in a conversation with one delegate | It is given that delegate, as today, and still waits for dispatch | CI |
| BR-3 | `assignTask` names a new owner for a row waiting for dispatch | The owner changes; the row keeps waiting | CI |
| BR-4 | `assignTask` moves a row that was already dispatched and not yet claimed | It moves and starts, as today: the dispatch already happened | CI |
| BR-5 | A row filed before this change has an assignee and no mark | It starts as it does today (BP-030) | CI, a row written in the old shape |
| BR-6 | Flow code writes the board directly | Today's behaviour: an assigned row starts | Existing suite |
| BR-7 | `addTask` runs on a board a drain runs (`taskBoard()`, a pattern) | Exactly as today. No mark, no `dispatchTask` in the tool list | Existing suite |

## Dispatching work

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | `dispatchTask({ goal, … })` | A row is filed ready and the board starts it now. The call returns its id at once | CI · goal `disp:new-runs` |
| BR-9 | `dispatchTask({ taskId })` names a row waiting for dispatch | The mark clears and the row starts. With `assignee`, the owner is set in the same write | CI · goal `disp:ref-runs` |
| BR-10 | `dispatchTask({ taskId })` names a row that is claimed, running, ended, or already dispatched | Refused, naming its state. Nothing changes | CI |
| BR-11 | `dispatchTask({ taskId })` names a row not on the caller's own board | `task_not_found`. Nothing changes | CI · goal `lineage:refused` |
| BR-12 | Both `goal` and `taskId`, or neither | Refused before anything is written | CI |
| BR-13 | `taskId` with a field that only a new row takes (`deps`, `input`, `followUpOf`, …) | Refused before anything is written. To change a recorded row, `updateTask` first | CI |
| BR-14 | Every check `addTask` runs (assignee on the roster, follow-up rules, chain depth and breadth, caps) | `dispatchTask` runs the same checks, in the same order, with the same errors | CI, one test per check |
| BR-15 | The same `dispatchTask` call replays after a crash or a resume | One row, one start | CI · the FIX-1820 rerun |

## Waiting for the result

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | `dispatchTask({ …, wait: true })` | Today's ask, unchanged: one row per call, one wait per step, the turn parks, the row's output is the result, or an error naming how it ended (`wait_*`) | The FIX-1816 rerun · existing ask suite, renamed |
| BR-17 | `wait` on a recorded row (`taskId`) that is pending, unclaimed and not waited on | It is marked waited-on and dispatched in one write, then the turn parks as in BR-16 | CI |
| BR-18 | `wait` where the host or board can't hold one, or from a task turn | `wait` and `timeoutMs` aren't in the schema; a direct caller gets `wait_unavailable`, nothing written | CI |
| BR-19 | `timeoutMs` without `wait`, or outside 30 seconds to an hour | Refused, nothing written, never clamped | CI |
| BR-20 | The `dispatchTask_<board>` action | Never waits; it has no `wait` field | CI |

## The old surface

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | `addTask` gets `waitForResponse` or `timeoutMs` | Refused by name, the message points at `dispatchTask`, nothing filed | CI · goal `old:refused` |
| BR-22 | Code imports a retired name | It fails to compile. The changeset gives each new name | Typecheck · the sweep's `--assert` |
| BR-23 | The model reads `addTask`'s description | It says `addTask` records and doesn't start, and points at `dispatchTask` | CI on the description · the FIX-1816 rerun |

```mermaid
flowchart LR
  A["addTask · assignTask"] -->|"recorded, waiting"| R["the row"]
  D["dispatchTask"] -->|"ready"| R
  O["a row filed before this"] -->|"no mark · ready"| R
  R -->|"the board's one test · ready rows only"| S["start"]
```

Every path into a row ends at one test for "can start". A second test anywhere (a wake, a claim's
eligibility, the drain's exit) that doesn't read the mark starts a recorded row.

## Failure taxonomy

Every refusal is a soft `{ ok: false, error }` the model can act on, written before anything is
stored. A failed wake leaves a ready row ready, for the next touch, as today. Nothing retries
inside the tool. A wait that ends without an answer is today's `wait_*` set, unchanged.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): its check passes on the FIX-1817 lab
after `GOAL_CONTROL=add-starts` and today's `main` fail it; the three regression checks pass with
diffs the rename map explains; and the sweep's `--assert` exits 0.
