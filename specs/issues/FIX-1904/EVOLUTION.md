# FIX-1904 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The epic's lineage ([epic EVOLUTION](../../epics/FIX-1903/EVOLUTION.md)) covers the default
profile and the no-silent-fallback rule. This page adds only what this issue's own surfaces amend.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The checkout's `start` and `dev` scripts open DevTeam's config; [FIX-1770 PLAN](../FIX-1770/PLAN.md#surfaces) S10, shipped in `packages/shift-manager/scripts/checkout.mts` | **Amended**, the default only | Epic D2: DevTeam stays the goal Lab, the dev Lab gets its own profile | PLAN S4: the default is `fsd`; `--config` still wins | Every goal passes `--config` already (`goals/lib/shift-manager.mts`), so none moves |
| FIX-1770's docs draft, "`dev` runs the `devteam` profile", published in `apps/docs/docs/shift-manager/overview.md`; [FIX-1770 DOCS](../FIX-1770/DOCS.md) | **Superseded** for that sentence | The sentence is false once S4 lands | [DOCS.md](DOCS.md), first operation | None |
| A served Lab's coder is the script unless `DEVFORCE_LAB_HARNESS=claude-code`; `packages/shift-manager/teams/devteam/harness.mts`, `selectHarness` | **Amended**: the default is per profile; the refusal of an unknown name and the no-fallback rule are retained | Epic Q1, accepted at merge | PLAN S1, D1 | DevTeam's default stays `stub` |
| A served Lab's workspace host reaches remotes only, with no local checkout; `host.mts`, `labWorkspaceHost` and `answerWorkspaceHost` | **Amended**: an optional checkout mapping, absent by default | Epic D3, with the mapping as FIX-1906's `projectWorkspace()` option | PLAN S2 | Absent means today's hosts |

Re-check these against current code before implementing; FIX-1906 is not merged when this is written.
