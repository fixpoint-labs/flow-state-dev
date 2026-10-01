# Blocks

Exactly five block kinds: **handler**, **generator**, **evaluator**, **sequencer**, **router**. How to author each is in the user docs ([Blocks](../../apps/docs/docs/fundamentals/blocks.md), [Block options](../../apps/docs/docs/configuration/blocks.md)); full signatures are the published types in `@flow-state-dev/core`. This page holds the rules the types don't show.

## Execution contract

- Every execution path invokes a block through `block.run(input, ctx)`. Never call `block.config.execute` directly; it skips the framework's wrapping (validation, tracing, retries, hooks).
- Tools run the same way: a generator compiles tool blocks (of any kind) into provider tool definitions and invokes `tool.run(args, ctx)`.
- Blocks are **silent by default**. Nothing reaches the client or the LLM unless a block emits it, or a generator has `itemVisibility` set.
- A router's selected block runs with the router's own input, via `selected.run(input, ctx)`.

## Context resolution

- `ctx.sequencer` is the nearest enclosing sequencer on the execution stack, or `undefined`. Tool blocks inherit the chain: a tool inside a generator inside a sequencer sees that sequencer.
- `getTarget(name)` resolves nearest-first in two passes: (1) already-dispatched siblings at the current execution level, most recent dispatch wins; (2) the ancestor chain. An unresolvable tie among ancestors throws `AmbiguousBlockNameError`. `ctx.targets.<name>` (typed by `targetStateSchemas`) uses the same lookup and is always `| undefined`, because availability depends on topology.
- `getBlockOutput(block)` / `getBlockResult(block)` resolve **only** against already-dispatched siblings at the current level. They do not walk the ancestor chain. They take a block-definition reference, not a name.
- `ctx.request.tokenUsage` aggregates by model from emitted generator `block_trace.modelUsage`; `costEstimate` exists only when the flow configures a `costEstimator`.

### Naming

Names are flow-scoped, not unique. Duplicates are allowed; lookup cascades inner-to-outer, and only a same-precedence collision raises `AmbiguousBlockNameError`. Runtime identity is `blockInstanceId`, never `name`.

## Schema and resource bubbling

- Handler, generator and router blocks may declare `sequencerStateSchema`. It bubbles to the enclosing sequencer exactly as request/session/user/org schemas bubble to the flow. A sequencer's own `stateSchema` must be structurally compatible with what its children declare.
- Sequencer instance state initialises from `defaultState`, else from schema defaults. A mutation emits a `state_change` item with `scope: "block_instance"` and the sequencer's `blockInstanceId` in provenance.
- Resource declarations (`resources` map → `declaredResources`) are collected by sequencers from every child and merged by `defineFlow` from every reachable block, **including blocks reachable only through a generator's static `tools` array**. A function-valued `tools` slot resolves per call, so its tools' declarations are *not* collected; such a tool's resources must be declared somewhere static. Merge rules: [Resources and Client Data](./resources-and-client-data.md).

## Generator

- Message assembly order: `prompt` → `context` → `history` → `user`. Context object-form aggregation, tag normalisation and reserved names: [Generator context](../../apps/docs/docs/advanced/generator-context.md). Prompt files: [Prompts as Markdown](../../apps/docs/docs/advanced/generator-prompts-markdown.md).
- Text output (default `z.string()`) streams and auto-emits a `message`. Custom `outputSchema` uses `generate()` and validates; `repair.mode` is `'auto'` (retry) / `'rescue'` / `'fail'`.
- Auto-emission happens **only when `itemVisibility` is set**. Unset means the generator emits nothing but its `block_trace`.

### Text across steps

How text from several model steps is joined depends on the path that runs the turn. A turn streams only when its output is text, it has tools or `itemVisibility`, and the model has `streamStep` or `stream()`. Every other turn, including every structured-output turn, does not stream.

| Path | Joining |
|---|---|
| Owned streaming (`streamStep`; the built-in AI SDK adapter and fallback groups over it) | Each step that writes text after earlier text opens with `\n\n`, in the deltas, the `message` item and the return value alike |
| Owned, not streaming (`generateStep`) | Text turn: same joined text as owned streaming. Structured turn: **final step's text only**, so pre-tool-call chatter can't corrupt a JSON answer |
| Legacy streaming (`stream()`, no `streamStep`) | Exactly what the model streams; no break added, even if `generateStep` exists (it only runs non-streaming turns) |
| Legacy, not streaming (no `generateStep`) | Whatever `generate({ maxSteps })` returns |

On both owned paths a step with no text adds nothing, and a turn resumed after a suspension starts its text at the resumed step: pre-suspension steps seed the conversation but are not replayed into the output.

## Evaluator

One `experimental_evaluate` call that answers typed questions and returns `{ answers }`. User-facing behaviour: [Evaluator](../../apps/docs/docs/fundamentals/blocks.md#evaluator).

- **Model fence.** An evaluation-model instance is used as given. A language model or FSD generator model is refused at build; so are intents, fallback arrays and `selectModel`. A model string resolves at first execution through the optional `ModelResolver.resolveEvaluationModel` hook. `createModelResolver` implements it with generator precedence (explicit provider → installed-and-keyed package → gateway) against each source's `evaluationModel(id)`. If an app's own resolver lacks the hook, the string is refused by name; the framework never substitutes its default resolver.
- **One seam.** `packages/core/src/models/evaluate.ts` is the only importer of the SDK's evaluation types. It calls with `maxRetries: 0` and the request's abort signal. `confidence` comes only from `providerMetadata.typesafe.confidence[id]`; a boolean's `probability` is never copied into it.
- **No policy inside.** No retry, fallback or gating. Branching belongs to routers and sequencer steps; recovery to `.rescue`.

## Sequencer trace values

Each DSL method writes a `BlockValue` of a fixed kind on its `block_trace` (union and resolution in [Items](./items.md)). "Passthrough" leaves the running descriptor unchanged: the last `ref` / `inline` / `structure` stays in effect.

| `block_trace` kind | Methods |
|---|---|
| `ref` → child's item | `step`, `stepIf` (when taken; carries the prior descriptor when skipped), `doUntil` / `doWhile` (final iteration), `rescue` (branch taken), `branch`, `stepAny`, `race` (winner) |
| `inline` | `map`; every generator and handler (leaves) |
| `structure` | `parallel` (object of refs), `forEach` / `stepAll` (array of refs) |
| passthrough | `forEachSideChain`, `loopBack`, `sideChain`, `waitForSideChain`, `tap`, `tapIf`, `exitIf` |

Routers always emit `ref` to the selected route. Method semantics: [Sequencer DSL](./sequencer-dsl.md).

## Visibility

Item visibility is a pure function of `(item.type, item.itemVisibility)`; the full model is in [Items → Visibility](./items.md#visibility). Two block-level defaults to know: there is **no position-inferred default** for a generator (each declares its own), and a handler-emitted `ctx.emit.message` without `itemVisibility` defaults to `{ client: true, history: true }`. `agentName` defaults to the block name; generators sharing one represent one logical agent.
