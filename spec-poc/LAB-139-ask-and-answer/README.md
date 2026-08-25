# spec-poc/LAB-139-ask-and-answer — does the round trip actually run today?

**POC code on a never-merged branch** (`spec/LAB-139`, issue LAB-139). Throwaway. Please
don't review it as code — review what it showed. It dies with the PR.

LAB-139's whole design rests on one measured claim in the epic-spec's theme 5 table:

> `awaitReview` + normal return → row stomped to `completed` in the same request — the
> question is lost

Everything downstream of that row was drawn to route around it. **FIX-1234 (park-exit) merged
into `main` on 2026-08-25** and taught both result recorders to read the row's status before
they settle. So that row may no longer be true — and nobody had run it on the shape LAB-139
actually inherits from LAB-138: a **detached** worker over a **user-scoped durable** ledger.

These two scripts run it. They were written to be informative rather than green: the printed
output is the finding, not an assertion of a hoped-for answer.

## Run it

```
pnpm tsx spec-poc/LAB-139-ask-and-answer/round-trip.mts    # ~5s
pnpm tsx spec-poc/LAB-139-ask-and-answer/inbox-write.mts   # instant
```

No server, no store, no keys, no model. `createInMemoryStores` + `runAction`, with the host's
`startOperation` **recording** each detached dispatch envelope and starting nothing — so a
child cannot finish early and every "the parent returned first" reading is structural rather
than a race. Each recorded envelope is then replayed through `source: "workstream"`, which is
what a real host would have done. Shape borrowed from
`packages/integration-tests/src/scenarios/task-board-detached-handoff.test.ts`.

The framework logs heavily on these paths; every measurement is printed on one line prefixed
`>>>`, so `| grep '>>>'` is the readable view.

## round-trip.mts — the board half

| | measured |
|---|---|
| launching drain | `terminationReason: "handed-off"`, row `in_progress`, 1 dispatch — LAB-138's shape, unchanged |
| **M1 the park** | worker called `awaitReview` on its own row and returned normally → row **`awaiting_review`**, `attempts: 1` |
| **M2 a drain over a held row** | `terminationReason: "parked-for-review"`, **0** new dispatches |
| **M6 feedback clearing** | `resumeFromReview(id)` with no feedback → previous feedback **absent**, row `pending` |
| **M3 the answer** | a coordinator request holding **no claim ticket** → `{outcome: "recorded"}`, row `pending` |
| **M4 the resumed run** | next drain dispatched again (2 total); the replayed child ran, saw the answer, row `completed` |
| **M5 the budget** | `attempts` 1 → 2 against `maxAttempts: 3`, no abandonments |
| **M7 control** | same board without `onReview: "exit"` → `terminationReason: "blocked-by-failures"` after 3.5s on a board with **no failures** |

**M1 is the headline: the park survived.** The epic's table row is stale on `main`, so
LAB-139 needs no workaround for it — a worker parks itself and walks away.

**M7 is the second finding and it is worse than "it hangs".** Without `onReview: "exit"` the
drain does not merely wait; it spends its iteration budget and then reports *failures* on a
board that has none. A caller reading that verdict is told something false.

**M5 is the cost nobody had priced.** `attempts` is incremented at claim time and
`shouldRetryOnFail` discounts only abandonments, so an answered resume spends a retry the
same way a failure does. That is spec decision 2.

## inbox-write.mts — the inbox half

| | measured |
|---|---|
| **N1 cross-session** | a `user`-scoped collection written from inside the workstream (`dsx_fd4e…`) was read back by the coordinator session (`s_conductor`), key `inbox/FIX-1166/implement/1/q1`, with **no `sharedToWorkstream` anywhere** |
| **N2 replay, open row** | the ask step run twice in one visit → **one row, identical state** |
| **N2 replay, answered row** | operator answered, then the ask step re-ran → still `answered`, answer intact |

`upsert(key, {}, createOnly)` is the mechanism: the patch branch has nothing to apply, so a
re-execution is a read. That is the whole of LAB-139's replay-safe write, and the case that
had to hold is the second one — a replay landing *after* a person answered must not reset the
row.

## What these do NOT show

- **Nothing about the coding agent.** No `claudeCodeAgent`, no model, no checkout. The worker
  here is a stub that parks on its first visit and finishes on its second.
- **Nothing about resuming the same coding session.** That is FIX-1246's, and it is the
  Proof's one hard blocker. The resumed attempt here is a cold start by construction.
- **Nothing about Relay.** FIX-1230 has nothing in tree; the announcement is not exercised.
- **In-process only**, in-memory stores, one board, one row.

## Graduating

Behaviours 1, 2, 3, 5, 6 and 12 of the spec's §10 are these measurements tidied into real CI
specs. Graduate them rather than rewriting them — M1 in particular is a premise that has
already moved once.
