# FIX-1546 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. Each says what a person or the system does and what happens. The
*proved by* column is the check the plan runs. "Cell" is where a schedule is stored: the person's
app-wide cell for an ordinary flow, or one (org, person) cell per hired seat.

## One schedule, one row

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A run creates an enabled schedule | One index row, identified by the schedule's cell and name, carrying the person, the organization, the cron and the next fire time | CI, every backend (conformance) |
| BR-2 | Alice's Acme seat and Globex seat each create `weekly` | Two rows. Each carries its own organization. Neither write changes the other | CI · collection → real SQLite index |
| BR-3 | An app-wide flow and an Acme seat each create `weekly` for Alice, both in Acme | Two rows, one per cell | CI |
| BR-4 | The same cell writes `weekly` again | The one row is updated in place; no second row | CI, conformance |
| BR-5 | Two users' schedules share a name | Two rows, as today | CI, conformance |

## Turning a schedule off, and deleting it

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | The Acme seat disables or deletes `weekly` | The Acme row goes. The Globex row and the app-wide row stay, and still come due | CI · collection → real SQLite index |
| BR-7 | A schedule's cron stops parsing | Its own row is removed, as today; no other cell's row is touched | CI |
| BR-8 | A write names a different organization than its run (BR-19 of FIX-1442) | That cell's row is removed and not re-indexed, as today; no other cell's row is touched | CI |
| BR-9 | `remove` names a cell and name with no row | No-op | CI, conformance |

## What the tick sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | `claimDue` returns due rows | Each carries its cell, person and organization; advancing one row never advances another cell's | CI, conformance |
| BR-11 | The tick dispatches a due row | Same address and body as today (person + name). The tick is unchanged | Existing `vercel` suite, unchanged |

## Upgrading

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A database holds rows written before this change | Schema init fills each row's cell with the person's app-wide cell and keys the table on cell + name. Idempotent; a second init changes nothing | CI · SQLite and Postgres, seeded with an old-shape table |
| BR-13 | An old row's person id contains `:` or `\` | Its cell is the escaped form the engine derives for that person, so the next write from that cell updates the same row | CI |
| BR-14 | An adopted old row is next written by its app-wide flow | Updated in place; no duplicate | CI |
| BR-15 | A BullMQ deployment upgrades | Ordinary ids keep their scheduler ids; no re-registration | CI |
| BR-16 | A custom backend still implements `remove(userId, key)` | Type error at build. The docs and the conformance suite show the new shape | Typecheck of a fixture |

## Failure taxonomy

Nothing here is new at runtime: index writes fail exactly as they do today, surfacing as the
collection write's error. The migration is the one new failure point. It runs inside schema init's
existing lock or transaction and either completes or leaves the old table untouched.

## Acceptance criteria this issue owns

Through the real collection and a real index, Alice's Acme and Globex seats each create `weekly`;
disabling it in Acme leaves Globex's row due, with Globex's organization. Today the same script
leaves nothing due.
