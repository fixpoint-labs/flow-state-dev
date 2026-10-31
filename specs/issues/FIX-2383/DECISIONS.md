# FIX-2383 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic settled the what: a retry verb in orchestration that keeps the id, history and spend,
extending the `task-caps.ts` ledger with no second counter (FIX-2369 reuse table). What's left is
how a terminal row reopens, who may ask, and what the attempt budget says.

<a name="d1"></a>
## D1 · A verb of its own, outside the status table

| | `retry(id)`, its own guarded write (chosen) | Add `errored → pending`, `cancelled → pending` to `ALLOWED_TRANSITIONS` | `updateTask({ status: "pending" })` from a finished row |
|---|---|---|---|
| Every other writer still sees terminal as terminal | yes | no: `fail`, the claim gate and a release all read the table | yes, if the tool special-cases it |
| One place decides a reopen | the verb | every writer that can reach `pending` | the tool, and the collection must trust it |
| What `status: "pending"` means on `updateTask` | unchanged (a release) | unchanged | two things |

- **Because:** "a finished task changes no more" is what every cascade, notice and wait is built
  on. Reopening is safe only in a write that knows it is a reopen: it clears `error`, records the
  grant, refuses an owed cascade, and emits no ending. A table row can't carry those.
- **Locks in:** `retry` is the only way back from `errored` or `cancelled`. `completed` has none.

<a name="d2"></a>
## D2 · A person's or an app's move, not a model's

| | Action only (chosen) | Model tool too |
|---|---|---|
| Retry loops | a person presses it | a model can loop on a failing task |
| Bound on a durable board | none needed: a person is the bound | none: resource-backed boards count retries but can't cap them (`task-caps.ts`) |
| The model's way to try again | file a follow-up, as today | either |

- **Because:** the three apps asking for it are Retry buttons. A model already has follow-ups,
  and giving it a reopen on a board with no enforced budget is the runaway FIX-948 exists for.
- **Locks in:** `retryTask_<suffix>` comes from the `claimless` build only. A model retry is a
  later issue, after a resource-backed cap.

<a name="d3"></a>
## D3 · One more attempt, whatever was left

| | Always one more (chosen) | Only under `maxAttempts` | Reset the attempt count |
|---|---|---|---|
| A single-attempt task (no `maxAttempts`, most of them) | retries | refused, always | retries |
| Attempt history | kept: attempts keep counting up | kept | lost |
| Notice keys `(id, attempt, ending)` | new attempt, new key | same | reused: a second failure looks like the first |

- **Because:** "under the existing budget" in the issue would make Retry refuse the tasks it's
  for. The grant goes into `retryLedger.granted`, so the board's report shows it and a
  state-backed `maxTotalRetries` caps it.
- **What would change my mind:** wanting Retry to mean "the whole budget again". That's raising
  `maxAttempts`, which a later edit can offer; this keeps one press, one try.

## Decided, not asked

- **E1 · `error` moves to `feedback`**, as `fail()`'s soft retry does, so the next attempt reads
  why the last one stopped. A cancel's reason is not feedback: a cancelled row's `feedback` is left
  as it was.
- **E2 · The change kind is `retry_requested`**, not `retried`: `retried` is an ending (a soft
  failure that owes its filed tasks' cascade), and consumers already read it that way.
- **E3 · Refused, nothing written:** `completed` (`task_finished`, file a follow-up); an open row
  (`not_finished`); a dependency `errored` or `cancelled` (`dependency_ended`, retry it first); an
  owed cascade (`settling`, try again); a spent state-backed budget (`retry_budget_spent`).
- **E4 · Dependents stay skipped.** Each is retried on its own once its dependency is back; a
  "retry with dependents" is not in this issue.
- **E5 · The board starts the row** the way a release does: Workforce's conversation board owes
  and triggers its pass after the write (`owePass`, `triggerPass`). A row back at `pending` alone
  schedules nothing.

## How it got here

- Drafted 2026-10-31 from the epic's reuse table, with the build prototyped beside it.

## Notes from review

- Codex (1759128): no findings. Cursor (1759128): approved; folded its two clarity notes (the
  action is a fifth tool, not a field like `done`; the start goes through the board's pass). Its
  prose dedupes (refusal list, terminal-stays-terminal) left as is: the SPEC lists the refusals
  as its checks, DECISIONS gives the codes.
