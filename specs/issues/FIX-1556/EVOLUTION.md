# FIX-1556 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The lab's teaching page: `labs/typesafe-jev/docs/README.md` and `docs/examples/*.ts` on the DNM draft [#1903](https://github.com/fixpoint-labs/flow-state-dev/pull/1903) at `b33a072`. It teaches evaluate, a confidence-gated cascade, the activator and memory seams, and facets, importing `@flow-state-dev/typesafe-jev` | **Superseded.** Its order (evaluate, then a cascade, then the activator) and its fail-closed explanation are **retained** | The owner asked for the lab page to graduate rather than a parallel page be invented. The lab package never ships (epic ER-9), so no import from it can be published. Memory and facets have their own owners | The guide in [DOCS.md](DOCS.md) and the example under `examples/guides/` ([D1](DECISIONS.md#d1)), importing shipped packages only (BR-8) | The lab stays an unmerged draft. Nothing on `main` imports it; nothing migrates |
| The epic's draft of this page: [FIX-1553 DOCS.md → CREATE `apps/docs/guides/routing-with-evaluators.md`](../../epics/FIX-1553/DOCS.md#create--appsdocsguidesrouting-with-evaluatorsmd--the-teaching-page-path-proposed-fix-1556-confirms), path marked "FIX-1556 confirms" | **Retained and extended.** Path confirmed; every sentence of the draft's promise kept | The epic owns the shared narrative; this issue owns the page | [DOCS.md](DOCS.md): three steps, runnable commands, the no-confidence action ([D2](DECISIONS.md#d2)) | None: nothing was published |
| The epic's proof rule: [FIX-1553 ER-15](../../epics/FIX-1553/BUSINESS-RULES.md#the-proof), "FIX-1556's assembled goal under `goals/`" | **Retained**, with one addition: an unwired leg is a placeholder failure naming its owner, so the run fails | ER-15 says the epic is done when all six legs hold; it doesn't say how a leg that isn't wired yet reports | [D3](DECISIONS.md#d3), BR-16, BR-19 to BR-21 | FIX-1557 and FIX-1555 replace their placeholders with real legs |

The kitchen-sink's thinking-style router is not lineage for this issue. The owner shed it, and
nothing here replaces or removes it.
