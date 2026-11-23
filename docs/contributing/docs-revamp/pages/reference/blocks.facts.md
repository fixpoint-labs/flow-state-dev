# Facts for Blocks (R-01, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading the implementation and no test or exported doc comment pins it, it is marked **[source]**; where a test pins it, **[test]**; where an existing user doc states it and the code agrees, **[doc]**. **[ran]** marks something I ran this session against the real code (throwaway probe tests, deleted afterwards; nothing left in the tree). Nothing was run against a deployed server or a live model.

Paths are from the repo root. Abbreviations:

- Core, `packages/core/src/`: `blk` = `types/block.ts`, `ft` = `types/flow.ts`, `evt` = `types/evaluation.ts`, `bb` = `blocks/internal/build-block.ts`, `hd` = `blocks/handler.ts`, `gen` = `blocks/generator.ts`, `ev` = `blocks/evaluator.ts`, `rt` = `blocks/router.ts`, `sq` = `blocks/sequencer.ts`, `sm` = `blocks/sequencer-methods.ts`, `ss` = `blocks/internal/sequencer-state.ts`, `tc` = `blocks/tool-cache.ts`, `ctc` = `blocks/internal/cache-tool-call.ts`, `te` = `blocks/internal/tool-executor.ts`, `bu` = `blocks/internal/utils.ts`, `cm` = `capability/merge.ts`, `ct` = `capability/types.ts`, `ts` = `helpers/transient-slot.ts`, `rue` = `errors/route-unavailable-error.ts`, `soe` = `errors/sequencer-output-schema-error.ts`, `eva` = `models/evaluate.ts`
- Engine, `packages/engine/src/`: `eb` = `execution/executeBlock.ts`, `rty` = `execution/retry.ts`, `cec` = `context/createExecutionContext.ts`, `sc` = `stores/state-container.ts`, `se` = `context/scope-emit.ts`, `rv` = `streaming/recorded-value.ts`, `rr` = `context/resource-registry.ts`, `fe` = `errors/flow-error.ts`
- Other: `tb` = `packages/orchestration/src/task-board/index.ts`, `fpw` = `packages/orchestration/src/task-board/flow-policy-wiring.ts`, `rb` = `packages/fsdev/src/resolve-block.ts`, `mi` = `packages/contracts/src/types/model-identity.ts`
- Tests: `bst` = `packages/engine/test/block-state.test.ts`, `ext` = `packages/engine/test/execution.test.ts`, `sst` = `packages/engine/test/suspend-for-user.test.ts`, `sbb` = `packages/engine/test/sequencer-state-bubbling.test.ts`, `scp` = `packages/engine/test/sequencer-checkpoint.test.ts`, `rvt` = `packages/engine/test/recorded-value-limit.test.ts`, `btl` = `packages/engine/test/block-trace-lifecycle.test.ts`, `rpr` = `packages/engine/test/retry-p-retry.test.ts`, `brs` = `packages/engine/test/block-rescue.test.ts`, `tet` = `packages/core/test/blocks/tool-executor.test.ts`, `rtt` = `packages/core/test/router.test.ts`, `rrt` = `packages/core/test/blocks/router-replay.test.ts`, `evt-t` = `packages/core/test/evaluator.test.ts`, `evj` = `packages/core/test/evaluator-typesafe-direct.test.ts`, `tst` = `packages/core/test/transient-slot.test.ts`, `cbi` = `packages/core/test/capability-block-integration.test.ts`, `bbt` = `packages/core/test/build-block.test.ts`, `ttt` = `packages/orchestration/test/task-board/task-board-tool-cache.test.ts`
- Existing user docs, `apps/docs/`: `cfg` = `docs/configuration/blocks.md`, `fb` = `docs/fundamentals/blocks.md`, `bs` = `docs/advanced/block-state.md`, `sqs` = `docs/advanced/sequencer-state.md`, `stp` = `docs/advanced/state-targets-and-parents.md`, `mem` = `docs/advanced/block-memoization-and-replay.md`, `its` = `docs/streaming/items.md`, `mod` = `docs/fundamentals/models.md`, `rwe` = `guides/routing-with-evaluators.md`

Other sheets in `docs/contributing/docs-revamp/pages/` were read for leads (they carry R-02, R-03, R-05, R-17, R-22 rows). Nothing below is cited to them; each fact was re-verified against the code, a test or an existing doc.

## 0. What the page is

A Reference page for the five block kinds: tables and lookups, no narrative, no word budget. The plan names five tables (fields every block takes; options per kind; block state and sequencer state; state targets and parents; what a block may return) and three lookups ("Which fields are required on a handler?", "What does a router do when no route matches?", "Where does a block's own state live, and who can read it?"). The three answers are in section 12.

Imports the page's rows name, all from `@flow-state-dev/core` unless noted: `handler`, `generator`, `evaluator`, `sequencer`, `router`, `choice`, `score`, `boolean`, `transientSlot`, `createToolCacheCapability`, `bindToolCacheStore`, `createInMemoryToolCacheStore`, `FlowError`, `RouteUnavailableError`, `SequencerOutputSchemaError`, `SequencerSchemaMismatchError`; types `BlockDefinition`, `BlockContext`, `StateRef`, `RetryPolicy`, `RescueHandlerSpec`, `BlockCacheableConfig`, `ToolLifecycleEvent`, `GeneratorCompletedMeta`. `ctx.*` is the context a block's `execute` receives. `index.ts:57-59` (tool cache), `:183` (`transientSlot`), `:255` (`GeneratorCompletedMeta`), `:303` (`ToolLifecycleEvent`), `:429-434` (errors); `types/index.ts:2,21,25,26`.
`AmbiguousBlockNameError` (code `ambiguous_block_name`) is not exported from `@flow-state-dev/engine` or core (a search of `engine/src/index.ts` and `core/src/index.ts` finds no export); the page names its `code`, not the class.

## 1. Fields every block takes

### 1a. What a built block exposes (the "kind, name, run" row)

`handler()`, `generator()`, `evaluator()`, `router()` and `sequencer()` each return a `BlockDefinition`. `blk:1206-1352`.

| Member | Type | Fact | Source |
|---|---|---|---|
| `kind` | `"handler" \| "generator" \| "evaluator" \| "sequencer" \| "router"` | Exactly five kinds. | `blk:43`, `:1212` |
| `name` | `string` | The config's `name`. | `blk:1213`; `bb:268` |
| `description` | `string \| undefined` | The config's `description`. | `bb:269` |
| `transient` | `boolean` | `true` only when the config says `transient: true`; otherwise `false`. | `bb:224`, `:270` |
| `inputSchema`, `outputSchema` | Zod schema | The config's, or `z.any()` when left off. On a sequencer with steps, `block.outputSchema` and `block.config.outputSchema` both hold the last step's schema, declared or not, while `inputSchema` is the declared one or else the first step's (`sq:1326-1331`); the declared one is used only for the check (`sq:1252-1254`, `wrapWithOutputValidation(..., config.outputSchema)`) and is not readable from the block. With no steps, the declared one (else `z.any()`) shows (section 4d). | `bb:210-211`; `sq:1265-1268` **[ran]** (`ZodAny` on a handler with neither) |
| `config` | the config | The config as built, with `inputSchema` and `outputSchema` filled in. | `bb:213-217` |
| `declaredResources`, `ownDeclaredResources` | map | All resources the block and everything under it declare, and only the block's own. | `blk:1219-1231` |
| `childBlocks`, `staticTools`, `dispatch` | read-only | Structure the flow build walks. Nothing executes through them. Not a surface a reader sets. | `blk:1248-1269` |
| `.connectInput(fn)`, `.connectOutput(fn)`, `.mapModelOutput(fn)`, `.rescue(handlers)`, `.as(opts)`, `.asTool(opts)` | methods | Each returns a new block. See section 1c. | `blk:1271-1352` |
| `run(input, ctx)` | **runtime view only** | Not on the public `BlockDefinition` type. Calling `block.run(...)` from user code is a type error; the framework runs a block as an action, a step, a route or a tool. | `blk:1195-1204`, `:1376-1390` |

