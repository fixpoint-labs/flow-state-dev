# FIX-1555 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage specific to memory. The epic's cross-child rows
([epic EVOLUTION](../../epics/FIX-1553/EVOLUTION.md)) are not repeated.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The DNM lab's memory seam: an optional `classifier` block on `system()`, stored on `mem.classifier`, never called by capture; a lab block asking store, salience and kind. Source: [#1903](https://github.com/fixpoint-labs/flow-state-dev/pull/1903) at `b33a072`, `packages/memory/src/memory-system.ts` and `labs/typesafe-jev/src/memory-decision.ts` | **Superseded.** The optional-block-on-`system()` shape is retained; the uncalled slot, the exposed field and the three questions are not | The lab proved a slot needs nothing else from memory. It never called the block, which the epic's ER-7 bar rejects (epic review round 1). The three questions would classify beside the observer ([D1](DECISIONS.md#d1)) | [D1](DECISIONS.md#d1) to [D3](DECISIONS.md#d3); BR-3 to BR-11 | The lab never merged. No app holds `mem.classifier` |
| The unified observer runs on every capture and is memory's only classifier. Source: `memorySystemObserve` and `memorySystemCapture` in `packages/memory/src/memory-system-blocks.ts` on `main` | **Retained**, optionally gated | The observer still extracts and classifies. The gate decides only whether it runs | BR-1, BR-3 | With no evaluator, byte for byte as today |
| Memory attaches to an app's own kind through `uses` and resources ([FIX-1364](https://linear.app/fixpoint-labs/issue/FIX-1364), Done) | **Retained**, untouched | The evaluator is a runtime option on capture, not an attach mechanism | — | Unchanged |

Nothing shipped is superseded. Re-check the observer rows against `main` before building; the
lab rows against `b33a072`.
