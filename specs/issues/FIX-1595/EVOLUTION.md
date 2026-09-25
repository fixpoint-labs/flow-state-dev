# FIX-1595 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The activator hands the evaluator `{ message, skills }`, and `skillEvaluator` evaluates the message alone ([FIX-1559 D3](../FIX-1559/DECISIONS.md#d3), [BR-4](../FIX-1559/BUSINESS-RULES.md)) | **Amended** for blocks built by `skillEvaluator(model, { recentMessages })` with N > 0 only; **retained** for the default and for hand-built blocks | Follow-ups miss because the state is one message (the issue); `skillEvaluator.ts` today has `state: (input) => input.message` | [D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2), BR-2 | Optional input field; omit or 0 is byte-identical (BR-1); hand-built blocks unchanged (BR-13) |
| Tier 3 with an evaluator picks one skill or none, final, over the same capped catalog; empty catalog makes no call ([FIX-1559 D1](../FIX-1559/DECISIONS.md#d1), [D2](../FIX-1559/DECISIONS.md#d2), [BR-5](../FIX-1559/BUSINESS-RULES.md)) | **Retained** | Locked on the issue | BR-11, BR-12 | Unchanged |
| The stock agent kind gets no evaluator option ([epic ER-11](../../epics/FIX-1553/BUSINESS-RULES.md), [FIX-1363](https://linear.app/fixpoint-labs/issue/FIX-1363)) | **Retained** | Locked on the issue | BR-14 | Unchanged |

No predecessor is superseded. FIX-1372 (empty catalog on the first turn) is a related open issue,
not a design this one changes.
