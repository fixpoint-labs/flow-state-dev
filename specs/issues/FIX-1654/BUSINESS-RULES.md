# FIX-1654 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. "Cancel" is `POST …/requests/:id/abort`; "the fence" is the check that its
write lands on the record its owner check read. "Incarnation" is FIX-1286's token, resolved
for a legacy record as `legacy_<createdAt>`. The *proved by* column is the check the plan runs.

## The record changed between the check and the write

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Another tenant's or user's request takes the freed id, in the same millisecond | 404, nothing written; the other request runs on | Route case · conformance, equal `createdAt` |
| BR-2 | The same, in a later millisecond | As BR-1, as today | Existing route case (FIX-1021), kept |
| BR-3 | The caller's own retry hands the record off, rewriting `createdAt` | 202, the intent is on the caller's running request | Route case through `claimRequestRecord` · conformance, rewritten `createdAt` |
| BR-4 | Nothing changed | 202 or 204, as today | Existing route cases |
| BR-5 | The request finished in between | 409 with its terminal status, as today | Existing route and conformance cases |

## Records from before incarnations

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | A legacy record, untouched, is cancelled | Fenced on `legacy_<createdAt>`; applies | Conformance, every store |
| BR-7 | A legacy record was handed off, so it now stores `legacy_<old createdAt>` beside a new `createdAt` | Fenced on the stored value; applies | Conformance, every store |
| BR-8 | A legacy record's id is taken by a new, stamped request | `inc_…` never equals `legacy_…`; 404 | Conformance, every store |
| BR-9 | A stored incarnation is `null` rather than absent | Treated as absent, as `resolveRequestIncarnation` does | Conformance, one case |

## Callers and stores

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | A caller passes no fence | Status predicate only, as today | Existing conformance cases |
| BR-11 | An out-of-tree store still compares `createdAt` | Its build fails on the parameter's type; untyped, every fenced cancel misses and the conformance suite's fence case fails | Changeset note · conformance |

## Failure taxonomy

Nothing new throws or refuses. A fenced miss is reported as an absent record, and the route's
404 is the one it gives today. BR-3 turns a wrong 404 into a right 202.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): BR-1 and BR-3 through the route on the
memory store, and BR-1, BR-3 and BR-6 to BR-9 in the conformance suite on all four first-party
stores; the route cases failed on `main` `70f777def` before this change, and the PR names it.
