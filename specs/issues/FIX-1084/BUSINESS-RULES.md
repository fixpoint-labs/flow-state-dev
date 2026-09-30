# FIX-1084 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

Where a session-scoped key stores, on both paths, and what must not move. *Proved by* names a
check in [PLAN.md → Checks](PLAN.md#checks).

## Addresses

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Any declaration shape in the parity matrix, read by a child session of a lineage | Execution and the HTTP helpers resolve the key to the same scope kind and scope id as on `main`: shared keys at the lineage address, private keys at the session's own | V1, V3 |
| BR-2 | A private prefix nested under a shared one, in either declaration order | The longer prefix owns its keys on both paths; order changes nothing | V1, V3 |
| BR-3 | A shared collection with an empty prefix beside private declarations | The private declarations keep their keys on both paths | V1, V3 |

## Conflicts

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | Two session collections on one storage prefix declare conflicting sharing | Execution refuses the flow at context construction with the existing message (matches `/conflicting sharedToLineage/`). The HTTP helpers still answer, first declaration winning, as today | V2 |
| BR-5 | Two session collections on one prefix declare the same sharing | Both paths accept and route to that address | V1 |

## One rule

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | Someone plants a divergence in the shared session walk | At least one HTTP-side test and at least one execution-side test fail | VG |
| BR-7 | The refactor lands | The session declaration walk and its `sharedToLineage` predicate exist once in engine source; `createExecutionContext` builds its session buckets, and resolves a session declaration's scope id, from that one place. User and org bucket building keeps its own loop and prefix normalisation (fenced; PLAN → Follow-ups) | V4 |

## What must not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The change lands | `shared-to-lineage.test.ts`, `shared-to-lineage-ownership.test.ts` and `lineage-address-ownership.test.ts` are untouched and green, as is the whole engine suite | V3 |
| BR-9 | User- or org-scoped resources are read or written | Routing is unchanged; their bucket builder is untouched | V3, the PR's file list |
| BR-10 | A flow declares no lineage-shared resource | The whole-scope HTTP read still does one store read, not two | V3 (existing coverage) |

## Acceptance

Done when BR-1 to BR-10 hold on one commit, VG's planted divergence has been run and reverted with
its result recorded in the PR, and the red state on `main` (one side only) is quoted beside it.
