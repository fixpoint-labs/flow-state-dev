# FIX-1655 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1477 D1: the navigator and panels ship with no CSS framework, themed through `--fsd-nav-*` and `--fsd-panel-*` and slots; source [`../FIX-1477/DECISIONS.md#d1`](../FIX-1477/DECISIONS.md#d1), with BR-17 in its [`BUSINESS-RULES.md`](../FIX-1477/BUSINESS-RULES.md) | **Retained** | `poc/palette-census/` finds no colour in the 15 chrome files outside those properties' fallbacks | The package maps its tokens onto them ([D1](DECISIONS.md#d1), BR-13) | No property renamed or added |
| FIX-1477 BR-14 and V8: the reference app's registry copies stay byte-identical, checked for kitchen-sink alone; source [`../FIX-1477/BUSINESS-RULES.md`](../FIX-1477/BUSINESS-RULES.md) BR-14 and [`../FIX-1477/PLAN.md`](../FIX-1477/PLAN.md) V8 | **Amended**: the same rule, over a list of consumers | App Lab copies from the same registry and the epic's ER-6 holds it to the same bar | One drift check over a consumer list (PLAN S6, BR-17) | Kitchen-sink's assertions (both directions, the count) carry over unchanged |
| FIX-1649 D2 and ER-2, ER-3, ER-6: one skin through the existing contracts, neutral defaults beside the components, gaps fixed at source; source [`../../epics/FIX-1649/DECISIONS.md#d2`](../../epics/FIX-1649/DECISIONS.md#d2) | **Retained**, and made concrete | This issue owns those rules in the epic | D1 to D3 here | — |

Nothing is superseded. Re-check each cited intent against current code before implementing.
