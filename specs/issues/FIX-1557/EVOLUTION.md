# FIX-1557 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes. The lab as a whole and the block-kind count are the epic's
([epic EVOLUTION](../../epics/FIX-1553/EVOLUTION.md)).

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The DNM lab's facets slice on [#1903](https://github.com/fixpoint-labs/flow-state-dev/pull/1903) at `b33a072`: `labs/typesafe-jev/src/index-capability.ts` (`createSystemOneIndexCapability`, a default-on search tool), `index-ops.ts` (ingest, search, reindex, `classifyQueryEscape`), `facets.ts` (`facetsFromAnswers` with a `minConfidence` floor, `needsReindex` on content hash and schema version) | **Superseded in part.** Retained: classify at write, facets on the resource's state, a deterministic filter, an explicit reindex. Superseded: the capability and its System One name, the model resolved inside the ops, the write-time floor, the hash and version fields, and shipping query-time classify as an operation | Owner locks (no System One, consumers take a block, query-time is an escape hatch); epic D2 (popular adapters report no confidence, so a write floor empties every facet) | [D1](DECISIONS.md#d1), [D3](DECISIONS.md#d3), [Decided, not asked](DECISIONS.md#decided-not-asked) | The lab never shipped and stays a draft. No stored rows exist to migrate |
| Reactive blocks name re-indexing as a `contentUpdated` use, and a state write never re-fires the content reaction ([FIX-843](https://linear.app/fixpoint-labs/issue/FIX-843), shipped). Source: `apps/docs/docs/resources/reactive-blocks.md` → "Reacting to content changes" | **Retained**, consumed | The trigger facets need, with the loop boundary they rely on | BR-1, BR-6 | Unchanged. A cross-link is added |
| Resource search is lexical and names "which concepts are about hooks" as out of reach (shipped; the page as of [#1898](https://github.com/fixpoint-labs/flow-state-dev/pull/1898)). Source: `apps/docs/docs/resources/searching.md` → opening | **Amended**, docs only: facets answer that question beside the three tools | ER-6 | [DOCS.md](DOCS.md) | `resourceSearchTools()` unchanged |

Re-check the lab rows against #1903 at `b33a072`, not memory, before implementing.
