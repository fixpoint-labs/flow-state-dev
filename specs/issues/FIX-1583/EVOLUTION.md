# FIX-1583 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes. The one predecessor is FIX-1557, retained at
[`specs/issues/FIX-1557/`](../FIX-1557/SPEC.md) and shipped by
[#2234](https://github.com/fixpoint-labs/flow-state-dev/pull/2234) (merged at `287e7c28e`). Its
own lineage from the #1903 lab is in [its EVOLUTION](../FIX-1557/EVOLUTION.md) and is not
restated.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| [FIX-1557 D1](../FIX-1557/DECISIONS.md#d1): facets ship as a recipe, an example and a proof; no export, no helper; a collapse trigger for later | **Superseded** | The owner reversed it on #2234 ([comment](https://github.com/fixpoint-labs/flow-state-dev/pull/2234#issuecomment-5831771033)): "add facet handling as a provided ready to use utility" | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2) | The recipe's stored fields are kept by name, so rows it wrote are read as they are (BR-23) |
| [FIX-1557 D2](../FIX-1557/DECISIONS.md#d2): a save never fails on the model; clear first, classify on a side chain, store through a token-conditioned `updateState` | **Retained**, moved into core | The rules are correct and tested; the change is only where they live | BR-9 to BR-11 | Same behaviour, same fields |
| [FIX-1557 D3](../FIX-1557/DECISIONS.md#d3): answers stored as given; `minConfidence` only at search, absent confidence fails it | **Retained** | Unchanged by the reversal | BR-8, BR-17, BR-18 | — |
| FIX-1557 [Decided, not asked](../FIX-1557/DECISIONS.md#decided-not-asked): "search is app code over the collection, offered to agents as a handler tool" | **Amended**: the search block is provided, typed from the questions | Part of what the owner asked to be provided | S1, BR-15, BR-19 | Same input and output shape as the example's `search` action |
| FIX-1557 [BR-18](../FIX-1557/BUSINESS-RULES.md#the-fence) and its guardrail "nothing under `packages/` changes" | **Superseded** | Follows from D1's reversal | [D1](DECISIONS.md#d1), BR-24, BR-25 | One new core export; no other package changes |
| FIX-1557 [BR-16](../FIX-1557/BUSINESS-RULES.md#reindexing): a client body edit leaves old facets until reindex; the example grants no client edits | **Amended**: refused when the collection is defined | A utility can enforce what a recipe could only ask | [D3](DECISIONS.md#d3), BR-4 | An app granting client body edits must drop the grant to adopt the utility |
| The shipped searching page's walkthrough (`apps/docs/docs/resources/searching.md` → "Find by facets", "copy it rather than rewriting it") | **Amended**, docs only | [D2](DECISIONS.md#d2) | [DOCS.md](DOCS.md) | The opening, "Classifying the search instead" and "Choosing a tool" stay |
| The shipped example `examples/guides/index-time-facets/` (`src/index-facets.ts`, the copied search) and the leg (e) goal | **Amended**: the example uses the utility; the goal's behaviour is unchanged | [D2](DECISIONS.md#d2): leg (e) should prove what ships | S7, S8, VG | `ticketsFlow(triage)` keeps its signature and actions |
| Core's `reactTo` on `defineResource` / `defineResourceCollection` (`packages/core/src/types/resource-change.ts`) | **Retained**, unchanged | The Linear issue expected a lazy form might be needed; it isn't ([D1](DECISIONS.md#d1), Settled) | — | — |
