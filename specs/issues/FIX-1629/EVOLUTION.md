# FIX-1629 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Earlier designs this issue retains or amends. Retained specs are not edited. The Tasks panel
itself (FIX-445) has no retained spec; its intent is in the file header of
`task-collections-view.tsx`.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Reason shown on the row, keyed on the presence of `feedback`, verbatim, absent on a board with none. [FIX-1481 BR-1, BR-2, BR-4, BR-5, BR-8](../FIX-1481/BUSINESS-RULES.md) and its *Decided, not asked* | **Retained** | Still the right rule; only its place on the row moves | BR-8 | Same predicate and text |
| *"Still readable on the row, the table still looks like a table, and the full text is still in the expander."* [FIX-1481 BR-6](../FIX-1481/BUSINESS-RULES.md) | **Amended**: no table and no separate expander; the row itself expands, full text inside it | The floating expander is the defect in Jake's screenshot | BR-3, BR-7 | Full text still one click away |
| *"Any task row opened in the JSON expander: unchanged, byte for byte."* [FIX-1481 BR-7](../FIX-1481/BUSINESS-RULES.md) | **Amended**: the raw JSON moves inside the expanded row, folded, still complete | Same | BR-5 | Same data, new place |
| Reason column after Goal, Goal up to 28rem. FIX-1481 as shipped | **Superseded** by status first, goal and reason sharing the width | FIX-1523 measured the reason at 0px at 1280 | BR-1, BR-2 | FIX-1523 closes |
| FIX-1497 VB and FIX-1481's goal read the reason *"under the `Reason` heading"*. [FIX-1497 PLAN](../FIX-1497/PLAN.md), VB | **Amended**: same claim, read from the row's reason slot by task id | The heading goes away | Plan S10, C7 | Same legs and controls |
| A person answers a parked row through a flow action carrying the request's principal; never a drain. [FIX-1457 ER-1](../../epics/FIX-1457/BUSINESS-RULES.md) | **Retained** | Row actions are flow actions and none drains | BR-23 | — |
| Channel board task tools are for models, all eight or none. [workforce channels docs, "Working the rows"](../../../apps/docs/docs/workforce/channels.md#working-the-rows) | **Retained**, and the same eight are offered as actions behind an opt-in | One surface, two callers | BR-17, BR-19 | Tool names unchanged |

Before implementing, compare each row with current code and docs; approval of the intent does
not establish what has shipped.
