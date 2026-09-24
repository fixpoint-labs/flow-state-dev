# FIX-1554 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs** · [Evolution](EVOLUTION.md)

The epic owns the shared prose: the new opening of the blocks page, "The five kinds" heading, and
the rule that every stated count says five ([epic DOCS](../../epics/FIX-1553/DOCS.md)). This issue
publishes those with the kind, and drafts its own material below. Code uses the builder names the
epic taught; if the implementation exports them from elsewhere, reconcile the imports here.

## UPDATE · `apps/docs/docs/fundamentals/blocks.md` · new `### Evaluator` after `### Generator`

> ### Evaluator — the questions you already know
>
> A generator asks a model to write. An evaluator asks it questions whose possible answers you
> already know, and hands back typed answers your code can branch on: which of these options,
> where on this scale, yes or no.
>
> ```ts
> import { evaluator, choice, score, boolean } from "@flow-state-dev/core";
>
> const triage = evaluator({
>   name: "triage",
>   model: "typesafe-ai/jev",
>   state: (input) => input.message,
>   questions: {
>     team: choice("Which team should handle this?", {
>       billing: "Payments and refunds",
>       technical: "Bugs and outages",
>     }),
>     frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
>     urgent: boolean("Does this need someone now?"),
>   },
> });
> ```
>
> The output is `{ answers }`, keyed by the question ids you chose. Each answer is typed by its
> question, so `answers.team.choice` is `"billing" | "technical"`, not `string`.
>
> | Question | Answer |
> |---|---|
> | `choice` | `choice`: one of your option keys. `probabilities` when the model gives a distribution |
> | `score` | `score`: a position between the first level (0) and the last. `probabilities` by level index when given |
> | `boolean` | `probability`: the model's estimate that the answer is yes |
>
> Any answer can also carry `confidence`, but only when the model reported one. Jev reports it
> for choice and score questions. The popular providers' evaluation models don't report it at
> all. When it's missing, the key is absent: the evaluator never fills it in. A boolean's
> `probability` is the model's estimate that the answer is yes. It isn't the model's confidence
> in that estimate, so don't gate on it as if it were.
>
> `state` is what the model looks at. Leave it out and the block's input is used as is. It can
> be a string, an array or a plain object. `questions` can also be a function of the input and
> the block context, when the options come from data: a catalog, a list of teams.
>
> The model has to be one that supports evaluation. A model that can only generate text is
> refused before the block makes any call, and the error says what to pass instead. See
> [Evaluation models](/docs/fundamentals/models#evaluation-models).
>
> An evaluator answers and stops. It doesn't retry, doesn't fall back to another model, and
> doesn't decide anything with the answer. Branching belongs to your code: a `router` that reads
> `answers.team.choice`, or a sequencer step that checks `answers.urgent.probability`. Evaluators
> are silent like handlers. What they asked and what came back shows up in the DevTool trace.

## UPDATE · `apps/docs/docs/configuration/blocks.md` · new `## Evaluator` after `## Generator`

> ## Evaluator
>
> `evaluator({ ... })` asks an evaluation model typed questions about one state and returns
> `{ answers }`.
>
> | Field | Type | Default | What it does |
> |-------|------|---------|--------------|
> | `model` | model string or evaluation model instance | required | Which model answers. A string resolves through the same providers and gateways as a generator's. Intents, arrays and `selectModel` aren't accepted. |
> | `questions` | map of `choice` / `score` / `boolean`, or `(input, ctx) => map` | required | The questions. Ids become the keys of `answers`. |
> | `state` | `(input, ctx) => string \| array \| object` | the input | What the model evaluates. |
> | `uses` | capability list | — | Resources, state and helpers. Capabilities don't supply an evaluator's model. |
>
> Scope schemas, `resources`, and the [shared fields](#shared-fields) work the same as on a
> handler. There is no `retry`: one call per run. When the call fails, the block fails like any
> other. To recover, use `.rescue` in a sequencer. It runs a recovery block you supply and uses
> that block's output in place of the failed one. It doesn't rerun the evaluator.

## UPDATE · `apps/docs/docs/fundamentals/models.md` · new `## Evaluation models` after "Gateways and fallback"

> ## Evaluation models
>
> An evaluator needs a model that supports evaluation, which is a separate capability from
> generating text. The AI SDK exposes it as `evaluationModel(...)` on providers that have it.
>
> Model strings resolve the way generator strings do. With the provider's package installed and
> its key set, the string goes to that provider directly. Otherwise it goes through a configured
> gateway. The difference is the door: the resolver asks for the provider's evaluation model,
> and if the provider or gateway has none, you get an error before anything is sent.
>
> ```ts
> evaluator({ name: "triage", model: "typesafe-ai/jev", questions });          // Jev, through Vercel's AI Gateway
> evaluator({ name: "triage", model: "openai/gpt-5.4-mini", questions });      // OpenAI's evaluation adapter
> evaluator({ name: "triage", model: openai.evaluationModel("gpt-5.4-mini"), questions });
> ```
>
> We recommend Jev through the gateway. It reports its confidence, which the other adapters
> don't, and routing code can use that to hand a doubtful case to a person.
>
> If you have your own Jev key, install Jev's provider library yourself and pass its model:
>
> ```bash
> pnpm add @ai-sdk/typesafe-ai
> ```
>
> ```ts
> import { typeSafeAi } from "@ai-sdk/typesafe-ai"; // reads TYPESAFE_AI_API_KEY
>
> evaluator({ name: "triage", model: typeSafeAi.evaluationModel("jev-latest"), questions });
> ```
>
> flow-state.dev never installs that library, and the string `typesafe-ai/jev` always goes
> through the gateway, even when the library is installed. The gateway and the library name the
> model differently, so a string that switched paths would switch models.
>
> Passing a text model, like `openai("gpt-5.4-mini")`, is refused when the block is built:
>
> ```text
> Evaluator "triage": the model can generate but not evaluate.
> Pass an evaluation model, e.g. openai.evaluationModel("gpt-5.4-mini"), or a model string.
> ```
>
> Evaluation doesn't use intents, fallback arrays or `selectModel`. An evaluator names one model.
>
> ### With a custom model resolver
>
> If you pass your own `modelResolver` to `createFlowState`, it resolves evaluator strings too,
> but only if it implements the optional `resolveEvaluationModel(modelId, blockName?)` method.
> Return an evaluation model from it, or throw to refuse the string.
>
> Without that method, an evaluator with a model string fails before any call, and the error
> names the missing method. flow-state.dev doesn't fall back to its own resolver, because that
> would use keys and gateways your app never configured. Passing an evaluation model instance
> still works, since there is nothing to resolve. Generators on your resolver are unaffected.

## UPDATE · `packages/core/README.md` · Exports → Main, and Types

> - `evaluator(config)` — a block that asks an evaluation model typed questions (`choice`,
>   `score`, `boolean`) about one state and returns `{ answers }`. Confidence appears on an answer
>   only when the model reported it. See [Blocks](https://flow-state.dev/docs/fundamentals/blocks).
> - `choice(instructions, options)` / `score(instructions, levels)` / `boolean(instructions, criteria?)`
>   — question builders for `evaluator`.
> - `EvaluatorAnswer`, `EvaluatorAnswers<Q>` — the answer types, for code that consumes an
>   evaluator's output.
> - `ModelResolver` gains an optional `resolveEvaluationModel(modelId, blockName?)`. A custom
>   resolver needs it only to resolve evaluator model strings.

The `BlockKind` line becomes `"handler" | "generator" | "evaluator" | "sequencer" | "router"`.

Under **Dependencies**, one line: `@ai-sdk/typesafe-ai` is an optional peer, needed only to pass
Jev's model directly.

## UPDATE · the count everywhere it is stated

The epic's rule, run as V8 in [PLAN.md](PLAN.md#checks). No page is copied here.

## CREATE · `.changeset/evaluator-block-kind.md`

> `minor` for `@flow-state-dev/contracts`, `core`, `engine`, `testing`, `devtool`, `fsdev`.
>
> New core block kind: `evaluator` (FIX-1554). It asks an evaluation model typed questions (`choice`,
> `score`, `boolean`) and returns typed answers, with the model's confidence when it reports one.
> Model strings resolve through your existing providers and gateways; models that can only
> generate are refused before any call. `BlockKind` and the trace's `blockKind` gain
> `"evaluator"`: code that switches on block kind should handle it. `ai` minimum raised to the
> first release with evaluation. `@ai-sdk/typesafe-ai` is an optional peer. `ModelResolver` gains
> an optional `resolveEvaluationModel`; a custom resolver without it runs generators as before
> and refuses evaluator model strings.

## Ownership

The teaching guide, the cascade and the activator option are other children's
([epic DOCS → Ownership](../../epics/FIX-1553/DOCS.md#ownership)). The guide links to the
`### Evaluator` section above. Voice rules most at risk here: em-dashes in the answer table, and
"This…" sentence openers in the confidence paragraph.
