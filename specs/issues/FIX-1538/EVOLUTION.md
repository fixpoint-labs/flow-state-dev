# FIX-1538 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The key encoding and the upgrade path this issue owns. Lineage that spans the whole epic is in
the epic's [EVOLUTION.md](../../epics/FIX-1528/EVOLUTION.md); its third row is the one this issue
builds.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-735: a shared user-scoped resource, and a non-isolated user scope record, key at the bare person id, one cell across every org. Source: header of `packages/engine/src/stores/scope-keys.ts`; `docs/architecture/state-and-scopes.md` → "Cross-Flow State: Shared vs Isolated" | **Amended** for flows with an owner pin only | Product decision: a private team is not portable (#2070 `specs/issues/FIX-1522/README.md` → "Decided", decision 1). The bare key is the one bucket that follows Alice between orgs | [D1](DECISIONS.md#d1), BR-1–BR-5, S1 | Unpinned flows keep the bare key byte for byte (BR-8). Pinned-seat data written before moves only by [D2](DECISIONS.md#d2)'s step |
| BP-027: user-scoped resources default to shared, and a `false` resource keys at the bare `{userId}`. Source: [`docs/contributing/best-practices/resources.md`](../../../docs/contributing/best-practices/resources.md) → BP-027 | **Amended**, second bullet only | Shared still means shared, inside one (org, person) cell for a hired seat. The practice is unchanged for every other flow | S5 edits the bullet | None. A practice, not stored data |
| FIX-1323: the isolation coordinate is the instance id, and an attributable offline cutover replaces any runtime fallback. Source: `docs/architecture/state-and-scopes.md` → "Per-flow isolation (opt-in)"; `apps/docs/docs/persistence/overview.md` → "Who owns a record" | **Retained**, and the same procedure extended | A seat's flow-isolated data already keys by its address, which carries org and person, so it does not move. The no-fallback rule is D2's reason | BR-6; DOCS.md adds a section beside the existing procedure | Isolated keys unchanged |
| F2 explore, "Plane 3 needs the kind to isolate, and Workforce's doesn't by default". Source: #2070 at `431c65c27`, `specs/issues/FIX-1522/F2-PLAN.md` → "Resource planes for one person in two orgs" | **Superseded in part**: the org and person halves no longer depend on the kind | The framework now keys a seat's shared data per (org, person) whatever the kind declares (epic ER-12). Separating two seats of one person in one org still needs `flowIsolation`, as the explore said | D1, S1 | Kinds that set `isolateUserState` keep their per-seat keys |
| Epic ER-5: "a person in one org sees no change". Source: [`../../epics/FIX-1528/BUSINESS-RULES.md`](../../epics/FIX-1528/BUSINESS-RULES.md) ER-5 | **Retained, with a named limit** raised to the epic, not edited here | Holds for what a seat saved, after the operator step. Cannot hold for app-wide data a seat used to read: one resource has one cell ([D1](DECISIONS.md#d1)) | D1's *Locks in*, signed at this gate | A seat that read a person's app-wide data stops seeing it |

Nothing is wholly superseded. Re-check every row against current code before building: the rows
cite approved intent, and only the code says what shipped.
