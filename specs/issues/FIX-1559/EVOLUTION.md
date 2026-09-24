# FIX-1559 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only the activator's lineage. The kind's is FIX-1554's; the cross-child rows are the
[epic's](../../epics/FIX-1553/EVOLUTION.md).

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Tier 3 of the opt-in activator is a generator classifier returning zero or more skills above a self-reported 0.65 confidence ([FIX-421](https://linear.app/fixpoint-labs/issue/FIX-421), Done). Source: `createSkillClassifierSequencer` in `packages/orchestration/src/skills/skill-classifier-gen.ts`, wired by `createSkillActivator` in `skill-activator.ts` | **Retained** as the default; **extended** with an alternative | [Epic D4](../../epics/FIX-1553/DECISIONS.md#d4) and the epic's [evolution row](../../epics/FIX-1553/EVOLUTION.md) | [D1–D3](DECISIONS.md), BR-1 to BR-3 | Apps that pass no evaluator see no change. The listing loop moves into a shared function; its output is unchanged (V1) |
| The stock agent kind: slash plus a configured set, `enableLlmClassifier` per seat, default off, no keyword tier ([FIX-1362](https://linear.app/fixpoint-labs/issue/FIX-1362), [FIX-1363](https://linear.app/fixpoint-labs/issue/FIX-1363), Done). Source: `packages/workforce/src/agent-worker-flow.ts` | **Retained**, untouched | Owner stamp on #1723 and #1724, restated on FIX-1559 | ER-11, BR-20 | Untouched |
| The lab's seam on the DNM draft [#1903](https://github.com/fixpoint-labs/flow-state-dev/pull/1903) at `b33a072`: an untyped `classifier?: BlockDefinition` option on `createSkillActivator`, and `createSystemOneSkillClassifier` in `labs/typesafe-jev/src/skill-classifier.ts`, a handler that resolved its own model, offered the catalog plus `none`, read absent confidence as `0` against 0.65, and patched the activator's sequencer state itself | **Superseded**. Its one-choice-plus-no-skill shape is **retained** ([D1](DECISIONS.md#d1)) | Epic D3 types the slot on an evaluator and keeps model resolution in core. Absent-as-`0` is the invented number ER-3 forbids, and makes tier 3 dead on adapters ([D2](DECISIONS.md#d2)). `none` collides with a valid skill name (BR-6) | The `evaluator` option, the S3 tier, `skillEvaluator` | The lab is never merged; nothing on `main` uses its option |

Nothing shipped is superseded. Re-check each row against current code before implementing.
