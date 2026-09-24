# FIX-1527 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

One predecessor design. It exists only on an unmerged explore PR, so it's cited by that PR's
head rather than by a local path.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1480 explore, `PLAN.md` proposed ship ticket **SHIP-C**: "A file-declared manager with `tools: [hire]`. Prove a teammate appears on `discover` after the tool runs." Source: [PR #2074](https://github.com/fixpoint-labs/flow-state-dev/pull/2074) head `8d589df3a54abe8e9cbfa55675fed3fe3a629b50`, `specs/issues/FIX-1480/PLAN.md` line 27 | **Retained, amended in two places.** Kept: a file-declared seat, the tool named in `tools:`, the capability on the kind, `discover` after the hire. Amended: the seat names `fire` too, and the `discover` proof runs under a named organization rather than in the default app | SHIP-A and SHIP-B landed as FIX-1525/1526 in [#2079](https://github.com/fixpoint-labs/flow-state-dev/pull/2079). [`poc/manager-seat/`](poc/manager-seat/README.md) P2 and leg R show the default app can't hire at all, which SHIP-C didn't anticipate | [D1](DECISIONS.md#d1), [F1](DECISIONS.md#f1) | None. Nothing shipped under SHIP-C |

Two neighbours are dependencies, not predecessors, and nothing here changes them.
FIX-1475's durable roster and operator action are consumed as-is. FIX-1475's earlier rule that
a runtime hire gets no inventory row was changed by #2079, not by this spec.
