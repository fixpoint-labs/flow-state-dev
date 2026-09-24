# FIX-1546 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-581: the schedule index is a per-user read-model keyed by `(user_id, key)`. No retained spec; source is [FIX-581](https://linear.app/fixpoint-labs/issue/FIX-581) and the DDL comments in `packages/store-sqlite/src/schema.ts` / `packages/store-postgres/src/schema.ts` | **Superseded in part**: the key only. The read-model, the at-most-once claim, and the hook-driven mirroring are retained | A person no longer has one schedule store: a hired seat has one per org (FIX-1538), so the person is no longer the source row's address | [D1](DECISIONS.md#d1), S2–S8 | Old rows adopted in place ([D2](DECISIONS.md#d2), BR-12–BR-14) |
| FIX-1442 / BR-19: the index row carries the organization the schedule fires into, and a row whose stored org disagrees with its writer is removed. Source: `defineScheduleCollection.ts` → `indexOrgFor`; `apps/docs/docs/server/scheduled.md` → "The organization a schedule fires into" | **Retained** | Organization stays data on the row. The removal now reaches only its own cell's row | — | Unchanged |
| FIX-1538 D1: a hired seat stores a person's data in one cell per (org, person). Source: [`../FIX-1538/DECISIONS.md#d1`](../FIX-1538/DECISIONS.md#d1), BR-17 | **Retained, extended** to the index: the mirror now uses the cell the seat's schedule is stored in | FIX-1538 moved the source rows and the resolver; the index hook still used the bare person (`CollectionHookContext.scopeId`) | S1, S3 | Unpinned flows' rows keep the person's own cell |

Nothing is wholly superseded. Re-check each row against the code before building.
