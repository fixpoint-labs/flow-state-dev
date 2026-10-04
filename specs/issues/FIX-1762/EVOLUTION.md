# FIX-1762 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project is a row in the org resource plane, nothing in L1, no new folder; source [FIX-1650 D2](../../epics/FIX-1650/DECISIONS.md#d2), [ER-10](../../epics/FIX-1650/BUSINESS-RULES.md#what-no-child-may-do) | **Retained**, extended by one field | The repository is project data a person changes at runtime, which is what the row is for | S5: `repository` on `projectRowSchema` | Old rows read as `null` (BR-7) |
| The checkout's source repository is host-set, one per manager; source: no retained spec. Provenance is the shipped `WorkspaceConfig.sourceRepo` doc ("The repository checkouts are cut from. Host-set.") in `packages/harness-manager/src/workspace.ts` and the README's Quick start | **Amended**: host-set stays the default; a host may instead hand a per-run resolver. Path derivation, ownership and "never discard work" are retained | A project-backed Lab needs the repository to follow the work; a resolver fed only the block context keeps the BP-031 property the host-set rule protected | [D2](DECISIONS.md#d2), S1–S3 | A fixed `sourceRepo` behaves as today (BR-19) |

Neither predecessor is superseded. FIX-150's workspace projection is reused as is (S4), not
changed, so it is a dependency rather than a lineage row.
