# FIX-1790 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. "Her cell in Acme" is the cell for Alice and the Acme org. "User
data" is user state and every user-scoped resource, shared or flow-isolated, state and content.
The *proved by* column names the check in [PLAN.md](PLAN.md#checks).

## Where a user's data lives

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice, in Acme, saves user data on any flow | It lands in her cell in Acme, with the flow added for a flow-isolated resource. Her next Acme run, on that flow, reads it back | Goal leg a · V2 |
| BR-2 | Alice opens the same flow in Globex | Her cell in Globex starts empty. Nothing she saved in Acme is read, through a run or any view | Goal leg b · V2 |
| BR-3 | Bob, in Acme, opens the same flow | His own cell in Acme. Nothing of Alice's is read | Goal leg b · V2 |
| BR-4 | Two flows in Acme declare the same shared user resource or user state | Both read and write Alice's one cell in Acme. Shared still means shared, inside one org. The registry still compares their schemas at startup | V2 · existing registry suite |
| BR-5 | Alice uses a hired worker in Acme | Its shared cell is her cell in Acme, the key it already had, now shared with the app's other flows in Acme. Its flow-isolated data keys by her, Acme and the worker | V1 key table · V2 |
| BR-6 | Any org-scoped or session-scoped data, with or without a tenant | Unchanged, byte for byte | V1 key table · existing suites |
| BR-7 | A user id, org id or flow id contains `:`, `\` or the text `~org` | No two (user, org, flow) tuples share a key, and no new key equals a key an older release wrote | V1 collision table · `poc/key-shape/` |

## Where the org comes from

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | A run keys user data | The org is the admitted run's. For a pinned worker it equals the pin's org, which admission already checked. A header or body never chooses it | V2 |
| BR-9 | A run, a view or a helper call has no org, or a blank one | Refused, as FIX-1442 refuses it. No user data is read or written, and the cross-org cell is never the answer | V1 · V3 |
| BR-10 | Any read-side view of a session (state route, resource routes, debug snapshot, a sibling transport) | It resolves the cell the run wrote, from the session's stored org | V3, one per view family |
| BR-11 | A run dispatches a child session on another flow | The child keeps the user and the org, and reads that flow's buckets in the same cell | V2 |
| BR-12 | A dynamic schedule fires | The dispatch names the org; the resolver reads that cell and dispatches only a row naming the same org. No org in the dispatch, or a row naming another, resolves as missing, as does a user-owned worker's id naming another user | V5 |
| BR-13 | A test seeds user data through the testing harness | It lands in the cell the run will read: the harness's org, or the default org when none is given | V6 |
| BR-14 | A flow declares a user-scoped projected resource | Its hooks receive the user and the org. The app keys its own rows by both; the framework can't, and the docs say so | DOCS review |

## Data saved before the upgrade

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | A user has user data saved by an older release, and the step has not run | No flow and no view reads it, in any org. Each of their cells starts empty. The old cell is untouched. Nothing refuses | Goal leg c · V4 |
| BR-16 | The operator runs the step on a cell whose possible writers' sessions all name one org: all the user's sessions for a shared cell or user record, their sessions on that flow for a flow-isolated cell. The operator also vouches that none of those sessions was deleted, or that their own records never placed the user in another org | The cell is copied into that org: state and content together, versions and deletion markers kept, a user record's id rewritten. The original stays | Goal leg c · V7 |
| BR-17 | Those sessions name two or more orgs, or none, or some may have been deleted and the operator's records can't clear every other org. A session with no flow owner on a collection flow counts as unknown until the owner attribution has run | The step stops for that cell with `migration-required`, names it in the upgrade record, and copies nothing | Goal leg c · V7 |
| BR-18 | The destination already holds a row, a record or a deletion marker for the user | The step stops for that user and names the keys. Nothing is overwritten or merged | V7 |
| BR-19 | A copied cell held a dynamic schedule | After its index row is rebuilt from the new cell and the old cell's row removed, it fires once per beat. Before the step it does not fire | V5 · V7 |
| BR-20 | A deployment's sessions only ever named one org, such as a development app on the default org | Every cell is attributable to it and copied | V7 |

## Failure taxonomy

Nothing here is a new runtime error. A run or a view that finds a cell empty behaves as a first
run. A missing org is refused exactly as today. The only new stop is the operator step's, per
cell or per user, named `migration-required` like the other upgrade procedures, and it leaves
the store as it found it for that cell.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met) passes on the real router and a SQLite
store, and fails under each named control. The epic's closure step "Alice in a second org sees
nothing stored before FIX-1790" then holds on what this ships
([ER-30](../../epics/FIX-1786/BUSINESS-RULES.md#the-closure)).
