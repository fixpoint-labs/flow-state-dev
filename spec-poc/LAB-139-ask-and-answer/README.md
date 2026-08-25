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
pnpm tsx spec-poc/LAB-139-ask-and-answer/round-trip.mts    # ~10s
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

## ⚠ The answer path here is NOT the product seam

**Read this before graduating anything.** To keep the board round trip cheap to demonstrate,
M3–M9 deliver the answer through `resumeFromReview`'s **feedback** argument (`"ANSWER: …"`) and
the stub manager reads it off `input.feedback`. **The spec forbids exactly that** — `feedback`
is LAB-138's failure-reason carrier, and mixing the two is what §6 decision 1 exists to
prevent.

Production is: **patch the inbox row → the manager folds answered rows into the prompt →
`resumeFromReview` with NO feedback.** These scripts prove the *substrate* moves the row and
re-dispatches it. They prove nothing about how the answer reaches the prompt.

Consequently the spec's behaviours **7, 8 and 9 have no coverage here at all** — the prompt
fold, the two-channel separation, and the three decide arms are green-field.

## round-trip.mts — the board half

| | measured |
|---|---|
| launching drain | `terminationReason: "handed-off"`, row `in_progress`, 1 dispatch — LAB-138's shape, unchanged |
| **M1 the park** | worker called `awaitReview` on its own row and returned normally → row **`awaiting_review`**, `attempts: 1` |
| **M2 a drain over a held row** | `terminationReason: "parked-for-review"`, **0** new dispatches |
| **M6 feedback clearing** | `resumeFromReview(id)` with no feedback → previous feedback **absent**, row `pending` |
| **M3 the answer** | a coordinator request holding **no claim ticket** → `{outcome: "recorded"}`, row `pending` |
| **M4 the resumed run** | next drain dispatched again (2 total); the replayed child ran and the row reached `completed` |
| **M5 the budget** | `attempts` 1 → 2 against `maxAttempts: 3`, no abandonments |
| **M7 control** | same board without `onReview: "exit"` → `terminationReason: "blocked-by-failures"` after 3.5s on a board with **no failures** |
| **M8 a cancelled task** | a bare `resumeFromReview` **threw** — *"illegal status transition for task 'issue-1': cancelled → pending"*. It did not decline: the terminal guard is only consulted when `ifAllowed` is passed |
| **M10 the same cancelled task, `ifAllowed: true`** | **`{outcome: "declined", reason: "terminal"}`** — no throw, row untouched. The guard the substrate already ships turns M8's throw into an ordinary decline |
| **M9 a second answer** | over an already re-queued (`pending`) row → **`{outcome: "recorded"}`**, and the row's feedback was **overwritten**. `pending → pending` is legal, so the board does not fence a duplicate answer |

**M1 is the headline: the park survived.** The epic's table row is stale on `main`, so
LAB-139 needs no workaround for it — a worker parks itself and walks away.

**M7 is the second finding and it is worse than "it hangs".** Without `onReview: "exit"` the
drain does not merely wait; it spends its iteration budget and then reports *failures* on a
board that has none. A caller reading that verdict is told something false.

**M5 is the cost nobody had priced.** `attempts` is incremented at claim time and
`shouldRetryOnFail` discounts only abandonments, so an answered resume spends a retry the
same way a failure does. That is spec decision 2.

**M8, M9 and M10 are the decline arms, and they are with the product owner — but they are
NOT the same finding, and reporting them as one would mislead the decision.**

- **M8 + M10: one has a shipped answer.** Called bare, the verb throws on a cancelled row.
  Called with `ifAllowed: true` — an argument the substrate already ships — the same row
  declines `terminal`. The terminal arm is simply gated on that flag
  (`tasks/collection/internal.ts:464`), so this arm is a one-argument fix, not a missing
  capability.
- **M9: no shipped option closes it.** `resumeFromReview` passes no `requireFrom`, and
  `pending → pending` is a legal transition, so neither the `requireFrom` arm (`:466-472`)
  nor the general legality arm (`:473`) ever fires. `ifAllowed` buys nothing here. A duplicate
  answer is recorded and overwrites the feedback, and nothing shipped prevents it — this is
  the arm that genuinely needs the parked-only primitive FIX-1244 owns.

Park-exit made `resumeFromReview` work *after the launching request ended*, which is what the
cross-request claim rests on and is unaffected by any of this. It did not make the verb
*parked-only* or *atomic*; those are different properties, and only one of the two gaps has a
shipped answer today.

**Nothing here was adopted into the design.** The spec's §9 rows and §7's wake composition are
unchanged; `ifAllowed` appears in this script as a measurement knob and nowhere else.

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

*(This script's collection definition omits `llmWritable: false`, which the spec requires. A
POC-only shortcut, not a proposal.)*

## What these do NOT show

- **Nothing about the coding agent.** No `claudeCodeAgent`, no model, no checkout — so nothing
  about the per-attempt question marker either, which is where §10 behaviour 10 lives.
- **Nothing about resuming the same coding session.** That is FIX-1246's, and it is the
  Proof's one hard blocker. The resumed attempt here is a cold start by construction.
- **Nothing about Relay.** FIX-1230 has nothing in tree; the announcement is not exercised.
- **Nothing about how the answer reaches the prompt** — see the warning above.
- **In-process only**, in-memory stores, one board, one row.

## Graduating

Behaviours 1, 2, 3, 6 and 13 of the spec's §10 are these *substrate* measurements tidied up —
graduate them into **one integration scenario plus conductor unit tests**, not two permanent
`pnpm tsx` scripts. M1 in particular is a premise that has already moved once, so it is worth
keeping as a real check.

**Do not graduate the answer path.** It is the one part of these scripts the spec forbids.
