# FIX-1917 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The Cursor block keeps no session state and declares none, so a task board hands it off with no further option. No retained spec; source [the Cursor page → Continuing an agent](../../../apps/docs/docs/tools/cursor.md#continuing-an-agent) | **Retained** as the default. **Amended** by an opt-in option that declares the plan record | Epic ER-5 wants Cursor's plan recorded; harness-manager relies on a block with no session state | DECISIONS → Decided, not asked; PLAN S3 | Option off is today's block exactly (BR-19) |
| Cursor's to-do update is an ordinary tool call, and its `task` messages are status notes. Source [`packages/cursor/src/translate.ts`](../../../packages/cursor/src/translate.ts) | **Retained**. The update also yields a plan-list event | The record is in addition to the stream, so the goal check can compare them | [D1](DECISIONS.md#d1), PLAN S1 | No item changes |
| FIX-1915's plan record: rows keyed `<request>/<run>/<the harness's own item id>`. Source [FIX-1915 DOCS → The run's plan](../FIX-1915/DOCS.md), at its review head | **Retained**, through FIX-1915's whole-list path: Cursor's rows are written by core's `replacePlanList(collection, marker, namespace, items)`, whose last key segment is the item's place, with the `observed-plan-list` marker beside them (FIX-1915 BR-22a to BR-22d) | Cursor's runtime has ids and the pinned SDK drops them ([POC](poc/sdk-wire/README.md) F1, F1b) | [D2](DECISIONS.md#d2), PLAN S2 | Same key pattern and fields. A reader that treats the last segment as opaque is unaffected |
| The issue's premise: Cursor's `task` messages might be its plan, and if Cursor reports none the panel says so. Source [FIX-1917](https://linear.app/fixpoint-labs/issue/FIX-1917) | **Superseded** | `task` messages are run summaries; the to-do list is `updateTodos` ([POC](poc/sdk-wire/README.md) F3, F4) | [D1](DECISIONS.md#d1) | None: nothing shipped |
| Epic FIX-1907 D2, D3, ER-2, ER-5, ER-6, ER-11; FIX-1915 D1, D2 and its session flow. Sources [`../../epics/FIX-1907/DECISIONS.md`](../../epics/FIX-1907/DECISIONS.md), [`../FIX-1915/DECISIONS.md`](../FIX-1915/DECISIONS.md) | **Retained**, applied to Cursor | — | This spec | — |

FIX-1915's documents are at its review head until it merges. Re-check each source against
current code and the merged FIX-1915 before PR-A.
