# FIX-1549 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| FIX-1522 F2 plan: "any other deep pattern is refused when it's defined (probe C)"; source [`../FIX-1522/F2-PLAN.md`, "The open wall: where a user-owned row lives"](../FIX-1522/F2-PLAN.md#the-open-wall-where-a-user-owned-row-lives), shipped as FIX-1529's cut C in [#2091](https://github.com/fixpoint-labs/flow-state-dev/pull/2091) (`fdca49f`) | **Amended**: the refusal is retained; *where* it runs moves from definition to registration | The define-time check only ever refused a subset of what registration refuses ([poc/characterize](poc/characterize/README.md)). Running it in Core is what makes every app pay | [D2](DECISIONS.md#d2), BR-1, BR-14 | Workforce apps: the same patterns fail at startup instead of module load, same message |
| FIX-1529 `ef5228f`: "a parameterised pattern that can resolve onto a user-owned roster row is refused when the flow registers", for every flow in every registry | **Amended**: retained wherever the private writer is registered; not applied in a registry that never holds it | The scan refuses generic patterns (`[tenant]/**`, `[a]/[b]/[c]/[d]`) in apps with no Workforce. The FIX-1529 review raised it twice, at [r4084843555](https://github.com/fixpoint-labs/flow-state-dev/pull/2091#discussion_r4084843555) and [r4084780739](https://github.com/fixpoint-labs/flow-state-dev/pull/2091#discussion_r4084780739) | [D1](DECISIONS.md#d1), BR-2 to BR-9 | Where the writer is not registered, an overlapping collection is admitted but cannot read or write a user-owned row: the key fence (BR-15 to BR-19) holds in every process. No deployment rule |
| FIX-1529 acceptance 5 (roster-owner refuse) and the caller-only read of the writer | **Retained**, untouched | Neither reads collection patterns | — | None |

FIX-1529 has no retained spec directory; its design lives in FIX-1522's retained POC set and
in #2091. The FIX-1535 debug filter is a dependency, not a superseded design. Compare these
claims against current `packages/engine/src/context/hire-plane.ts` before building.
