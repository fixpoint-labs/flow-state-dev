# FIX-1426 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases, as rules. A human reviews this page for a case that would invalidate the design; the
plan turns each row into a check. *Proved by* names the check that runs it — `gate` is the
model-free contract check, `honesty` is the model-backed sibling, `both` is graded in each.

## The tree produces the roster

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | One root is pointed at once | Exactly three seats are hired — the complete id set, not its first element — on the two lab kinds their files name | gate |
| BR-2 | A `WORKER.md` names a kind that is not registered | The whole hire naming that worker is refused, with nothing hired. Its corrected twin hires cleanly | gate |
| BR-3 | Each seat is read through its own config inside a running block | It reports its own instructions, its own document ref and its exact expected skill union — set equality, never presence | gate |
| BR-4 | The `em` seat is inspected | Its config carries no harness and its kind declares no harness slot. Not "it did not run one" — it cannot | gate |

## A filed row reaches one seat

| # | When | Then | Proved by |
|---|---|---|---|
| BR-5 | The `em` seat files one row on the feature board | One row exists, addressed to the board's `coder` assignee key | gate |
| BR-6 | The board drains | The row is claimed and handed off to the `coder` seat's own flow instance, and the child session is attributed to that instance — not to the board's flow | gate |
| BR-7 | The hand-off names an instance id no seat minted | The row errors `flow-not-found` naming the id, and no checkout is provisioned | gate |
| BR-8 | The `reviewer` seat is declared on the same tree | It is never dispatched to. Graded on the **dispatch record**, not on its absence from the result | gate |
| BR-9 | The same row is drained twice | The second drain claims nothing. One row, one run | gate |

## The run is the seat's, and supervised

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The manager builds the prompt | It carries the held-out token from the `coder` seat's own `WORKER.md`, from its document, and from its skills — each token living in exactly one file and in none of the lab's code | both |
| BR-11 | The run is given a working directory | It is the checkout derived from the row's own identity, not the directory the host sits in, and it is injective over its components | gate |
| BR-12 | A run reports a bad outcome inside a normal finish (budget or spend exhausted) | The row does **not** settle done. A normal finish is not success | gate |
| BR-13 | A run succeeds and the phase's done-condition holds | The row settles done | both |
| BR-14 | A run succeeds and the done-condition does not hold | The row goes back to pending with the reason attached, or to errored once the retry budget is spent | gate |
| BR-15 | The honesty check runs with a real coding harness on a scratch repository | The branch carries a commit the base ref does not have, and the prompt that produced it carried BR-10's tokens | honesty |

## What the tree may not silently do

| # | When | Then | Proved by |
|---|---|---|---|
| BR-16 | The tree declares a folder no loader walks (a `boards/` directory, say) | It loads as nothing, silently. The lab must therefore **never** declare a board as a file, and the check asserts the board came from code | gate |
| BR-17 | A seat reads a document with no org on the request | Refused at the door, while the same read with an org lands | gate |

![A dashed fence between what the file tree declares and what app code declares. Seats, skills, documents and channels cross from the tree; the board and the two kind modules sit on the code side and never cross. One path, the hand-off, crosses the fence in the other direction to reach a seat](figures/what-declares-what.svg)

Left of the fence is what an author writes as Markdown; right of it is what the app writes as code.
BR-16 is the rule that keeps the board on the right: a `boards/` folder would be accepted by the
tree and read by nobody.

## Failure taxonomy

An unregistered kind and an unknown tool key are **fatal at the hire** and refuse the whole roster,
by name — a partially hired roster is the state this lab exists to refuse. A hand-off to a missing
instance is fatal **to the row**, not to the board. Everything the run itself reports — a bad
verdict, a failed done-condition — is an ordinary failed attempt that retries against the budget.
Nothing degrades silently: the one silent path in the system, an unwalked tree folder, is BR-16 and
is asserted rather than tolerated.

## Acceptance criteria this issue owns

Somebody writes a small tree of Markdown and points one call at it. A row filed by one seat wakes a
different seat, in its own flow instance, into a coding run whose prompt carries tokens that exist
only in that seat's own files — and a third declared seat is never dispatched to. Re-run a year
from now against the verdict log, and every control still goes red.
