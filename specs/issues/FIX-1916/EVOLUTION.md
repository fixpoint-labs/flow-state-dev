# FIX-1916 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Epic FIX-1907 D3, *Locks in*: "Codex and Cursor write it" (the plan record); source [`../../epics/FIX-1907/DECISIONS.md#d3`](../../epics/FIX-1907/DECISIONS.md#d3) | **Amended for Codex**, if [the open question](DECISIONS.md#open) takes the recommendation: Codex reports none. The one-way, read-only, one-record rule is **retained** | The pinned Codex offers its model no plan tool ([POC leg D](poc/codex-wire/)). ER-5 already provides for a harness that reports none | [Open](DECISIONS.md#open); the epic's own amendment is the coordinator's follow-up PR (ER-15) | Nothing stored: no Codex plan rows ever existed |
| Epic FIX-1907 ER-2, ER-3, ER-4, ER-6; source [`../../epics/FIX-1907/BUSINESS-RULES.md`](../../epics/FIX-1907/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt) | **Retained**, implemented for Codex | — | This spec | — |
| FIX-1915's session flow, per-turn binding, workspace rule and plan panel states; source [`../FIX-1915/`](../FIX-1915/SPEC.md) | **Retained** and consumed unchanged | Codex's thread lifecycle fits the per-turn binding as is (POC legs A, B, C, E) | — | — |
| LAB-153's Codex package: `resume` / `onSession`, and "a refused resume never reaches `onSession`"; source [`packages/codex/src/agent.ts`](../../../packages/codex/src/agent.ts) and [the Codex page → Continuing a thread](../../../apps/docs/docs/tools/codex.md#continuing-a-thread) | **Retained**; the refusal claim is now shown on the real CLI (POC leg C) | PLAN S5 | The package is unchanged except S5: Codex's `no rollout found for thread id` error now carries core's unknown-conversation classification. `codex` patch changeset |
| The same package's mapping of a Codex to-do list to a settled `tool_output`; source [`packages/codex/src/translate.ts`](../../../packages/codex/src/translate.ts) | **Retained**, unexercised: the pinned Codex sends no list | The SDK's own notes say a list starts, updates and completes, where the translator expects it settled. Moot until a list arrives | [PLAN → Follow-ups](PLAN.md#follow-ups) | — |

Amended by the cross-spec check (2026-10-12); see [the epic's Evolution](../../epics/FIX-1907/EVOLUTION.md).

Amended after merge (2026-10-13, owner decision): the allowlist is environment filtering, not a security boundary; see [How it got here](DECISIONS.md#how-it-got-here).

Re-check FIX-1915's rows against its merged spec before implementing.
