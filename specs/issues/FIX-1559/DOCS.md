# FIX-1559 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic gives this issue the evaluator option on the activation page
([epic DOCS → Ownership](../../epics/FIX-1553/DOCS.md#ownership)). The teaching guide is
FIX-1556's and links to the section below. Imports follow FIX-1554's drafted exports; reconcile
them to what shipped. Voice rules most at risk: sentences opening on "This", em-dashes between
clauses, and mentioning the generator classifier as "old" (outsider rule: say what each does).
No other page changes: `adding-skills-to-your-app.md` stays on the default path, and the built-in
worker page is untouched because the stock kind gets no option.

## UPDATE · `apps/docs/docs/skills/activation.md` · "Three tiers", item 3

Replace the third list item with:

> 3. **Classifier.** Looks at the skill descriptions and decides whether any apply. Runs only when
>    tiers 1 and 2 didn't resolve. By default an `intent/utility` generator with structured output
>    does this; it can match several skills, each kept only above a confidence threshold (default
>    0.65). Pass an [evaluator](#tier-3-with-an-evaluator) and it picks instead.

## UPDATE · same page · new `### Tier 3 with an evaluator` after "Three tiers"

> ### Tier 3 with an evaluator
>
> An [evaluator](/docs/fundamentals/blocks#evaluator) is a block that asks an evaluation model a
> question with known answers. Give the activator one, and tier 3 asks it: which of these skills
> fits the message, or none?
>
> ```ts
> import { createSkillActivator, skillEvaluator } from "@flow-state-dev/orchestration";
>
> export const skillActivator = createSkillActivator({
>   initialSkills,
>   evaluator: skillEvaluator("typesafe-ai/jev"),
> });
> ```
>
> `skillEvaluator` takes any model an evaluator accepts: a model string, or an evaluation model
> such as `openai.evaluationModel("gpt-5.4-mini")`. See
> [Evaluation models](/docs/fundamentals/models#evaluation-models).
>
> The activator offers the model the same skills the default classifier would see: the ones this
> binding allows, minus any with `disableModelInvocation`, up to `maxSkillsInClassifier`, each
> described by its `description` and `whenToUse`. It adds a "no skill" option, so the model never
> has to force a match. If the catalog is empty, no call is made.
>
> What you get back is one skill or none. The model's pick is final:
>
> - A pick activates that skill with `source: "classifier"`. Its `confidence` is the model's own
>   number when the model reports one (Jev does), and missing when it doesn't (the OpenAI and
>   Anthropic evaluation models don't). The activator doesn't compare it to a threshold, so
>   `confidenceThreshold` is not accepted alongside `evaluator`.
> - "No skill" activates nothing.
> - An error fails the activator, the same way a failed default classifier does. It doesn't fall
>   back to the default classifier. If you'd rather the turn go on without a skill, wrap the
>   activator in [`.rescue`](/docs/sequencers/composing-blocks).
>
> Two things work differently from the default classifier. It activates at most one skill per
> turn; keyword matches can still activate several. And it can't pull an argument out of the
> message, so `input` is empty. A slash command is still how a user passes `$ARGUMENTS`.
>
> To name the block yourself, change what it evaluates, or give it `uses`, build it from
> `skillQuestions`:
>
> ```ts
> import { evaluator } from "@flow-state-dev/core";
> import { skillQuestions } from "@flow-state-dev/orchestration";
>
> const pickSkill = evaluator({
>   name: "pick-skill",
>   model: "openai/gpt-5.4-mini",
>   state: (input) => input.message,
>   questions: skillQuestions,
> });
>
> createSkillActivator({ initialSkills, evaluator: pickSkill });
> ```
>
> The activator passes the block `{ message, skills }` and reads its `skill` answer. A block that
> asks a different question fails the activator with an error that says so.

## UPDATE · same page · "Options" code block

Add after `enableLlmClassifier`:

> ```ts
>   // Use an evaluator for tier 3 instead of the default classifier. Can't be
>   // combined with classifierModel, confidenceThreshold or enableLlmClassifier: false.
>   evaluator: skillEvaluator("typesafe-ai/jev"),
> ```

## UPDATE · `packages/orchestration/README.md` · "Skills and delegation", after the first example

> The up-front activator, `createSkillActivator`, picks skills before the generator runs: slash,
> then keywords, then a classifier. Pass `evaluator: skillEvaluator(model)` to run that last tier
> on an evaluation model. It picks one skill or none, and its answer is final.
> `skillQuestions` builds the same question for an evaluator you construct yourself. See
> [Activation paths](https://flow-state.dev/docs/skills/activation).

## Changeset (not published docs)

> `@flow-state-dev/orchestration` minor: `createSkillActivator` takes an optional `evaluator` for
> tier 3, with `skillEvaluator(model)` and `skillQuestions` to build one. Without it, activation is
> unchanged.
