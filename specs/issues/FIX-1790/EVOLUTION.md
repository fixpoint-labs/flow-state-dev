# FIX-1790 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The user key. Lineage across the whole epic is in the epic's
[EVOLUTION.md](../../epics/FIX-1786/EVOLUTION.md); its user-data row is the one this issue builds.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-735: a person's shared user data, and a non-isolated user scope record, key at the bare person id, one cell across every org and every flow. Source: header of `packages/engine/src/stores/scope-keys.ts`; [`state-and-scopes.md` → Cross-Flow State: Shared vs Isolated](../../../docs/architecture/state-and-scopes.md#cross-flow-state-shared-vs-isolated) | **Superseded** for user scope; retained for org scope | Epic ER-3: user data is kept per (user, org) for every flow, or private workers show in every org | S1, BR-1–BR-4 | Old cells are dropped: read by nothing, copied by nothing ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| FIX-1538 D1: a hired seat keeps a person's data in its own (org, person) cell, and seats and the app's flows never see each other's. Source: [`../FIX-1538/DECISIONS.md#d1`](../FIX-1538/DECISIONS.md#d1) | **Retained** for the cell, byte for byte; **amended** for the separation | The separation existed because the app's cell crossed orgs. Once every flow keys per org, two cells per user per org isolate nothing, and BP-027's "shared means shared" applies again | DECISIONS → *Decided, not asked*, first line; BR-5 | A hired worker reads nothing it didn't before from its own cell, and now also the app's shared data in that org, under keys the registry already checks |
| FIX-1538 D2 and BR-14–BR-18: an operator step copies only keys a seat alone declares, for people whose seats ran in one org, never the user record, and stops on a written destination. Source: [`../FIX-1538/DECISIONS.md#d2`](../FIX-1538/DECISIONS.md#d2); [`../FIX-1538/BUSINESS-RULES.md`](../FIX-1538/BUSINESS-RULES.md) → "Upgrading a deployment that already has seats"; `apps/docs/docs/persistence/overview.md` → "Upgrading: moving hired seats' stored data" | **Superseded** by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9); this issue had first amended and generalized it (its D2, BR-16 to BR-20) | No consumers: nothing to copy | DOCS.md removes the page section, with no replacement | The no-fallback rule is unchanged (epic ER-3) |
| FIX-1538 *Considered and dropped*: "Re-key user scope to (user, org) for every flow — decides the person's cross-org data, which nobody has decided". Source: [`../FIX-1538/DECISIONS.md`](../FIX-1538/DECISIONS.md) → "Considered and dropped" | **Superseded** | Decided since, by the epic ([D3](../../epics/FIX-1786/DECISIONS.md#d3), ER-3) | This issue | — |
| FIX-1323: the isolation coordinate is the instance id, with an attributable offline cutover and no kind fallback. Source: [`state-and-scopes.md` → Per-flow isolation (opt-in)](../../../docs/architecture/state-and-scopes.md#per-flow-isolation-opt-in); `apps/docs/docs/persistence/overview.md` → "Who owns a record" | **Retained**; the flow-isolated user key gains the org ahead of the instance | The same no-fallback reasoning is epic ER-3's | S1, pinned isolated key | Instance coordinates unchanged; org-scope isolated keys unchanged |
| BP-027: user-scoped resources default to shared, and a `false` resource keys at the bare `{userId}`, with FIX-1538's pinned exception. Source: [`best-practices/resources.md` → BP-027](../../../docs/contributing/best-practices/resources.md#bp-027-user-scoped-resources-default-to-shared-flowisolation-off-isolate-only-deliberately) | **Amended**, second bullet only | Shared means shared inside one (user, org) cell, for every flow; the pinned exception is now the rule | S7 edits the bullet | A practice, not stored data |
| FIX-1442: org is never optional. Source: `apps/docs/docs/persistence/overview.md` → "Which organization a record belongs to"; [`../../epics/FIX-1786/BUSINESS-RULES.md`](../../epics/FIX-1786/BUSINESS-RULES.md) ER-13 | **Retained** and relied on | The admitted org is always present, so the per-org cell can always be built | BR-9 | A record with no org is refused as before |

Nothing is wholly superseded except the bare user key itself. Re-check every row against current
code before building: the rows cite approved intent, and only the code says what shipped.

<a name="amendment-d9"></a>
## Amended after merge: old records are dropped, not copied (epic D9)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do); ER-3 already says a record
stored under the cross-org key is dropped, never read in any org and never moved. The same day
he answered that the kitchen-sink app's and the DevTeam lab's stores are reset once when this
ships.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| [D1](DECISIONS.md#d1), old data read by nothing until an operator copies it, and [D2](DECISIONS.md#d2), the copy's attribution rule | **Withdrawn**. Both cards are stubs that link their text at the commit before the sweep; their figures are deleted | The copy protects data no consumer has | D1's first half, as epic ER-3: nothing reads an old cell, and each user starts empty in each org |
| BR-15 to BR-20, V4 and V7 | **Removed**, IDs kept and struck | They ruled and checked the step | BR-7's disjoint keys, and V1, V3 and V5's checks that nothing reads an old cell |
| Leg c, its old record and the `fallback-read` control | **Removed** | Leg c graded the step | Legs a and b and the `cross-org-key` control |
| DOCS, "Upgrading: moving user data into its organization", the durable-hire link to it, and the changesets' upgrade note | **Removed**. The persistence page's older hired-seat upgrade section is removed with no replacement | No upgrade page (ER-31) | The changesets for the changed helpers and dispatch id |
| The follow-ups: a startup warning about uncopied cells and a shipped copy command | **Removed** | Nothing to copy | — |
| `cells.svg`'s operator step | **Amended**: the old cell is dropped, and nothing copies it | Follows from D1 | The fence |

