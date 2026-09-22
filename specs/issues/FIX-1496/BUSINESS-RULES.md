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
| BR-3 | The acceptance condition the brief stated is executed in the produced tree | It passes, **and** the same condition run against the base ref does not. A condition that was already true is no evidence | Goal · both halves, or the leg is vacuous |
| BR-4 | A run produces an artifact that does not satisfy the condition | The row does not settle `completed`. The artifact existing is never sufficient | Goal · control `ignores-the-brief` |
| BR-5 | A run reports it stopped at its budget, having committed something | The row does not settle `completed`, exactly as today | Existing gate · control `stopped-at-limit` |

![Two lanes over the DevForce path showing which stages are unchanged and which four gaps close](figures/the-four-gaps.svg)

The right-hand end of the *after* lane is this group: the artifact stage and the grading beside
it. BR-1 to BR-3 are the three properties [D1](DECISIONS.md#d1) names, one rule each.

## The channel is driven, not decorated

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | An operator posts on the feature channel | The channel opens, the post lands in its transcript, and the EM seat is reached | Goal |
| BR-7 | The EM seat is reached by that post | It files exactly one row on the feature board, addressed to the `coder` assignee | Goal · one row, not one per member |
| BR-8 | The post reaches the other declared members | No board row is filed by any of them, and the reviewer seat is dispatched nothing | Goal · control `reviewer-files` |
| BR-9 | Nobody posts | No row is filed and no run happens. The board does not start itself | Goal · the negative half of BR-6 |
| BR-10 | The channel is opened without an org | Refused at the transport door, as today | Existing gate (BR-17 there), unchanged |

## The run, and what survives it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | The proof runs | It runs on stores that are on disk, and the row, the run record and the transcript are all readable from a fresh process over the same file | Goal · the store is closed and re-opened |
| BR-12 | The coder seat's run is dispatched | Its prompt carries every held-out token from the seat's own instructions, brief and skills — unchanged from today | Existing gate, and re-asserted here |
| BR-13 | The harness is unavailable or unauthenticated | The proof **fails loudly**. It never degrades to a scripted stub | Goal · no stub fallback, deliberately |
| BR-14 | The pull-request leg is not configured | The proof runs its default leg and says so in its own output. It does not silently report the credentialed claim | Goal · the two legs are named in the verdict, never conflated |
| BR-15 | The same proof is re-run a year later | The default leg needs `git`, a temporary directory and a signed-in harness. It needs no `gh`, no token and no network | Read of the check's own stated requirements |

## What the proof must not quietly become

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The change is reviewed against the epic's fences | No L1 type, no `TaskStatus` value, no second work plane, no new substrate, nothing under `packages/` | Diff gate: every changed path is inside `goals/devforce-lab/` or `specs/issues/FIX-1496/` |
| BR-17 | The existing two checks are re-run after the change | Both still pass with their existing claims intact, and their verdict logs are appended to, never rewritten | CI · both siblings run |

## Failure taxonomy

**Fatal, and loud:** an unavailable harness (BR-13), a tree that does not load, a base ref the
scratch repository lacks — all refused before an attempt is charged. **Non-fatal and retried:** a
run that finishes and leaves nothing re-pends the row with its reason and errors once the budget
is spent, exactly as the existing gate proves. **Never silent:** an unconfigured pull-request leg
(BR-14) degrades the *claim*, not the run, and the verdict says which leg it ran.

## Acceptance criteria this issue owns

One command runs the proof end to end on a machine with a signed-in harness, and the
`goals/devforce-lab/` verdict log gains a dated `PASS` row naming the artifact's address, the
branch, and which leg ran. The three properties in [D1](DECISIONS.md#d1) hold, each with the
control that makes it go red. **A passing check whose controls were never run does not close this
issue** — the red states are part of the deliverable, not a nicety.
