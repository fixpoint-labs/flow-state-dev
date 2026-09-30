# FIX-1666 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

What the ask does, from raising to answer, and what must not move. *Proved by* names the goal
check's leg ([PLAN.md → Checks](PLAN.md#checks)) or CI.

## Raising the ask

| # | When | Then | Proved by |
|---|---|---|---|
| AR-1 | A host opens the lab without the ask | Nothing new runs: no durable execution, no request, no suspension. The lab behaves as it does today | The three existing checks, unchanged · leg 0 |
| AR-2 | A host opens the lab with the ask, naming a feature (issue slug and one-line goal) | Before open returns, the EM seat has one request in its own session, suspended on an approval whose message names that feature | Leg 1 |
| AR-3 | The ask is pending | The session listing, read through the lab's door as the lab's person with dispatch runs included as Inbox reads it, returns the EM seat's own session; that session holds exactly one pending approval, allowing approve and reject. The EM seat is a declared member of the feature channel, the link the workstream's Stream draws the same card by (FIX-1662) | Leg 1 |
| AR-4 | The ask is pending | The board holds no row for that feature, and the coder seat has not been dispatched or reached | Leg 1 |
| AR-5 | The lab is opened again over the same store with the same feature | No second ask. If the first is pending it stays the one; if it was approved, the row it filed stands; if it was denied, the Deny stands and nothing is filed. In every case nothing is asked | Leg 4 |
| AR-6 | Raising the ask fails (the store refuses, the kind is missing) | Open fails, naming the step; so does a host that calls the step directly. A lab that opened with the ask requested and no ask behind it is the failure the closure could not tell from an empty Inbox | CI |
| AR-7 | The ask is raised | No model is called and no key is read on the path | Leg 1, run keyless |

## Answering it

| # | When | Then | Proved by |
|---|---|---|---|
| AR-8 | A person approves through the session's resume route | The route accepts at once; the same request continues: exactly one row is filed for that feature, through the same row code the other two doors use, and the board runs so the row is handed to the coder seat by its instance id. Approve does not wait for the coder's run | Leg 2 |
| AR-9 | Approved, with the scripted stub | The coder's run is reached once and the row settles as it does in the first check | Leg 2 |
| AR-10 | A person denies through the same route | The request completes on the reject branch: no row, no dispatch, and the EM's output says nothing was filed and why | Leg 3 |
| AR-11 | The ask is answered | It is no longer pending in the session, so anything reading pending approvals (Inbox) drops it | Legs 2 and 3 |
| AR-12 | A row for that feature already exists when Approve lands (filed by another door) | The row code's own idempotency holds: no second row, and the EM's output says it existed | CI |
| AR-13 | A resume names an action the ask does not allow, or arrives without the verified bearer | Refused by the engine before anything runs; still pending | Leg 2's negative half |

## What must not move

| # | When | Then | Proved by |
|---|---|---|---|
| AR-14 | Any check opens the lab | The EM kind still declares no task entry and its file does not name the coding harness | The first check's own leg, unchanged |
| AR-15 | The change lands | Nothing under `packages/`, `labs/` or `apps/` changes; the three existing checks and their `goal.md` files are untouched and green | The PR's file list · part of leg 0 |
| AR-16 | The `no-gate` control runs | The check fails on "a row existed before any approval" | Leg 5 |

## Acceptance

This issue is done when AR-1 to AR-16 hold on one commit, the new check's verdict log records a
PASS with its control's FAIL, and the three existing checks pass on the same commit.
