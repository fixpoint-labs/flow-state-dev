# FIX-1559 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. The *proved by* column is the check the plan runs (V-n in
[PLAN.md](PLAN.md#checks)). Epic rules are ER-n ([epic rules](../../epics/FIX-1553/BUSINESS-RULES.md));
FIX-1554's are cited as 1554/BR-n ([its rules](../FIX-1554/BUSINESS-RULES.md)).

## Which classifier runs

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | No `evaluator` is passed | Tier 3 is today's generator classifier: same model, prompt, 0.65 floor and multi-skill output. No evaluator block is built, no evaluation model is resolved, no evaluator row appears in the trace ([epic D4](../../epics/FIX-1553/DECISIONS.md#d4)) | V1 |
| BR-2 | An evaluator is passed and slash or keyword resolved the turn | The evaluator is not called | V2 |
| BR-3 | An evaluator is passed and tiers 1 and 2 did not resolve | Exactly one evaluator call. The generator classifier is never built for this activator, so no path can reach it ([epic D3](../../epics/FIX-1553/DECISIONS.md#d3)) | V3 |

## What the evaluator is offered

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | Tier 3 runs with an evaluator | The options are the catalog skills the generator path would describe: in the binding's `allowed` set, not `disableModelInvocation`, capped at `maxSkillsInClassifier` (default 20), each described by `description` and `whenToUse`. Plus one "no skill" option | V3 |
| BR-5 | That list is empty | No evaluator call. The turn resolves with no tier-3 skill. Nothing outside the binding is offered in its place | V4 |
| BR-6 | A catalog skill is named `none` (or any valid skill name) | It is offered and can be picked. The "no skill" key lies outside the skill-name grammar, so it can never collide | V6 |
| BR-7 | The action input carries extra fields (a `skills` array, say) | The offered options are unchanged. They come from the collection only (BP-031) | V9 |

## What the pick does

| # | When | Then | Proved by |
|---|---|---|---|
| BR-8 | The evaluator picks a skill | That one skill activates with `source: "classifier"` and empty `input` ([D1](DECISIONS.md#d1)) | V5 |
| BR-9 | It picks "no skill" | Nothing activates from tier 3; the turn is resolved | V6 |
| BR-10 | The answer carries `confidence` (Jev) | The match carries exactly that value. It is never compared to a threshold: a pick at `0.1` still activates ([D2](DECISIONS.md#d2)) | V5 · VG |
| BR-11 | The answer carries no `confidence` (the popular adapters) | The pick still activates. The match has **no** `confidence` key and the aggregate is `null`: never `0`, never a default (ER-3) | V5 · VG |

## Failures

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | The evaluator fails: a provider error, a refused model (1554/BR-10 to BR-13), or a malformed result (1554/BR-20) | The activator fails with that error, as a generator-classifier failure does today. No skills are written for the turn, and the generator classifier makes no call. An app that wraps the activator in `.rescue` gets its handler's result instead | V7 |
| BR-13 | The request is cancelled mid-call | The activator ends cancelled, not failed (1554/BR-22) | V8 |
| BR-14 | The passed evaluator's answers have no `skill` choice (a hand-built block with the wrong question) | The activator fails, naming the block and the expected question. Nothing activates | V11 |

## Configuration

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | `evaluator` is a block that isn't an evaluator (a handler, a generator) | Refused when the activator is built, naming the option | V10 |
| BR-16 | `evaluator` is passed with `classifierModel`, `confidenceThreshold` or `enableLlmClassifier: false` | Refused when the activator is built. The message says those options configure the generator classifier the evaluator replaces | V10 |
| BR-17 | `skillEvaluator(model)` is called with a model string | Core resolves it when the block runs, through the flow's resolver (1554/BR-6 to BR-8, BR-29). The activator resolves nothing | V12 |
| BR-18 | `skillEvaluator(model)` is called with an evaluation model instance, or a generate-only one | Used as given; a generate-only instance is refused by core when the block is built (1554/BR-10) | V12 |
| BR-19 | Anything in `@flow-state-dev/orchestration` | Depends on core only. No Jev library, lab, provider package or model name (ER-9, ER-11) | V12 |

## Unchanged surfaces

| # | When | Then | Proved by |
|---|---|---|---|
| BR-20 | A seat of the built-in agent kind runs | As today, with `enableLlmClassifier` per seat. The kind offers no evaluator option (ER-11) | V13 |
| BR-21 | An evaluator ran for tier 3 | The trace shows its row nested under the activator: the options offered and the answer, with usage and model on the row (1554/BR-23, BR-24) | V14 |

## Failure taxonomy

Configuration mistakes are refused when the activator is built. Evaluator failures fail the
activator, once, with the evaluator's own error. Nothing retries, nothing falls back to the
generator classifier, and no number enters activation state that the model didn't return.

## Acceptance criteria this issue owns

- **ER-5**: the optional slot; slash, keyword and today's classifier unchanged with none; a passed
  evaluator's answer is final. BR-1 to BR-3, BR-8 to BR-12.
- **Leg (d) of ER-15**, supplied through FIX-1556's example: tier 3 activates the right skill
  through a passed evaluator, and with none passed slash and keyword resolve and no evaluator is
  built or resolved. BR-1, BR-8, VG.
- **The Linear ask**: keep slash and keyword; choice over the catalog's `description` and
  `whenToUse`; optional inject with no hard import of Jev, an evaluator or a lab; skills work
  without it. BR-1, BR-4, BR-19.