- A block is recognised by `fsdev block <file>` when its default export has `kind` (one of the five), `name`, and a `run` function. A file that fails is refused with exit 4 and one of: `Block file not found: <path>`, `Failed to import block file: <message>`, `Block file has no default export: <path>`, `Default export is not a valid BlockDefinition (must have kind, name, and run): <path>`. `rb:15-81`. The CLI page owns the exit codes; this row only says what counts as a block. (The `resolveBlock` doc comment says exit 2; the code throws `EXIT_DISCOVERY_ERROR`. The CLI page's sheet pins 4 with `resolve-block.test.ts`.)
- A block must have a non-empty `name`: `Cannot build "<kind>" block without a non-empty "name"`. A handler built with no `execute`: `Cannot build "<name>" (<kind>) without an execute function`. `bb:202-208` **[ran]** (a blank name and a handler with no `execute`).

### 1b. Config fields shared by blocks

Applicability: H handler, G generator, E evaluator, S sequencer, R router. "Read" says where the framework reads the field at run time; a field the type accepts and the framework never reads is marked.

| Field | Type | Default | Kinds | Fact | Source |
|---|---|---|---|---|---|
| `name` | `string` | required | H G E S R | Block id, used in traces, items and DevTool. Non-empty. Names are **not** checked for uniqueness in a flow or a sequencer (two same-named blocks in one chain build). Name collisions are refused in two places: two different blocks with one name in a router's `routes` (section 4e), and in one generator's tool list (R-02). | `blk:1056`; `bb:202-204`; **[ran]** (a sequencer with two steps both named `dup` builds) |
| `description` | `string` | none | H G E S R | Human description. | `blk:1057`; `sm:471` |
| `inputSchema`, `outputSchema` | Zod | `z.any()` | H G E R; S has `inputSchema` and `outputSchema` (section 4d) | Left off means nothing is checked. A generator's default `outputSchema` is `z.string()`, not `z.any()`. An evaluator takes no `outputSchema`. | `bb:210-211`; `gen:2865`; `ev:341` |
| `stateSchema` | Zod object | none | H G E S R | The block's own state, read as `ctx.self` (section 8). | `blk:1061`; `hd:92` |
| `flowConfigSchema` | Zod | none | H G E S R | What this block requires of the flow copy's settings bag; types `ctx.flow.config`. Refusal rules are on the flows page. | `blk:1115`; `sm:470`; `sq:1244-1249` |
| `transient` | `boolean` | `false` | H G E S R | The block's own `block_trace` item and its `container` item are `transient` (streamed live, not kept in the request's items). Items the block emits itself with `ctx.emit.*` are not affected; each takes its own `{ transient }`. | `cec:3872`, `:4585`; `btl:528` **[test]**; `its` **[doc]**; items sheet 5.3, 5.4 |
| `connectInput` | `(input, ctx) => nextInput` | none (identity) | H G E R; on S it is a method | Runs before the input check. The block's `inputSchema` then checks the connector's output. | `bb:336-356`; **[ran]** (a connector returning `{ n: "bad" }` fails `Block "h" input validation failed at "n"`) |
| `activeStatusMessage` | `string` or `(input, ctx) => string` | none | H G E S R | Calls `ctx.emit.status(message)` when the block starts. A sequencer's function receives the sequencer's `ctx`. | `blk:1075`; `sm:500`; resolver `blocks/internal/resolve-active-status-message.ts:1-30`; called by `eb:68` |
| `container` | `{ component?, label?, metadata? }`; `label` and `metadata` may be functions of the input | none | typed on H G E R S; **honoured only on S and R** | A `container` item wraps the block's items. A handler, generator or evaluator that sets it emits none. | `eb:236-240`; `sq:651-655`; **[ran]** (a handler with `container` emitted 0 container items, a sequencer emitted 1) |
| `retry` | `RetryPolicy` | none | H G R | Applies when the block is the action's root block (section 6); a step, a route or a tool runs once whatever its `retry`. To retry, the root carries the policy (for a sequencer root, which has no `retry` field, the `retry` option of `runAction`, `execution/types.ts:140`), and it reruns the whole root; or a `rescue` catches the failure. The engine's `executeBlock` also reads `block.config.retry` for a block run at the top of a view, a reactive resource dispatch or an observer (`runView.ts:349`, `reactive-dispatch.ts:294`, `runAction.ts:834`); the page does not cover those. | `blk:1082`; `eb:423-426`; `sm:456-505` (no `retry` in `SequencerConfig`) |
| `rescue` | `RescueHandlerSpec[]` | none | H G E R | A recovery block for this block (section 5c). A sequencer uses `.rescue()` on its chain. | `blk:1093`; `bb:396-411` |
| `cacheable` | `true` or `BlockCacheableConfig` | off | H G R | Applies only when the block is a tool of a generator, and only when a cache store is in scope (section 7). | `blk:1130`; `te:84-110`, `:264-349` |
| `onCompleted`, `onErrored` | hooks | none | H G E R (not S) | Section 5. | `blk:1079-1080`; `sm:456-505` (no hook field on a sequencer) |
| `validateChunk` | fn | none | typed on H G R | **Declared and never read.** A search of `core/src` and `engine/src` finds the field only in `types/block.ts` and the evaluator's `Omit`. Leave it off the page. | `blk:1078`; `ev:341` **[source]** |
| `uses` | capability list; an entry may be `(ctx) => CapabilityRef[]` | none | H G E S R | Installs capabilities. Owned by the capabilities page. | `ct:595-607`; `hd:109`; `sm:493` |
| `resources` | map | none | H G E R (a sequencer has no `resources` field; its capabilities' resources count) | Resources the block declares; they reach the flow without being repeated. | `hd:104`; `sq:1196`, `:2607` |
| `requestStateSchema`, `sessionStateSchema`, `userStateSchema`, `orgStateSchema` | Zod | none | H G E R | Type `ctx.request.state`, `ctx.session.state`, `ctx.user.state`, `ctx.org.state`. The engine reads none of them (a search of `engine/src` finds no use); what is stored is the flow's own `session`, `user` and `org` `stateSchema`. | `hd:84-87`; **[source]** |
| `sequencerStateSchema` | Zod object | none | H G E R | What the block expects of `ctx.sequencer`; merged into the nearest sequencer's state at build (section 9d). | `ss:130-153` |
| `parentInputSchema` | Zod | none | **H and E only** | Types `ctx.parent.input`. Not validated at run time; a search finds no read. A generator or router types it `unknown`. | `hd:89`; `ev:379`; **[source]** |
| `parentStateSchema` | Zod | none | H G E R | Types `ctx.parent`'s state operations. Not validated at run time. | `hd:96`; `blk:421-426` |
| `targetStateSchemas` | map name → Zod | none | H G E R | Types `ctx.targets.<name>`. Not validated at run time (section 10). | `hd:106`; `cec:4199-4212` |

### 1c. Methods on a built block

| Method | Fact | Source |
|---|---|---|
| `.connectInput(fn)` | Returns a block whose connector runs first and whose original `inputSchema` still checks the connector's output. | `bb:416-422`; **[ran]** |
| `.connectOutput(fn)` | Maps the block's result before it is returned. The returned block has `outputSchema: z.any()`, **no `onCompleted`** and no model-output mapper: the original `outputSchema` and `onCompleted` are dropped. | `bb:535-557`; **[ran]** (`outputSchema` `ZodAny`; the original `onCompleted` did not fire) |
| `.mapModelOutput(fn)` | Sets the string a model reads as a tool's result. Owner: R-02. | `blk:1294`; `bb:423-427` |
| `.rescue(handlers)` | Replaces the block's rescue handlers (section 5c). Available on every kind; on a sequencer it recovers the whole sequencer. | `blk:1352`; `bb:428-444` |
| `.as({ name?, description? })` | A copy under a new name or description. Blank `name` is refused when the copy is built. Owner of the detail: R-02. | `blk:1336`; `bb:445-462` |
| `.asTool(opts?)` | Wraps a block so a sequencer step emits a `tool_output`. `opts`: `itemVisibility`, `agentName`. Owner: R-02. | `blk:1311`; `bb:464-533` |

## 2. Required fields

| Kind | Required | Source |
|---|---|---|
| handler | `name` (non-empty) and `execute`. Everything else is optional, including both schemas. | `hd:110`; `bb:202-208`; **[ran]** |
| generator | `name`, `prompt`; `model` unless a capability in `uses` supplies one. Missing on both throws when the generator is built: `Generator "<name>" requires a model. Set one on the block or via a capability that contributes \`model\`.` | `gen:2907-2913`; `gen:599-614` |
| evaluator | `name`, `model`, `questions`. | `ev:349-351` |
| sequencer | `name`. | `sm:460` |
| router | `name`, `routes`, `execute`. | `rt:134` |

## 3. Options per kind

### 3a. Handler

`handler({ name, execute, ...})` is the kind that runs code. Accepts every field in section 1b except `validateChunk` (never read). Fields specific to it:

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `execute` | `(input, ctx) => output \| Promise<output>` | required | Called with the input after the connector and input check. The framework calls it with `(input, ctx)` only. | `hd:110-118`; `bb:195-200` |
| `parentInputSchema`, `parentStateSchema`, `targetStateSchemas`, scope schemas, `resources`, `uses` | | none | Section 1b. | `hd:83-109` |

`handler.withDefaults({ sessionStateSchema, userStateSchema, orgStateSchema, requestStateSchema, sequencerStateSchema, resources, outputSchema, uses })` returns a handler constructor with those fields preset; a per-call field wins. `hd:183-318`.

### 3b. Generator

Mirror of the generator options on the Generators page (R-02), which owns behaviour; rows here are name, type and default. Each cited to `gen`.

| Field | Type | Default | Source |
|---|---|---|---|
| `prompt` | string, function, array of those, `PromptFile` slot, or a whole `PromptFile` | required | `gen:608-611` |
| `model` | model id, intent, array, resolver or selection | required unless a capability supplies one | `gen:599` |
| `user`, `context`, `history` | slots; `history` is `true`, an item query or a slot | none | `gen:612-614` |
| `tools` | tool list or `(input, ctx) => tools` | none | `gen:613-614` |
| `uses` | capability list | none | `gen:566-569` |
| `itemVisibility` | `{ client, history }` | unset: no auto-emission | `gen:570-585` |
| `agentName` | `string` | the block's `name`, only when `itemVisibility` is set | `gen:586-593` |
| `search`, `providerTools` | search config; provider tools | none | `gen:619-621` |
| `loop` | `{ maxIterations?, runTools?, answerOnLastStep? }` | none | `gen:402-412`, `:622` |
| `maxIterations` | `number` | 8; `loop.maxIterations` wins; minimum 1 | `gen:108`, `:1223-1226` |
| `maxTokens` | `number` | none | `gen:624` |
| `repair` | `{ mode?, maxAttempts?, coerce? }` | mode `"auto"`, `maxAttempts` 1, coercion on | `gen:1081-1082`, `:369-387` |
| `repairOutput` | function | built-in deterministic pass | `gen:626-631` |
| `flowTools` | `ToolsConfig` | the flow's `tools` | `gen:632` |
| `retry` | `RetryPolicy` | none; **read only when the generator is the action's root block** (section 6) | `gen:633`; `eb:423-426` |
| `providerOptions` | options or resolver | none | `gen:634` |
| `caching` | config or resolver | `{ enabled: true, breakpoints: "auto", ttl: "5m" }` | `gen:646` |
| `describeTools` | `boolean` | `true` | `gen:647-648`, `:3088` |
| `onCompleted` | `(output, ctx, meta) => void` | none | `meta.model` is the resolved `ModelIdentity` (`actual`, optional `requested`, optional `gateway`). | `gen:543-548`, `:477` (meta); `mi:17-45`; `core/test/generator-completed-meta.test-d.ts:1-40` **[test]** |

- With no `outputSchema` a generator returns text and its output schema is `z.string()`. `gen:2865`.
- A reachable `z.record` or non-literal union in a declared `outputSchema` is refused when the generator is built. `gen:2862-2864` (the message is R-02's).
- A generator does not take `parentInputSchema`. `gen` has none (search).

### 3c. Evaluator

`evaluator({ name, model, questions, ... })` asks an evaluation model typed questions about one state and returns `{ answers }`. `ev:1-23`, `:437-544`.

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `model` | a model string or an evaluation model instance | required | A string resolves at first run through the app's model resolver's `resolveEvaluationModel` hook. Not accepted: an intent (`"intent/..."`), an array, a `selectModel` function, a capability that supplies a model. | `ev:349`, `:143-171` |
| `questions` | map id → `choice` / `score` / `boolean`, or `(input, ctx) => map` | required | The ids become the keys of `answers`. | `ev:351-363`, `:72-107` |
| `state` | `(input, ctx) => string \| array \| plain object` | the block's input | What the model reads. | `ev:364-375`, `:206-212` |
| `onCompleted`, `onErrored`, `rescue`, `connectInput`, `resources`, `uses`, scope schemas, `parentInputSchema`, `parentStateSchema`, `targetStateSchemas`, `stateSchema`, `flowConfigSchema` | | | As on a handler. | `ev:341-402` |
| no `outputSchema`, `retry`, `cacheable` (the page no longer names `validateChunk`) | | | The evaluator's config type omits them. | `ev:341` |

Question builders: `choice(instructions, options)` (option key to description or `null`; at least one option), `score(instructions, levels)` (at least two levels), `boolean(instructions, criteria?)`. `ev:72-107`.

Refusals, each a plain `Error` that starts `Evaluator "<name>": `:

| When | Message | Source |
|---|---|---|
| Built with a model that can generate but not evaluate | `the model can generate but not evaluate.` then a new line `Pass an evaluation model, e.g. openai.evaluationModel("gpt-6-luna"), or a model string.` | `ev:160-166`; `evt-t:101-116` **[test]**; **[ran]** |
| Built with an intent, array or `selectModel` | `"<model>" is an intent. An evaluator takes one model, not an intent, a fallback list or selectModel.` (for an intent string), `an evaluator takes one model, not an intent, a fallback list or selectModel.` (array or function) | `ev:143-158`; `evt-t:118-137` **[test]** |
| Built with a value that is neither a string nor an evaluation model | `model must be a model string or an evaluation model, e.g. openai.evaluationModel("gpt-6-luna").` | `ev:167-170` |
| Questions empty, a choice with no options, a score with fewer than two levels | `questions must contain at least one question.` / `question "<id>" is a choice with no options.` / `question "<id>" is a score with fewer than two levels.` Built-in questions are checked at build; a `questions` function is checked at each run, before any call. | `ev:174-197`; `evt-t:203-221` **[test]** |
| `state` returns something that is not a string, array or plain object | `the evaluated state must be a string, an array or a plain object (got <type>).` Checked before any provider call. | `ev:206-212`; `evt-t:281-296` **[test]** |
| A model string and the resolver has no `resolveEvaluationModel` hook | `cannot resolve model string "<id>": the app's model resolver has no resolveEvaluationModel hook. Add resolveEvaluationModel to the resolver, or pass an evaluation model instance.` Checked at the first run, before any call. Nothing falls back to another resolver or a generate call. | `ev:220-238`; `evt-t:439-446` **[test]** |
| A capability in `uses` contributes a `model` | Refused when built: `declares model ... only valid on generator`. A capability that contributes resources installs. | `evt-t:140-154` **[test]** |
| The model does not support a question's type | Refused before any provider I/O, naming the type. | `evt-t:298-304` **[test]** |

Behaviour:
- One provider call per run. No retry, no fallback, no gating. A failed call fails the block, with the provider's message. To recover, use `.rescue` in a sequencer. `ev:422-435` (doc comment); `evt-t:379-399` **[test]**.
- Output is `{ answers }`; each answer is typed by its question: `choice` answers `{ type: "choice", choice, probabilities?, confidence? }`, `score` answers `{ type: "score", score, probabilities?, confidence? }` (`score` is a position from 0 to levels minus 1, may be fractional; `probabilities` keyed by level index), `boolean` answers `{ type: "boolean", probability, confidence? }` where `probability` is the model's estimate that the answer is yes, not its confidence. `evt:77-111`.
- Not re-validated at run time: the SDK checks every answer. The output schema is a type only. `ev:403-412`.
- `confidence` is on an answer only when the model reported one; the key is **absent** otherwise, never a number the framework fills in. The only place it is read is the model's provider metadata `typesafe.confidence[questionId]`, copied for a question with a finite number; a boolean answer never carries it for Jev. `eva:55-100`; `evt-t:307-343` **[test]**; `evj:42-75` **[test]**.

| Model | Reports `confidence` | Source |
|---|---|---|
| Jev (`typesafe-ai/jev`) | Yes, on `choice` and `score` answers; not on `boolean` | `evj:42-75` **[test]**; `mod` "We recommend Jev ... It reports its confidence, which the other adapters don't" **[doc]** |
| OpenAI evaluation models, Anthropic evaluation models | No | `rwe:99-101` **[doc]**. The code agrees only in that nothing but `providerMetadata.typesafe.confidence` is read (`eva:58-70`). No test runs an OpenAI or Anthropic evaluation model through the evaluator. |

### 3d. Sequencer

`sequencer({ name, ... })` returns a builder; steps are methods on it (`.step`, `.tap`, `.parallel`, ...), not config fields. Methods are R-03's. `sm:456-505`, `sq:2576-2622`.

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `name` | `string` | required | | `sm:460` |
| `description` | `string` | none | | `sm:471` |
| `inputSchema` | Zod | the first step's `inputSchema` when none is given and a first step is added; otherwise `z.any()` | A sequencer with no `inputSchema` takes the first step's. | `sq:1326-1334` **[source]** |
| `outputSchema` | Zod | none | Checked against the sequencer's returned value after the last step, on any exit (tail, `exitIf`, rescue). Failure throws `SequencerOutputSchemaError`: `Sequencer "<name>" output validation failed at "<path>": <message>`, code `sequencer_output_schema_error`, `retryable: false`, `details` = `{ sequencerName, lastStepName, rawOutput, issues }`. The `at "<path>"` part is left out for an empty path. Without it nothing is checked, and `block.outputSchema` holds the last step's schema (`sq:1216`, `:1265-1268`; `bb:183-186` stamps both `outputSchema` and `config.outputSchema`). | `sq:1138-1169`, `:1226-1268`; `soe:1-60`; **[ran]** (`SEQ OUT ... failed at "n": Expected number, received string`, code `sequencer_output_schema_error`) |
| `stateSchema` | Zod object | none | Sequencer state: `ctx.sequencer`, and `ctx.self` in its own callbacks (section 9). | `sm:490` |
| `uses` | capability list | none | | `sm:493` |
| `durable` | `boolean` | `true` | See "Durable and checkpoints" below. | `sm:484`; `sq:1221` |
| `transient` | `boolean` | `false` | As section 1b. | `sm:472` |
| `activeStatusMessage` | string or `(input, ctx) => string` | none | | `sm:500` |
| `container` | object | none | Emits a `container` item around the sequencer's items. | `sm:501-505`; `sq:651-681` |
| `flowConfigSchema` | Zod | none | | `sm:470` |

A sequencer takes no `retry`, `rescue`, `cacheable`, `onCompleted`, `onErrored` or `resources`. `.rescue()` is a method. `sm:456-505`.

**Durable and checkpoints.**
- `durable` defaults `true`: the sequencer writes a checkpoint of its state at each step boundary. `durable: false` skips the checkpoint writes. Non-durable `state_snapshot` items are gated by the tracing level: `minimal` none, `normal` the initial and terminal snapshots only, `verbose` every step (`sq:304-318`). Now carried on the durable-execution page, not blocks. `sq:1221`, `:296-345`; `scp:205-235`, `:236-275`, `:276-295` **[test]**.
- A checkpoint is the sequencer's `stateSchema` fields. A sequencer with no `stateSchema` and no stateful sequencer around it writes none (**[source]**: the snapshot reads `ctx.sequencer`). Transient slots are left out. On a resume, a step whose output was recorded does not run again; the checkpoint restores the sequencer's state. `sq:300-340`; `mem` **[doc]**.
- A state that fails the sequencer's `stateSchema` when a step ends: the checkpoint write is skipped, a warning `[flow-state] sequencer "<name>" state failed stateSchema validation; checkpoint write skipped for blockInstanceId=<id>. Issues: ...` is logged, and the `state_snapshot` item carries `durable: false`. `sq:350-362`; `scp:383-462` **[test]**.
- Checkpoints are kept after the request completes unless `flow.request.cleanupCheckpointsOnTerminal` is `true` (default `false`). `runAction.ts:1636-1710`, `:2917-2931`; `ft:443-453`; `scp:141-163` **[test]**.
- The action-level `durable` flag (on an `actions` entry) is an R-05 row: it clears the request's suspension records and lease on completion when `true`; it does not gate suspending, checkpointing or crash recovery. `ft:236-243`; `runAction.ts:2917-2927`. This page links it.

### 3e. Router

`router({ name, routes, execute, ... })` picks one block at run time and runs it with the router's own input. `rt:62-158`, `:160-369`.

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `routes` | `BlockDefinition[]` | required | The candidates. All share the router's input and output schema types. | `rt:134` |
| `execute` | `(input, ctx) => BlockDefinition \| Promise<BlockDefinition>` | required | The selector. Its `ctx.self` is read for state; writing to it is not blocked by the framework. | `rt:135-141` |
| `validateRoute` | `(candidate, routes, input, ctx) => boolean \| Promise<boolean>` | the default check below | Replaces the default membership check entirely. A `false` throws the same invalid-route error. | `rt:143-152`, `:280-294`; `rtt:46-61` **[test]** |
| `container` | object | none | Honoured on routers. | `rt:153-157`; `eb:236-240` |
| all other shared fields, `parentStateSchema`, `targetStateSchemas`, `resources`, `uses`, scope schemas | | | As on a handler, except there is **no** `parentInputSchema`. | `rt:62-135` |

Behaviour:
- **No route matches.** There is no "no match" case: `execute` must return a block. A returned block is accepted when it is the same object as a route **or has the same `name` as a route**. Otherwise the block throws a plain `Error`: `Router "<name>" selected invalid route "<route>". Route must be one of declared candidates.` (client code `execution_error`). `rt:55-60`, `:277-294`; `rtt:26-44` **[test]**; **[ran]** (message and code; a different block with a route's name was accepted and its body ran).
- **The selected block gets the router's input and its output is the router's output**, then is checked against the router's `outputSchema` if declared. The router's own trace output is a reference to the route's trace. `rt:333-367`; `bb:360-366`.
- **Names:** two different blocks sharing a name in `routes` throw when the router is built: `Router "<name>" declares duplicate route name "<route>" across two different blocks. Route names must be unique so the recorded router decision is unambiguous on resume.` The same block listed twice (for example under two keys) is accepted. `rt:199-221`; `rrt:207-225` **[test]**.
- **A selector that does not return a block**, such as `undefined`, is not a supported answer; nothing pins what error it gives. Leave it off the page.
- **Resume:** the selector runs again on resume and the fresh pick is checked against the recorded `router_decision`: same route name continues, a different name or a removed route throws `RouteUnavailableError` (code `route_unavailable`, `retryable: false`, `details` = `routerName`, `recordedRoute`, `reselectedRoute`, `recordedRouteDeclared`). The match is by route name, so a per-call `route.connectInput(...)` wrapper the selector returns is kept. `rt:296-322`; `rue:1-50`; `rrt:62-141` **[test]**.
- **Purity rule** (the "pure selectors and mapping closures" row): the selector, and the mapping function of any `connectInput` or `connectOutput` wrapper it returns, should read only the input, because both run again on resume. The framework checks only the route name, not that the closures are pure. `mem:84-90` **[doc]**; `grs:68-82` **[doc]**; `rt:296-304` (comment).
- **`ctx.self` in a router** is readable; do not write it in `execute`, because `execute` runs again on resume. Put a `.tap(handler)` in front and let it write. `blk:365-369`; `rt:94-100` (comments); `bst:327-370` **[test]** (a router with `stateSchema` has a working `ctx.self`).

## 4. The checks around `execute`

Order for any block built by `handler`, `generator`, `evaluator` or `router` (a sequencer checks its own `outputSchema` after its last step, section 3d). `bb:280-415`.

| Step | What runs | Failure | Source |
|---|---|---|---|
| 1 | `connectInput(rawInput, ctx)` if declared | A throw is the block's failure. | `bb:336-338` |
| 2 | `inputSchema` check on the connector's output | `Block "<name>" input validation failed at "<path>": <message>` | `bb:356` |
| 3 | `execute(input, ctx)` | | `bb:360` |
| 4 | `outputSchema` check on the return | `Block "<name>" output validation failed at "<path>": <message>` | `bb:361-366` |
| 5 | `onCompleted(output, ctx[, meta])` | A throw here fails the block, and `onErrored` then runs. | `bb:368-376`; **[ran]** |

- The message reports the **first** Zod issue only. The `at "<path>"` part is left out when the path is empty (the wrong type at the root): `Block "typed" output validation failed: Expected string, received number`. `bb:152-171`; **[ran]**.
- It is a plain `Error`: the client sees `code: "execution_error"`, `retryable: false`. The block's `execute` does not run on an input failure. **[ran]**; `bbt:50-65` **[test]** (phrase `input validation failed`).
- A generator's output failure is a different error, `OutputValidationError` (code `output_validation_error`, `details` = `rawOutput`, `issues`, `phase`). R-02 and R-22 own it.
- The error is recorded on the block's `block_trace` row. `its` **[doc]**.
- Defaults when a schema is left off: `z.any()` for handler, router and evaluator input and output; a generator's output is `z.string()`; a sequencer's `outputSchema` is unchecked. With `z.any()` nothing is checked and the next step's input is untyped. `bb:210-211`; `gen:2865`.
- "A connector reshapes between steps": a connector is `(input, ctx) => next | Promise<next>` (`ConnectorFn`); on a block it is `connectInput`, on a sequencer step it is the first argument (R-03). `blk:1032-1035`.
- **Not a compile-time check:** `step(block)` takes `BlockDefinition<any, TOut>`, so the next block's input type is `any` and TypeScript does not compare it with the previous output; the mismatch is caught at run time. `sm:164-166`. The existing Blocks page says the opposite (`fb:823` "TypeScript catches mismatches at compile time"); the code wins.

## 5. Hooks

### 5a. `onCompleted`

| Fact | Source |
|---|---|
| `(output, ctx) => void`; a generator's has a third argument `meta` with `meta.model` (the resolved `ModelIdentity`), always set on success. | `blk:1079`; `gen:543-548`, `:477`; `generator-completed-meta.test-d.ts` **[test]** |
| Fires after the output check succeeds. Not on a failed block. | `bb:361-376` **[ran]** |
| A throw fails the block; `onErrored` runs next. **[ran]** (`['done','err']`, error `from hook`). | `bb:368-384` |
| Not available on a sequencer. | `sm:456-505` |
| `.connectOutput(fn)` drops it. | `bb:549` |
| Under a retry policy it fires only for the attempt that succeeded. **[ran]** (`['err','err','done']`). | `bb:368` |

### 5b. `onErrored`

| Fact | Source |
|---|---|
| `(error, ctx) => void`, called with the thrown error as an `Error`. | `blk:1080`; `bb:379-387` |
| Fires on any throw from the block: connector, either schema check, `execute`, `onCompleted`. Under a retry policy, once per failed attempt. **[ran]** | `bb:379-387` |
| Fires **before** a rescue handler of the same block runs. **[ran]** (`['onErrored2','rescue']`). | `bb:379-411`; `eb:332-362` |
| A throw from the hook is ignored; the original error stands. **[ran]** (`orig`). | `bb:381-387` |
| Not available on a sequencer. **Corrected:** the hook does run when the block throws a suspension signal; `buildBlock`'s catch calls `onErrored` for every throw, and only the scope-less rescue branch skips `SuspensionError`. | `sm:456-505`; `bb:379-388`, `:399` |

### 5c. `rescue` and `.rescue()`

| Fact | Source |
|---|---|
| `rescue: [{ when?: ErrorClass[], block }]` on a config, or `block.rescue(handlers)`. The first handler whose `when` matches runs with the thrown error as its input; its output replaces the throw and the chain continues. A handler with no `when`, or an empty one, matches any error. A suspension signal is never rescued. `.rescue(handlers)` replaces the installed handlers. | `bu:5-26`; `bb:389-411`, `:428-444`; `blk:1086-1093`, `:1332-1352` |
| `ctx.wasRescued(block)` reports it afterwards. | `blk:473`; `cec:4299`; `ext:777-860` **[test]** |
| On the action's root block, retries run first and rescue fires after the last attempt, or at once for a non-retryable error. | `eb:332-362`; `brs:60-163` **[test]** |
| A failure a rescue handled is not a failure of the request. | errors sheet E3 |

### 5d. Tool observers (the `tools` hooks)

`defineFlow({ tools: { onToolStarted, onToolCompleted, onToolErrored } })`, or a generator's `flowTools`. Each is a function `(event, ctx) => void` or a block. `ft:69-100`; `te:128-192`.

| Hook | Fires | Event | Source |
|---|---|---|---|
| `onToolStarted` | once per tool call, before the tool runs | `{ toolName, input }` | `te:128`; `tet:79-96` **[test]** |
| `onToolCompleted` | after a successful call, after any retries | `{ toolName, input, output }` | `te:142` |
| `onToolErrored` | once per call that ends in a throw, after every retry attempt is used, before the error propagates | `{ toolName, input, error }` | `te:192`; `tet:97-118` **[test]** |

`ToolLifecycleEvent` is `{ toolName, input, output?, error?, cached? }`. A cache hit fires started and completed with `cached: true`; `onToolErrored` never fires on a hit, because errors are never cached. `ft:74-90`; `te:264-349`. Tool retry and timeout defaults (`tools.defaults`) are R-02 and R-05 rows.

## 6. `retry`

`RetryPolicy = { maxAttempts?, baseDelayMs?, maxDelayMs?, retryableErrors? }`. `blk:1037-1042`.

| Fact | Source |
|---|---|
| **Where it is read: only on the action's root block.** `executeBlock` merges `block.config.retry` with the run's `retry` option and retries the whole block. A block used as a step, a route or a tool is run once whatever its `retry`. **[ran]** (a handler with `retry: { maxAttempts: 3 }` that always throws: run as the action's block, `execute` ran 3 times; as a step in a sequencer, 1 time; the same handler under `executeBlock({ retry: { maxAttempts: 3 } })` as a step of the root sequencer: the whole sequencer ran 3 times). A generator used as a tool is retried only by `tools.defaults.retry`. | `eb:423-426`; `te:81`, `:403-453`; `cfg:27`, `:88` (the existing page lists it for every block and says a generator's retries "the model call") |
| The run's policy is the `retry` option of `runAction`; no HTTP or host option sets it. | `execution/types.ts:140`; `runAction.ts:2446` |
| Merge: the block's fields override the run's, per field. | `rty:30-54`; **[ran]** (`{ maxAttempts: 4 }` over `{ baseDelayMs: 100, maxAttempts: 2 }` gives `{ maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 5000 }`) |
| Defaults once any policy exists: `maxAttempts` 1 (values below 1 become 1), `baseDelayMs` 0, `maxDelayMs` 5000 (never below `baseDelayMs`), `retryableErrors` unset. With neither block nor run policy there is no retry. | `rty:23-25`, `:42-53` **[ran]** |
| Backoff: delay before retry *n* is `baseDelayMs × 2^(n−1)`, capped at `maxDelayMs`; no jitter. | `rty:143-149`; `eb:441-448` |
| What is retried: any error except a suspension signal, a `FlowError` with `retryable: false`, or, when `retryableErrors` is non-empty, an error that is not an instance of one of those classes. A plain `Error` is retried (it is not a `FlowError`). A block whose input fails its schema is retried like any other throw. | `rty:59-90`; `rpr:14-31`, `:203-` **[test]** |
| Each failed attempt runs the block's `onErrored` (section 5b) and increments `ctx.attempt` (0-indexed; `ctx.idempotencyKey` is the same across attempts). | `blk:564-581`; `eb:212-217` **[ran]** |
| The "`onRetry`" the old rows mention is an internal option of the retry loop, not a block field. What a reader sees: a `warn` log `[flow-state] block execution retry scheduled` before each retry that will happen, not before the last failure; and, per failed attempt, an error-capture event (errors page). | `rty:101-110`, `:150-157`; `eb:436-470`; `rpr:111-136` **[test]** |
| A cancel before the first attempt, during a backoff wait or during an attempt ends the loop with `Error("Retry aborted")`. | `rty:122-127`, `:160-170`; `rpr:137-173` **[test]** |
| Retries use up first; then a `rescue` on the root block fires. | `brs:60-163` **[test]** |

## 7. `cacheable`

Memoizes a tool's result. Only a block installed as a tool of a generator is cached.

`BlockCacheableConfig`: `blk:1142-1180`.

| Field | Type | Default | Fact | Source |
|---|---|---|---|---|
| `true` | | | Shorthand for `{}`. | `ctc:204-215` |
| `ttl` | `number` (ms) | the store's default: 5 minutes (a board can set `defaultTtl`) | `0` never serves a hit and logs a warning on every call unless `NODE_ENV` is `production`: `[tool-cache] cacheable: { ttl: 0 } disables caching for this tool`. An entry older than `ttl` is not served. | `blk:1148`; `ctc:196-215`; `tc:185-201`; **[ran]** |
| `scope` | `"run" \| "request" \| "session"` | the store's `defaultScope`, `"run"` | Part of the cache key (`<scope>:<id>:<tool>:<args>`). `run` and `request` key on the request id; `session` keys on the session id. The entry lives as long as the **store** (the request, or a board run), not longer: the capability's store is created per request, so `session` does not carry entries to another request unless the app binds one store across requests with `bindToolCacheStore`. | `blk:1160`; `ctc:165-194`; `tc:228-250` **[source]** |
| `keyFn` | `(input, ctx) => string` | recursive key-sorted JSON of the arguments | Custom key. The existing page's `(args) => string` is the short form. Arguments with a function, symbol, bigint, non-finite number or class instance have no default key: the call is not cached and a warning is logged. | `blk:1169`; `ctc:108-163`, `:165-176`; `te:285-292` |
| `cacheIf` | `(output, input) => boolean` | cache every success | A `false` skips the write. | `blk:1178`; `te:351-370` **[ran]** (`{ found: false }` never cached) |

Behaviour:
- **Needs a store in scope.** Without one the field is inert: the tool runs every call and identical in-flight calls do not share. A store comes from `createToolCacheCapability(options?)` in a block's `uses` (options: `defaultTtl` default 5 minutes, `maxEntries` default 5000 with least-recently-used eviction, `defaultScope` default `"run"`, `name` default `"toolCache"`), from `bindToolCacheStore(ctx, store)` with `createInMemoryToolCacheStore(options?)`, or from a task board. `tc:185-285`; **[ran]** (no store: 3 calls ran).
- **Task board:** a board installs a store for each run unless `toolCache: false`; `toolCache: { defaultTtl, maxEntries, defaultScope, enabled }` tunes it. The store is dropped when the board's run ends. `tb:518-557`; `fpw:213-262`; `ttt:59-124` **[test]**.
- **Errors are never cached.** **[ran]** (a tool that always threw ran on every call). `te:351-370`.
- **Concurrency:** a second identical call that starts while the first is running waits for the first and gets its result (and, if the first throws, its error). **[ran]** against `buildToolExecutor`: two identical calls started 5 ms apart ran once. Two calls started in the **same tick** both ran, because neither had registered yet. The existing page says identical in-flight calls share one execution. Flag for the caller: the page should not promise sharing for calls issued together. `te:198`, `:296`; `ctc:265-270`.
- **A hit** emits the tool's `tool_output` with `cached: true`, `cacheAgeMs: number` and, when the hit crossed a task boundary in a task-board run, `sourceTask: { collectionId, taskId }` (`packages/contracts/src/items/types.ts:422-445`; `emit-tool-output.ts:148-149`), and fires `onToolStarted` and `onToolCompleted` with `cached: true`. `te:296-340`.
- A hit is served from the store's copy of the output, verbatim.

## 8. What a block may return

| Kind | Returns | Source |
|---|---|---|
| handler | The value `execute` returns (sync or async), checked against `outputSchema` if declared. A handler that exists only for its side effect returns nothing; it declares no `outputSchema` and is chained with `.tap()` (R-03). | `hd:110-118`; `bb:360-366` |
| generator | Text when no `outputSchema` (`z.string()`), the parsed object when one is declared. | `gen:2865` |
| evaluator | `{ answers }`, typed by the questions (section 3c). | `evt:121-129` |
| sequencer | The last step's output. If `outputSchema` is declared it is checked (section 3d). | `sq:1138-1169` |
| router | The selected route's output, unchanged. | `rt:333-367` |

- **The return value is recorded.** It goes into the request's log, streams to DevTool, and, for a tool, is part of the model's history. A value over `maxRecordedValueBytes` (default 256 KiB once serialized; set on the router, `createFlowApiRouter` options) is recorded as `{ kind: "omitted", bytes, preview }` where `preview` is the first 512 characters and `bytes` is `null` for a value that cannot be serialized (a cycle, a bigint). The run keeps the real value: the next step, `ctx.getBlockOutput()` and the generator that called a tool get it. A request that resumes after a pause or crash and would have to hand on a placeholder fails with code `RECORDED_VALUE_OMITTED`, naming the block. `rv:1-120`; `rvt:77-200`, `:236-300`, `:358-399` **[test]**; `its:147-163` **[doc]**. The mid-sequencer `.map` that is not the last step records nothing (R-03).
- **What to return:** the guidance row: return what the next step needs, not everything the block read; hand bulk data on through a sequencer `.map`; data a user needs to read belongs behind a read path. `fb:826` **[doc]**. Not mechanism; the page says it as: store data a user reads later in a resource, linking `./resources.md`. The page example files `auto-reply.ts` and `escalate.ts` are handlers shown on the page (`{ text, truncated }` to `{ reply }`).
- Reading another block's result from a later step: `ctx.getBlockOutput(block)` returns the output when the block completed, else `undefined`; `ctx.getBlockResult(block)` returns `{ status: "not_started" }`, `{ status: "running" }`, `{ status: "completed", output }` or `{ status: "failed", error }`; `ctx.wasRescued(block)`. Scope: blocks that ran earlier in the current sequencer run; the most recent run of a name wins under `.loopBack`. `blk:222-226`, `:449-473`; `cec:4250-4320`; `ext:608-860` **[test]**.

## 9. Block state and sequencer state

### 9a. The handles

| Handle | Points to | Declared with | When `undefined` | Source |
|---|---|---|---|---|
| `ctx.self` | this block's own state | `stateSchema` on the block, or `stateSchema` contributed by a capability in `uses` | the block (and its capabilities) declare no state | `blk:370`; `cec:5019-5028`; `bst:40-96` **[test]** |
| `ctx.parent` | the immediate parent's `name`, `kind` and `input`, always; plus the parent's state operations when the parent has state | `parentStateSchema` (types only) and, for `.input`, `parentInputSchema` (H and E only) | the block is the outermost block of the run. The state operations are **absent** (not present and throwing) when the parent declares no `stateSchema`. | `blk:427-431`; `cec:5030-5050`; `bst:425-460` **[test]**; **[ran]** (`{ name, kind, input }` with no `patchState`; `undefined` at the root) |
| `ctx.sequencer` | the nearest enclosing sequencer **that declares a `stateSchema`**, including the block itself when it is that sequencer | `sequencerStateSchema` on the block; `stateSchema` on the sequencer | no enclosing sequencer has state | `blk:356`; `cec:4995-5017`; `bst:461-516` **[test]** |
| `ctx.targets.<name>`, `ctx.getTarget<T>(name)` | a named block | `targetStateSchemas` (types only) | no block of that name is in scope | section 10 |

- `ctx.parent` is `{ name, kind, input }` for a parent with no state; for a parent with state it is that state's `StateRef` plus `kind`. `ctx.parent.state` stays live when held in a variable across a write. `cec:5030-5050`; `bst:371-424` **[test]**.
- `ctx.parent.input` for a step of the root sequencer, and for a route of a root router, is the run's input. `root-parent-input.test.ts:48-110` **[test]** (`packages/engine/test/`).
- A tool a generator calls is a child scope of the generator: its `ctx.parent` is the generator. `te:182`; `bst:271-326` **[test]**.
- A **capability can contribute** `stateSchema` (`ctx.self`), `sequencerStateSchema` (`ctx.sequencer`) and `targetStateSchemas` (`ctx.targets`). It **cannot** declare `ctx.parent`: the capability preset type has no `parentStateSchema` or `parentInputSchema`. `ct:62-95`; `bst:518-600` **[test]**; `cbi:790-860` **[test]**.
- Two sources contributing the same `ctx.self` field (two capabilities, or a capability and the block's own `stateSchema`) must use the **same schema object**, or building throws `Own-state conflict (<where>): field "<key>" is declared by two sources with different schema references. Two contributors to the same ctx.self field must share the schema definition (reference one constant) or use distinct field names.` Both sides must be `z.object()`. `cm:429-445`; `cbi:814`, `:835`, `:859` **[test]**. Targets with one name and different schemas: `Target conflict in capability "<cap>" (<source>): "<name>" is declared with different schema references`. `cm:381-396`.

### 9b. The state reference

A `StateRef<TState>` has `name`, `instanceId`, `input` (the value the block was called with), `state` (read-only, live), and `patchState`, `setState`, `incState`, `pushState`, `setStateRecord`, `deleteStateRecord`, `atomicState`. `blk:201-217`; `cec:4060-4122`. Operation semantics are on the State operations page. The existing State Targets page's list omits `setState`.

### 9c. A block's own container

| Fact | Source |
|---|---|
| A block with a `stateSchema` gets a new container **each time it runs**, initialised from its schema, and scoped to one execution within the request. | `cec:4549-4554`; `blk:370` |
| Initial value: the schema parsed from `undefined`; if that fails, parsed from `{}`; if that also fails, `{}`. So a schema with **any required field that has no default** starts as `{}`, and the defaulted fields are not filled either. | `rr:501-519` **[source]** |
| Each pass of a `.loopBack` and each iteration of a `.forEach` is a separate scope: a step's own `ctx.self` starts fresh each pass or iteration. The sequencer that owns the loop keeps one container across every pass, so its own state (`ctx.sequencer` from inside) accumulates. `forEach` and `parallel` branches do not see each other's state. A loop body that must remember across passes writes on the loop owner through `ctx.parent` or `ctx.sequencer`. | `bst:143-270` **[test]** (loop body resets `[1,1,1]`; loop owner reaches 3; forEach `[11,21,31]`). `parallel`: same mechanism, no test; mark **[source]**. |
| A tool's own `ctx.self` resets on every call (each call is a new scope initialised from the tool's `stateSchema`), so a count kept there reads 1 each time. A tool is a child of the generator that calls it, so its `ctx.parent` is the generator; the generator's own container accumulates across its tool loop when tools write through `ctx.parent`, which needs the generator to declare a `stateSchema` (the state operations are absent otherwise). | `te:175-183`; `bst:271-326` **[test]** (`["", "a", "a,b"]`, generator declares `stateSchema`) |
| Block and sequencer state containers are created with no `persist` (`cec:4549-4553`, `:4084-4088`), so writes are applied one at a time per container and never raise `ConcurrentModificationError` (`sc:1-17`). One container per execution within one request: two requests never share one. A write that leaves the state deep-equal does not bump the version or emit a `state_change`. A write that waits longer than `request.mutationTimeoutMs` (default 30 000 ms) raises `ScopeMutationTimeoutError`. | `sc:150-215`; `cec:674`, `:4086-4088` **[source]** |
| Each committed write streams a `state_change` item with `scope: "block_instance"`, the operation, a `delta`, a `version` and `blockInstanceId`. It is `client: true`, `history: false`; it is stored only when `NODE_ENV` is not `production` or the flow sets `persistStateChanges`; in production it is live only. Fields declared with `transientSlot` are left out of the delta. | `cec:4085-4101`; `se:1-60`; **[ran]** (`{"scope":"block_instance","op":"increment","delta":{"n":1},"v":1}` with `blockInstanceId` set); items sheet 4.6, 5.3 |
| Block state is not read back by a client after the request. It is not in the request record. | `its`; items sheet |

### 9d. Sequencer state

A sequencer's `stateSchema` is block state addressed as `ctx.sequencer`. What sequencer state adds:

| Fact | Source |
|---|---|
| In a sequencer's own DSL callbacks `ctx.sequencer.state` is typed from the sequencer's `stateSchema`, and `ctx.self` is the same container. | `sm:490`; `sqs` **[doc]** |
| **A child's `sequencerStateSchema` is merged into the nearest sequencer that has a `stateSchema`**, when the sequencer (or router) is built, at `.step()` or `router()`, not at `defineFlow` (`sq:1224-1229`, `:2599`; `rt:248`). It passes through a sequencer with no state, through a router's routes, and through block-level rescue handlers. A field the sequencer lacks is added to its state; if the child's schema for it does not accept `undefined`, the added field is made optional; a shared field must agree in kind. A disagreement throws `SequencerSchemaMismatchError` (code `sequencer_schema_mismatch`, `retryable: false`): `Sequencer state conflict at "<sequencer>": block "<child>" requires a different state field "<key>": declared ZodString but a block requires ZodNumber`. Both sides must be `z.object()`. | `ss:23-153`; `sq:1223-1229`; `sbb:53-327` **[test]**; **[ran]** (exact message above) |
| A capability's `sequencerStateSchema` is installed on the sequencer that uses it, and conflicts the same way. | `sbb:329-395` **[test]** |
| `ctx.sequencer` resolves to the nearest enclosing sequencer with state; a nested sequencer with no `stateSchema` is skipped. | `cec:4995-5017`; `bst:461-516` **[test]** |
| A sequencer checkpoints its state at each step boundary when `durable` (section 3d). Block state of any other kind is **not** checkpointed. | `sq:293-400` |
| `transientSlot(schema)` marks a state field: it holds its value for the run and is readable by later steps, emits no `state_change`, is left out of `state_snapshot` and so of the checkpoint, and resets to its default on resume. In a patch that writes both transient and normal fields, the transient keys are stripped from the `state_change` delta and the rest persists. Apply it **last** in the schema chain. The stripping is applied to any block's container, not only a sequencer's. | `ts:1-80`; `cec:4100`; `ext:1700-1810` **[test]**; `tst:10-80` **[test]** |
| Resume after a pause: the waiting sequencer's checkpoint is restored; a state write the waiting code made before the wait applies once. A handler's own state is rebuilt from its schema and the re-run reaches the same writes again, so it also reads its pre-wait write after the answer. | `cec:4110-4160`; `sst:594-640` **[test]** (`[1]` in each case) |
| Versus session, user and org state: those are version-checked and can raise `ConcurrentModificationError`; sequencer and block state cannot. | `sc:150-215`; `sqs` **[doc]** |

### 9e. Lifetime and durability of block state

- A block's own state, and a sequencer's, live for one execution of that block within one request. They are not in a store and are gone when the request ends, except a sequencer's checkpoint (kept per `cleanupCheckpointsOnTerminal`) and, when the stream is stored, its `state_change` items.
- A block that waits (`ctx.suspend()` or `ctx.suspendForUser()`) and is answered later runs its body again from the top; its own state is rebuilt from the schema defaults (section 9d, last rows). The existing Block State page says such a block "loses its in-memory state on resume" (`bs:121`) and advises keeping state on the enclosing durable sequencer. The test shows that a pre-wait write by the block's own code is reapplied because the code runs again; state written by code the resume does not re-run is not restored. `sst:594-640`.

## 10. State targets and parents

| Fact | Source |
|---|---|
| `targetStateSchemas: { <blockName>: zodSchema }` on a handler, generator, evaluator or router types `ctx.targets.<blockName>` as `StateRef<...> \| undefined`. The schema is **not validated** at run time; `ctx.targets.<anyName>` resolves any name. The object cannot be enumerated (`Object.keys` is empty). | `hd:106`; `cec:4199-4212` **[source]** |
| `ctx.getTarget<T>(name)` is the same lookup with a name computed at run time. | `blk:445-447`; `cec:4214-4250` |
| **Resolution:** blocks already dispatched at the current level are searched first, most recent first (this is how a later step finds an earlier one); then the ancestor chain. Not found: `undefined`. | `cec:4214-4250`; `ext:910-1030` **[test]** |
| A sibling beats a same-named ancestor. | `ext:989-1028` **[test]** |
| **Ambiguity:** if more than one ancestor has the name, the lookup throws `AmbiguousBlockNameError` (client code `ambiguous_block_name`, `retryable: false`): `getTarget("<name>") is ambiguous from block instance "<nearest instance id>". Matching instances: <id>, <id>`. Siblings never raise it. | `cec:4228-4247`; `fe:164-175`; `ext:1030-1050` **[test]**; **[ran]** (message and code) |
| A named block that exists but declares **no `stateSchema`** still returns a reference; reading `.state` gives `{}` and every write throws `Target "<name>" does not expose instance state operations.` | `cec:4062-4073`; **[ran]** |
| A target's state is in memory for the run of that block. Writes by a descendant stream as `state_change` items with `scope: "block_instance"`. | `cec:4085-4101` |
| Which handle for which job: `ctx.sequencer` (nearest enclosing sequencer with state), `ctx.targets.<name>` (a specific named ancestor or earlier sibling), `ctx.parent` (the immediate parent, whatever its kind or name). | `stp` **[doc]**; `blk:356-431` |
| Names come from the block's `name` config (a `.as()` copy's own name). Names are not required to be unique; an ancestor chain with a repeat is what makes a lookup ambiguous. | `bb:445-462`; `bst:461-516` |

## 11. Lookups

**Which fields are required on a handler?** `name` (a non-empty string) and `execute`. Both are refused at build when missing (`Cannot build "<kind>" block without a non-empty "name"`; `Cannot build "<name>" (handler) without an execute function`). Nothing else is required: with no `inputSchema` or `outputSchema` both default to `z.any()`. `bb:202-211`; **[ran]**.

**What does a router do when no route matches?** There is no no-match case. `execute` must return a block. The block must be one of `routes`, by reference or by name. Otherwise the router's block fails with a plain error, `Router "<name>" selected invalid route "<route>". Route must be one of declared candidates.`, which the client sees as `execution_error`. `validateRoute` replaces the check. `rt:277-294`; **[ran]**.

**Where does a block's own state live, and who can read it?** In an in-memory container created when the block starts and dropped when it ends, one per execution within a request, initialised from the block's `stateSchema`. The block reads it as `ctx.self`. Its immediate children read it as `ctx.parent` (the state operations are there only when the block declared a `stateSchema`). Any descendant, and a later block at the same level, reads it by name with `ctx.targets.<name>` or `ctx.getTarget(name)`. For a sequencer, any block inside reads it as `ctx.sequencer`. A client sees it only as live `state_change` items (kept in storage outside production). `cec:4549-4554`, `:4995-5050`; `bst` **[test]**.

## 12. Stored parts: who owns, who can see, where, how many

| Stored part | Owner | Who can see it | Where | How many |
|---|---|---|---|---|
| A block's own state (`ctx.self` container) | One execution of the block, in one request | The block; its children by `ctx.parent`; descendants and later siblings by name. A client sees `state_change` items (`client: true`); no read after the request. | In memory for the run. The `state_change` items are in the request's items outside production. | One per execution of a block that declares `stateSchema`; a fresh one per loop pass, per `forEach` iteration, per tool call. |
| A sequencer's state and checkpoint | One execution of the sequencer | Blocks inside it by `ctx.sequencer`; `state_snapshot` trace items (`client: false`) to DevTool and to a client that asks for traces; the engine on resume | State in memory; the checkpoint in the `checkpoints` store | One checkpoint per durable sequencer per request, overwritten at each step boundary (latest only), keyed by `(requestId, blockInstanceId)`; kept after completion unless `cleanupCheckpointsOnTerminal`. Transient slots are not in it. |
| A block's recorded output | The request | The developer, in DevTool and traces; a client that asks for trace items. Not the default client filter. | The request's items (`block_trace` output); over 256 KiB a placeholder | One per execution of a block, including each retry attempt and each loop pass. |
| A tool-cache entry | The store: one request, or one task-board run | Any generator in that request or run that calls the same tool with the same arguments; the `tool_output` carries `cached` | In memory: a least-recently-used map on a hidden bag of the request (capability) or the board run | At most `maxEntries` (default 5000) per store; one per `(scope, id, tool, arguments)`. Dropped with the store. |

Sources: sections 7 to 9. `scp:164-204` (one record, latest state), `sc` (container), `its:147-163`.

## 13. Dispositions of the rows other pages moved to R-01

The list comes from `grep -rhE --include=*.record.md -e '→ R-01( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` (19 rows: 17 checked in the first pass, rows 18 and 19 added in pass 3). Each was checked against the code. Every row is carried unless it says otherwise.

| # | Row (short) | Disposition |
|---|---|---|
| 1 | `cacheable`: `true` shorthand and config object; defaults; applies when the block is a tool with a tool-cache store; the Task Board installs it automatically when a worker tool declares `cacheable`, `toolCache: false` disables (corrected by pass 5) | **Carried**, section 7. Corrected: a board installs a store for every run unless `toolCache: false`; only tools that declare `cacheable` use it. `keyFn` is `(input, ctx) => string`, `cacheIf` is `(output, input) => boolean`. "TTL from the cache default, 5 minutes in the framework": true for the capability and a board. |
| 2 | Cache scopes table: scope, how long entries live, default `run` | **Carried and corrected**, section 7 (`scope` row). The doc comments say `session` persists across requests; the capability's store is per request, so entries do not outlive it unless the app binds one store across requests (**[source]**). The table must give the store's lifetime, not the scope name's. |
| 3 | Cache failure and concurrency rows: errors not cached; identical concurrent calls in a request share one execution | **Carried in part.** Errors-not-cached is true (**[ran]**). Sharing is true only for a call that starts after the first has registered; two calls in the same tick both run (**[ran]**). The row's wording is wrong for the same-tick case; section 7. |
| 4 | "Not mechanism. It is guidance on when to reach for caching" | **Carried as one guidance sentence is not a fact.** No fact attached; there is no Reference row for it. Nothing to verify. |
| 5 | Addressing modes: `ctx.parent` cannot be declared by a capability; the other three are | **Carried**, section 9a. `stateSchema`, `sequencerStateSchema` and `targetStateSchemas` can be contributed; the preset type has no `parentStateSchema` or `parentInputSchema`. |
| 6 | Router: every route takes the router's input and returns its output; a router chooses only among its routes; what happens on a block not listed | **Carried**, section 3e. Added: "listed" means the same object or the same `name`; `validateRoute` replaces the check. |
| 7 | Schema checks: output after `execute`, input before; a connector reshapes between steps; check-order table with the connector signature | **Carried**, section 4. The connector runs before the input check on a block. A step connector is R-03's. |
| 8 | Failure and default rows: output rejected fails the block, error names block and field, shows in the trace; missing `outputSchema` is `z.any()` | **Carried and corrected**, section 4. The message names the block and the first issue's path, and only the first issue; the path is left out when empty (concepts page pass 5 corrected the same thing). `z.any()` is the default for handler, router, evaluator; a generator's is `z.string()`; a sequencer's is unchecked unless declared. The trace shows the error. |
| 9 | Block-level `onCompleted` and tool hooks `onToolStarted`, `onToolCompleted`, `onToolErrored` | **Carried**, section 5a and 5d. |
| 10 | Fields every block takes: `kind`, `name`, `run`. The CLI page keeps only the load errors for `fsdev block` | **Carried**, section 1a. `run` is not on the public type; it is what `fsdev block` probes for. The CLI's own `isBlockDefinition` also requires `kind` to be one of the five. |
| 11 | Router constraints: pure selectors and mapping closures; routes share input and output types | **Carried**, section 3e. The framework checks the route name only; purity is the author's. |
| 12 | Sequencer `durable` option and the action-level `durable` flag (cleanup only); `DurabilityProvider`'s ten methods go to the stores page | **Carried**, section 3d. The action-level flag is an R-05 row, linked from here. The `DurabilityProvider` methods are not on this page. |
| 13 | Block option `transient`: affects only the framework's own trace items for that block | **Carried**, section 1b. The `container` item is transient too. A sequencer's `transient` is the same flag; the existing sequencer table's "Omit items from the persisted log" is wider than the code (**[source]**). |
| 14 | Block `retry` policy: fields and defaults, per-field override of the run's policy, doubling backoff, `onRetry` timing, `Retry aborted` on cancel | **Carried and corrected**, section 6. Corrected: read only for the action's root block (**[ran]**). Dropped: `onRetry` as a thing a reader sets. It is an internal option of the retry loop; the page names its observable effects (a warn log, a capture event per failed attempt). |
| 15 | Block `onErrored` hook: `(error, ctx)`, fires before a rescue | **Carried**, section 5b. Added: once per failed attempt; a throw from the hook is ignored; not on a sequencer. |
| 16 | Evaluator definition-time refusal: a generate-only model throws at build time, with the error text and the fix | **Carried**, section 3c. The text is `Evaluator "<name>": the model can generate but not evaluate.` plus the fix line (**[ran]**). |
| 17 | Evaluator answer shape: `confidence` only for models that report it; key absent otherwise; per-model reporting (Jev yes; OpenAI and Anthropic no) | **Carried**, section 3c. Jev: choice and score only. The OpenAI and Anthropic cells rest on the existing guide (`rwe:99-101`); the code reads only `providerMetadata.typesafe.confidence`. |
| 18 | Router on an evaluator answer with no confidence: plain `router` branches on the bare answer; a cascade level goes to `ambiguous` and does not ask deeper levels | **Carried**, one sentence under the evaluator's `confidence` table. Checked: `cascadeGate` returns `{ ambiguous: "no-confidence" }` when the answer carries no finite confidence in 0 to 1 (`core/src/utility/cascading-router-gate.ts:30-60`; `core/test/cascading-router.test.ts:61-85` **[test]**). A level's route is chosen from the gate's verdict, and the deeper levels are reached only as the route of an edge, so an `ambiguous` verdict runs the `ambiguous` block and never the nested level (`core/src/utility/cascading-router.ts:262-320`). A plain `router` reads whatever its `execute` returns from `answers`, so it branches on the bare answer by construction (`rwe` **[doc]**). The cascade's options and trace are R-04's; the page links there. |
| 19 | Block state declaration rows: how two declarations of one field merge, each refusal with its `conflict` value (`"type"`, `"default"`), the error fields (`conflict`, `path`, `first`, `second`, `detail`), and the factory-default rule | **Carried**, "Declaring one field on two blocks" (section 17 here). Checked against `core/src/helpers/scope-state-merge.ts:1-100` (rules, error fields, `ScopeStateConflictKind = "type" \| "default"`), `core/src/helpers/index.ts:41-43` (export, subpath `@flow-state-dev/core/helpers` in `core/package.json:75`), and the tests `engine/test/scope-state-defaults.test.ts:572-592`, `:884-930` and `core/test/scope-state-merge.test.ts:85-110`, `:167-172` **[test]**. It covers session, user and org scope; it is not about `ctx.self`. The state-operations sheet (section 13) carries the same facts; the page here gives the declaration rules and links nothing back. |

## 14. Contradictions: existing docs against the code

Each is a place the existing pages (which this page replaces) say something the code does not. The code wins.

1. **`retry` on any block** (`cfg:27`, `:88`): it is read only for the action's root block. A step, a route or a tool is run once. The generator row ("Retry the model call", `cfg:88`) is also the root-only whole-block retry. Section 6.
2. **"Names must be unique within a flow"** (`fb:824`): not enforced. Router routes and a generator's tools are checked; nothing else is.
3. **`container` on every kind** (`cfg:26`): only a sequencer or router emits one.
4. **A missing `outputSchema` defaults to `z.any()`**: a generator's is `z.string()`.
5. **`transient` on a sequencer, "Omit items from the persisted log"** (`cfg:159`): it governs the block's own trace and container items; explicit `ctx.emit.*` items carry their own flag.
6. **`cacheable.keyFn: (args) => string`** (`cfg:43`): the signature is `(input, ctx) => string`.
7. **"Identical in-flight calls share one execution"** (`cfg:37`): true only when the second call starts after the first has registered. Section 7.
8. **`scope: "session"`** "persists across requests": the capability's store is per request.
9. **"TypeScript catches mismatches at compile time"** (`fb:823`): a step's input type is `any`; the check happens at run time. Section 4.
10. **"Target returns `undefined` if no block exists"** (`stp`): true for no block of that name. A block that exists without state returns a reference whose writes throw. Section 10.
11. **"A non-sequencer block that suspends loses its in-memory state"** (`bs:121`): the body runs again and reapplies its own pre-wait writes. Section 9e.
12. **`transientSlot` as a sequencer-only feature** (`sqs`, `bs`): the stripping applies to any block's container.
13. **State Targets' operation list omits `setState`** (`stp`).
14. **`validateChunk`**: typed and never read. Not on the old pages.
15. **The generators sheet** (`docs/contributing/docs-revamp/pages/reference/generators.facts.md`, `retry` row) says the generator's `retry` retries the whole run. True only for a generator that is the action's block. Neighbour page R-02.
16. **`resolveBlock` doc comment says exit 2** for a missing default export or a non-block; the code throws exit 4. (CLI page.)

## 15. Left out, and why

- **`validateChunk`**: declared, never read. Section 1b.
- **A selector returning a non-block** (`undefined`): no test, no documented behaviour.
- **`parallel` branch isolation of `ctx.self`**: stated by the existing page, same mechanism as `forEach`; not run. Marked **[source]**.
- **Whether OpenAI or Anthropic have an evaluation model that could carry confidence**: only the guide's statement is cited.
- **`.as()`, `.asTool()`, `.mapModelOutput()` detail**: R-02 rows. Section 1c gives one line each; the caller decides whether the page repeats them.
- **Utility blocks (`utility.keyedRouter`, `cascadingRouter`)**: R-04 and the utility blocks page. `keyedRouter` appears here only as a router that tolerates one block under two keys (`rrt:217`).
- **Sequencer methods** (`.step`, `.tap`, `.map`, `.rescue()`, `.loopBack`): R-03.
- **Model resolver settings** (`resolveEvaluationModel`, gateways): R-21. One row here names the hook.
- **`ctx.attempt` and `ctx.idempotencyKey` detail**: a row on retry; `runOnce` is the idempotency page's.
- **Internal context slots** (`_withExecutionScope`, `_toolInFlight`, the resolver bag keys): not observable.

## 16. Open items the page must not state without a pin

- The same-tick caching case: a **[ran]** probe against `buildToolExecutor`, not against a model-driven tool loop. A model that calls two identical tools in one step may behave as the same-tick case, but this was not run through a model. The page should state only the later-start case, or the owner should decide to fix the behaviour first.
- Retry reach: confirmed with `executeBlock` directly (the engine entry `runAction` calls). The generators sheet's contrary row has not been re-run through `runAction`.
- Block-state `state_change` storage in production: read from `shouldPersistScopeChange` (`se:1-30`) and items sheet 5.3, not run with `NODE_ENV=production`.
- The tool-cache store lifetime for `scope: "session"` is read from the code (`tc:228-250`), not run across two requests.

## 17. Facts added in pass 3, and what the page leaves out

Declaring one field on two blocks (row 19). `defineFlow` merges every declaration of each scope's state schema, from the flow, each reachable block and each capability they use, and throws `ScopeStateSchemaConflictError` when two disagree; the class is exported from `@flow-state-dev/core/helpers` (`packages/core/src/helpers/index.ts:41`), not the root entry. `scope-state-merge.ts:1-37`, `:62-96`; `engine/test/scope-state-defaults.test.ts:884-930` **[test]**.
- Agree: the same schema object; fields only one declaration names (any depth); outer wrappers added to one (`.default()`, `.optional()`, `.readonly()`); equal static defaults. `scope-state-merge.ts:15-30`; `scope-state-merge.test.ts:133-173` **[test]**.
- Refused: different types (`.nullable()` is part of the type), different static defaults, wrappers that differ otherwise. A default factory agrees only when it is the same function. `scope-state-merge.ts:25-30`; `scope-state-merge.test.ts:167-172`, `:242-267` **[test]**.
- A block's or capability's default factory is refused unless it restates the flow's own session factory; in user and org scope every factory is refused. The merged schema fills static defaults on a read and does not check writes (`scope-state-merge.ts:1-33`; `defineFlow.ts:799-808`); the page states no 'because'. `scope-state-merge.ts:92-100`; `scope-state-defaults.test.ts:572-592` **[test]**.
- Example message: `Flow "two-defaults": session.state.mode is declared twice with different defaults: block "planner" defaults it to "plan" and block "writer" to "write".` (the order of the two blocks is the order the walk meets them). `scope-state-defaults.test.ts:889-897` **[test]**. The page's message names the flow `support` in the same shape.

Dropped from the page:
- `validateChunk` (section 1b, 15): the page does not mention it.
- Row 4 (guidance on when to reach for caching): no fact; the page carries no sentence on it.
- Row 3's claim that identical concurrent calls share one run: the page states only the later-start case (section 16). Two calls issued in the same tick both run, and the page says so.
- `onRetry` (row 14): not a field; the page names a warn log and the per-attempt hook behaviour.
- The `fsdev block` load-error messages and exit codes (section 1a): the CLI page owns them; the page links there.
- The block-level `ctx.attempt` and `ctx.idempotencyKey` detail beyond one row.

## Revise round 1: what moved off the page

The Reference-depth pass moved these to sibling pages, and blocks.md now links them: `fsdev block` file shape (CLI); generator options (Generators); evaluator errors, model resolution and which models report `confidence` (Models, page not yet written); hooks, rescue, retry, error shapes for invalid route, ambiguous and stateless targets, sequencer state conflict (Errors, new sections "Block hooks, rescue and retry" and "Router, target and sequencer-state errors"); tool hooks and `cacheable` (Tools); sequencer checkpoints, router resume rules and state after a wait (Pause, resume and replay); `ctx.getBlockOutput`, initial state, loops and fan-out (Sequencer methods); `transientSlot` and write serialization (State operations); `state_change` persistence (Items); checkpoint, recorded-output and tool-cache rows (Stores); scope state merge conflicts (Flows and actions). Terminology on the page: the per-run holder of block state is "state", not "container"; `container` is the field and item only.
