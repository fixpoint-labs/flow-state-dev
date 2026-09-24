# FIX-1561 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

One predecessor design, FIX-1477's, which built the navigator this spec reshapes. Two of its
parts move; the rest is retained as is.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1477 D1: the navigator is a published component filled through slots, and "changing the slot shape later is a breaking change". Source: [`../FIX-1477/DECISIONS.md#d1`](../FIX-1477/DECISIONS.md#d1) | **Retained** for the slot shape; **amended** for where one slot draws | The slot names and arguments stay; only `leafToolbar`'s placement moves, from its own line inside the open leaf to the leaf's row | [D1](DECISIONS.md#d1), BR-1 – BR-3 | Same types. A host with wide toolbar content must shrink it; the `minor` release note says so |
| FIX-1477 BR-27 and check V6: fully expanded at 256px, "three levels of indentation still read", proved by the rows' left padding values differing. Source: [`../FIX-1477/BUSINESS-RULES.md#as-the-viewport-narrows`](../FIX-1477/BUSINESS-RULES.md#as-the-viewport-narrows), [`../FIX-1477/PLAN.md#checks`](../FIX-1477/PLAN.md#checks) | **Retained** as a rule; its **proof superseded** | Padding values differ on today's rail, yet sessions render 4px left of their instances ([POC](poc/rail-geometry/README.md)). The rule was right and its check could not fail on this defect | [D2](DECISIONS.md#d2), BR-11 – BR-15, VG | The single-scroll-container half of V6 is kept |

Not superseded, only depended on: FIX-1455 D8 (one navigator, depth from cardinality) and
FIX-1440's one-level dispatch-run indent, both of which this layout keeps. FIX-1477 also
deleted the developer tool's own navigator directory, which is why the file the issue names no
longer exists; that is history, not a design this spec changes.

Before building, check these against current code. Approved intent is not proof that it
shipped as written.
