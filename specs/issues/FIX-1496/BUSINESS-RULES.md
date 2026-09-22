# FIX-1496 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. A human reviews this page; the plan turns it into
work.

## What counts as a real artifact

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The run finishes and the goal's process exits | The artifact resolves at its address with nothing of the run still alive — no held checkout, no live store | Goal, on the real path |
| BR-2 | The artifact is inspected for the lab's fingerprints | No graded token of its content appears in the lab's own code, its fixtures, or the prompt the seat was handed | Goal · the held-out discipline, inverted onto the product |
| BR-3 | The acceptance check the brief named is executed against the produced tree | It **imports the named export from the named path and asserts the named behaviours**, and passes — **and** the same check against the base ref fails. A condition already true before the run is no evidence | Goal · both halves, or the leg is vacuous |
| BR-3a | A run adds a passing test of its own, or a vacuous test beside a broken `greet` | Neither satisfies BR-3. The acceptance check is the requester's, is run from outside the checkout, and the run cannot edit or substitute for it | Goal · controls `unrelated-passing-test` and `vacuous-test` |
| BR-4 | A run produces an artifact that does not satisfy the acceptance check | The row does not settle `completed`. The artifact existing is never sufficient | Goal · control `ignores-the-brief` |
| BR-5 | A run reports it stopped at its budget, having committed something | The row does not settle `completed`, exactly as today | Existing gate · control `stopped-at-limit` |

This group is the right-hand end of the *after* lane in
[the four-gaps figure](SPEC.md#what-changes) — the artifact stage and the grading beside it.
BR-1 to BR-3 are the three properties [D1](DECISIONS.md#d1) names, one rule each. The figure
lives in `SPEC.md` and is not redrawn here.

## The channel is driven, not decorated

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | An operator posts on the feature channel | The channel opens, the post lands in its transcript, and the EM seat is reached | Goal |
| BR-7 | The EM seat is reached by that post | It files exactly one row on the feature board, addressed to the `coder` assignee | Goal · one row, not one per member |
| BR-8 | The post reaches the other declared members | No board row is filed by any of them, and **no board or harness work dispatch reaches the reviewer seat**. A channel *notification* delivery to a declared member is expected and is not what this forbids — the two are different dispatch kinds and only the work one is fenced | Goal · control `reviewer-files`, graded on the **board** dispatch record by `flowId` |
| BR-9 | Nobody posts | No row is filed and no run happens. The board does not start itself | Goal · the negative half of BR-6 |
| BR-10 | The channel is opened without an org | Refused at the transport door, as today | Existing gate (BR-17 there), unchanged |

## The run, and what survives it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | The proof runs | It runs on stores that are on disk, and the row, the run record and the transcript are all readable from a fresh process over the same file | Goal · the store is closed and re-opened |
| BR-12 | The coder seat's run is dispatched | Its prompt carries every held-out token from the seat's own instructions, brief and skills — unchanged from today | Existing gate, and re-asserted here |
| BR-13 | The harness is unavailable or unauthenticated | The proof **fails loudly**. It never degrades to a scripted stub | Goal · no stub fallback, deliberately |
| BR-14 | The proof runs | It names which leg it ran. **CI runs only the temp-repository leg**; the credentialed pull-request leg is the **human release run** and is never inferred from whether `gh` happens to be installed | Goal · the verdict names the leg, and the two claims are never conflated |
| BR-15 | The same proof is re-run a year later | The automated leg needs `git`, a temporary directory and a signed-in harness. It needs no `gh`, no token and no network | Read of the check's own stated requirements |

## What the proof must not quietly become

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The change is reviewed against the epic's fences | No L1 type, no `TaskStatus` value, no second work plane, no new substrate, nothing under `packages/` | Diff gate: every changed path is inside `goals/devforce-lab/` or `specs/issues/FIX-1496/` |
| BR-17 | The existing two checks are looked at after the change | The model-free gate still passes with its claim intact. The model-backed sibling still type-checks and keeps its claim; **running it is [FIX-1501](https://linear.app/fixpoint-labs/issue/FIX-1501), not this issue**. Neither verdict log is rewritten | CI for the gate · type-check for the sibling |

## Failure taxonomy

**Fatal, and loud:** an unavailable harness (BR-13), a tree that does not load, a base ref the
scratch repository lacks — all refused before an attempt is charged. **Non-fatal and retried:** a
run that finishes and leaves nothing re-pends the row with its reason and errors once the budget
is spent, exactly as the existing gate proves. **Never silent:** running the automated leg rather
than the credentialed one (BR-14) degrades the *claim*, not the run, and the verdict says which
leg it ran.

## Acceptance criteria this issue owns

One command runs the proof end to end on a machine with a signed-in harness, and the
`goals/devforce-lab/` verdict log gains a dated `PASS` row naming the artifact's address, the
branch, and which leg ran. The three properties in [D1](DECISIONS.md#d1) hold, each with the
control that makes it go red. **A passing check whose controls were never run does not close this
issue** — the red states are part of the deliverable, not a nicety.
