# FIX-1538 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "A seat" is a hired seat: an instance registered with a pin from its
hire row. "Its cell" is the cell for the seat's org and the admitted person. The *proved by*
column names the check in [PLAN.md](PLAN.md#checks).

## Where a seat's data lives

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice's Acme seat saves to a shared user-scoped resource, or to its user state | It lands in (acme, alice). Her next Acme run reads it back | Goal legs (a), (h) · CI |
| BR-2 | Alice opens her Globex seat of the same kind | It reads (globex, alice) and starts empty. Acme's marker is absent | Goal leg (i), the org half |
| BR-3 | Bob opens his own Acme seat of the same kind | It reads (acme, bob) and starts empty. Alice's marker is absent | Goal leg (j), the person half |
| BR-4 | Alice uses two different seats in Acme that declare the same shared resource | Both read and write (acme, alice). Shared still means shared, inside one org | CI |
| BR-5 | Bob uses an org-visible Acme seat | His data lands in (acme, bob), never in Alice's cell or in his own app-wide cell | CI |
| BR-6 | A seat declares a user resource isolated to the flow | Unchanged: it keys by the seat's address, which already carries org and person | CI, byte-for-byte key |
| BR-7 | A seat declares an org-scoped resource | Unchanged: it is the org's, shared with every member | Existing suite |
| BR-8 | An app flow with no pin, or a seat declared in a `WORKER.md` file, saves user data | Unchanged: the person's cross-org cell, the key it had before | CI, byte-for-byte key |

## The fence around the cell

| # | When | Then | Proved by |
|---|---|---|---|
| BR-9 | A run on a seat is refused because the caller is outside its pin | Nothing is written into any cell: no record, no empty state | CI |
| BR-10 | Every read-side view of a seat session (state route, resource routes, debug snapshot, a sibling transport) | Resolves the same cell the run wrote. No view reads the person's cross-org cell for a seat | CI, one per view family |
| BR-11 | An org id or a person id contains `:` or `\` | The cell key stays unambiguous. No (org, person) pair can name another pair's cell, a cross-org cell, or a flow-isolated cell | CI, collision table |
| BR-12 | A seat calls another flow that has no pin | That flow keeps its own cell. The seat does not lend it its org | CI |

## Upgrading a deployment that already has seats

| # | When | Then | Proved by |
|---|---|---|---|
| BR-13 | A seat wrote shared user data before this release | After upgrade, the seat does not read it. It is still in the person's cross-org cell, untouched | CI |
| BR-14 | The operator runs the documented step for a person whose seats ran in one org | The seat's declared keys are copied into that org's cell, versions and deletion markers kept. The originals stay | Docs procedure, walked once on SQLite |
| BR-15 | The person's seats ran in two or more orgs | The step names the person and copies nothing | Docs procedure |
| BR-16 | A key the seat declares is also declared by an app flow | Copied, never moved. The app flow still reads its original | Docs procedure |

## Failure taxonomy

Nothing here is a new error. A seat that finds its cell empty behaves as a first run. A refused
caller is refused exactly as today (`404 Unknown flow` at the doors, the pin error at admission)
and writes nothing. The operator step stops, rather than guessing, on any person it cannot
attribute to one org.

## Acceptance criteria this issue owns

The epic's proof ([ER-15](../../epics/FIX-1528/BUSINESS-RULES.md#the-proof)), on the real HTTP
router and worker pool: Alice's Acme private seat, having saved a marker, is not listed, opened,
run, resumed, drained onto or shown in the debug listing for Alice signed into Globex or for Bob
in Acme; her Globex seat and Bob's Acme seat of the same kind start without the marker; her own
Acme run still reads it. And the durable-hire docs say a seat and its data stay with the org and
person that hired it ([ER-16](../../epics/FIX-1528/BUSINESS-RULES.md#the-proof)).
