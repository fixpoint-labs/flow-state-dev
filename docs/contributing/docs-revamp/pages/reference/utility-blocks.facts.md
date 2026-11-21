# Facts for Utility blocks (R-04, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests and `goals/`, one example. No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a fact comes from reading implementation rather than a test or an exported doc comment it is marked **[source]**; **[test]** where a test pins it; **[doc]** where only an existing user page states it and the code neither confirms nor contradicts it; **[carried]** where a sibling page's fact sheet states it and I did not re-run it. Nothing was run against a live model: every "output" below is the schema the block declares, not a sample a model produced.

Abbreviations (paths from the repo root):

- `U` = `packages/core/src/utility/`. One file per block: `U`analyzer.ts (`an`), context-reducer.ts (`cr`), decomposer.ts (`dc`), memoryExtractor.ts (`me`), summarizer.ts (`su`), combiner.ts (`cb`), intent-classifier.ts (`ic`), intent-router.ts (`ir`), keyed-router.ts (`kr`), cascading-router.ts (`cas`), cascading-router-gate.ts (`gate`), upsert-resource.ts (`up`), session-title-generator.ts (`st`), consult-session-history.ts (`co`), history-summary.ts (`hs`), history-summary-resource.ts (`hsr`), to-user-content.ts (`tu`), routed-input.ts (`ri`), index.ts (`ix`).
- Tests under `packages/core/test/`: `t-cb` combiner.test.ts, `t-dc` decomposer.test.ts, `t-ic` intent-classifier.test.ts, `t-ir` intent-router.test.ts, `t-rt` router.test.ts (the `utility.keyedRouter` describe, `:88-200`), `t-cas` cascading-router.test.ts, `t-up` upsert-resource.test.ts, `t-co` consult-session-history.test.ts. Engine: `e-cas` = `packages/engine/test/cascading-router.test.ts`.
- Existing user pages: `p-util` = `apps/docs/docs/patterns/utility-blocks/core.md`, `p-blocks` = `apps/docs/docs/fundamentals/blocks.md`, `p-ctx` = `apps/docs/docs/advanced/generator-context.md`, `p-models` = `apps/docs/docs/fundamentals/models.md`, `readme` = `packages/core/README.md`.
- Example: `ex` = `examples/guides/routing-with-evaluators/src/route.ts`.

## 0. Findings the writer must act on before drafting

| # | Finding | Source |
| --- | --- | --- |
| 0.1 | **The existing page says every utility but `consultSessionHistoryTool` takes `outputSchema`. Eight do.** `contextReducer`, `memoryExtractor`, `decomposer`, `summarizer`, `analyzer`, `intentClassifier`, `combiner`, `keyedRouter`. `upsertResource`, `intentRouter`, `cascadingRouter`, `sessionTitleGenerator`, `consultSessionHistoryTool` and `historySummary` take none. | `p-util:51,1343`; configs: `an:22-35`, `cr:46-59`, `dc:25-41`, `me:25-39`, `su:20-34`, `cb:20-25`, `ic:15-29`, `kr:42-51`; none in `up:3-25`, `ir:20-30`, `cas:133-144`, `st:8-18`, `co:45-63`, `hs:123-132` |
| 0.2 | **`itemVisibility` is on six blocks, not "every generator-based utility".** `contextReducer`, `memoryExtractor`, `decomposer`, `summarizer`, `analyzer`, `intentClassifier`. Not on `intentRouter`, `sessionTitleGenerator`, `consultSessionHistoryTool` (which fixes `{ client: false, history: false }` on its answering generator). The type is `{ client: boolean; history: boolean }`; the doc comments on the six configs still say `"primary"` / `"trace"` and are stale, so write the object form. | type `packages/contracts/src/items/types.ts:13-16`; configs as in 0.1; `co:250`; stale comments `an:29-34`, `su:21-26` |
| 0.3 | **`sessionTitleGenerator` is not `transient: true`.** The existing page says it is. The code sets no `transient`. The generator step has no `itemVisibility`, which is why it emits no visible items. | `p-util:1240`; `st:45-86` (no `transient`) |
| 0.4 | **`messageLimit` counts turns, not messages.** The doc comment says "recent conversational turns... One turn = one user → assistant request". The existing page says "recent messages" / "recent LLM messages". It is passed as `history: { limit }`, and in `items.history()` a bare number is "the last N conversational turns". | `st:11-17,55`; `packages/core/src/types/scope.ts:47-54`; `p-util:1223,1253` |
| 0.5 | **The `combiner` sample output on the existing page cannot be produced.** The note `"Preserved higher score (0.88 from docs) over duplicate (0.76 from web)"` is not a string the code writes. Notes are exactly two shapes (below, 3.5) plus two fixed sentences. The page also says notes "document every resolution decision"; equal scalars and non-conflicting keys write none. | `p-util:499,515`; `cb:63-71,82-84,119,143-145` |
| 0.6 | **`contextReducer` `compress` has no budget option.** The existing page says "lossy reduction under a token budget" and shows an input with `maxTokens`. The config has no budget field and the block never reads one; the prompt says "fit strict token or length budgets" and the model decides. | `p-util:85,102,155-170`; `cr:46-59,98-103` |
| 0.7 | **`decomposer` output: `deps` and `priority` are optional, `title` and `context` are `string \| null` and always present.** The existing field table lists `deps` and `priority` as present. The README's one-line contract (`{ id, goal, deps?, priority? }`) omits `title` and `context`. Code wins. | `dc:7-23`; `p-util:299-306`; `readme:200` |
| 0.8 | **`decomposer` turns on provider web search.** Its generator sets `search: true`; no other utility does. It also forwards `context` and `history`, which no other generator utility takes. The existing page mentions neither. | `dc:56-58`; `GeneratorConfig.search` `packages/core/src/blocks/generator.ts:614-619` |
| 0.9 | **`analyzer` `severity` and `evidence`, and `memoryExtractor` `confidence` and `source`, are optional in the schema.** The existing tables read as always present. | `an:7-12`; `me:14-19`; `p-util` field tables |
| 0.10 | **`historySummary` is on the `utility` namespace but is not a block.** It returns `{ capability, fold, resource }`. It has no row on the existing utility page; its page is `p-ctx` ("Summarizing turns past the window"). Decide whether R-04 carries a row that points there. I recommend one row, because a reader scanning `utility.*` will see it. | `ix:62-70`; `hs:148-351`; `p-ctx:323-384` |
| 0.11 | **The lookup "Which block reshapes without a handler?" has no single obvious answer.** Two readings. (a) A deterministic value-to-value block with no model and no handler for you to write: only `combiner` merges values; `upsertResource` and `keyedRouter` are also handler-free but write or route, they do not reshape. (b) Reshaping with no block at all: a sequencer's `.map()`. State both in the lookup: `combiner` for merging a list of artifacts, `.map()` for any other reshape. No other utility transforms a value without a model. | `cb:149-160`; `p-blocks:816`; `.map` `apps/docs/docs/sequencers/overview.md:53,169-174` |
| 0.12 | **Strict-mode typing limit on `cascadingRouter`.** Carried from the recipe's sheet: under `strict: true`, an evaluator with a typed question map can fail `ask`'s type (TS2322) because `ask` is typed `AnyEvaluatorBlock`; the example's tsconfig sets `strict: false`. I did not re-run `tsc`. State it as a limit only if the writer re-verifies; otherwise leave it out. | `cas:39-40`; `docs/contributing/docs-revamp/pages/build/route-with-an-evaluator.facts.md:188,193,199` [carried]; `ex` |

## 1. What the page is

A Reference page: one table per group of utility blocks, each row the factory, what it does, input, output (the R-04 plan: "each shipped utility block: what it does, input, output"). Tables and signatures only. Source of rows: `p-util`, checked against `U`. Lookup it must answer by name: "Which block reshapes without a handler?" (0.11).

Import: `import { utility } from "@flow-state-dev/core";` then `utility.<factory>`. `utility` is a namespace export of core's root. There is no `@flow-state-dev/core/utility` subpath: `packages/core/package.json` exports `.`, `./types`, `./harness`, `./internal`, `./items`, `./attachments`, `./prompt`, `./prompt-file`, `./models`, `./capability` and others, not `./utility`. `packages/core/src/index.ts:250` (`export * as utility from "./utility"`); `packages/core/package.json:28-68`.

What `utility` exports (14 factories, plus schemas and types), `ix:1-139`:

- Factories: `contextReducer`, `combiner`, `memoryExtractor`, `summarizer`, `consultSessionHistoryTool`, `historySummary`, `decomposer`, `analyzer`, `intentClassifier`, `intentRouter`, `keyedRouter`, `sessionTitleGenerator`, `upsertResource`, `cascadingRouter`.
- Schemas: `contextReducerDistillOutputSchema`, `contextReducerDenoiseOutputSchema`, `contextReducerCompressOutputSchema`, `combinerOutputSchema`, `memoryCandidateSchema`, `memoryExtractorOutputSchema`, `memoryExtractorTypeSchema`, `summarizerOutputSchema`, `consultSessionHistoryInputSchema`, `historySummaryStateSchema`, `decomposerOutputSchema`, `decomposerTaskSchema`, `analyzerFindingSchema`, `analyzerOutputSchema`.
- Constant: `CONSULT_DEFAULT_BUDGET_TOKENS` (24,000).
- Types: `ContextReducerConfig`, `ContextReducerMode`, `CombinerConfig`, `MemoryExtractorConfig`, `SummarizerConfig`, `SummarizerGranularity`, `ConsultSessionHistoryOptions`, `ConsultTarget`, `HistorySummaryInput`, `HistorySummaryOptions`, `HistorySummaryState`, `DecomposerConfig`, `AnalyzerConfig`, `IntentCategories`, `IntentClassifierConfig`, `IntentClassifierOutput`, `IntentRouterCategories`, `IntentRouterCategory`, `IntentRouterConfig`, `KeyedRouterConfig`, `SessionTitleGeneratorConfig`, `UpsertResourceConfig`, `CascadeAmbiguousReason`, `CascadeBranch`, `CascadeLevel`, `CascadeVerdict`, `CascadingRouterConfig`.
- **Not exported from `utility`:** `cascadeGate`, `routedInputAdapter`, `toUserContent`, `cutToBudget`, `MAX_READING_CHARS`, `HISTORY_SUMMARY_*` constants, `CascadingRouterBlock` (the return type; `cas:150`). `historySummaryResource` is exported from `@flow-state-dev/core/types` only (`hsr:1-11` header). Do not name any of these on the page.

## 2. The blocks at a glance (the table the page leads with)

Kind is the block kind the factory returns. "Model" is the default when none is given. All names `utility.<name>`.

| Factory | Returns | Calls a model | Default model | Takes `outputSchema` | Takes `itemVisibility` |
| --- | --- | --- | --- | --- | --- |
| `contextReducer` | generator | yes | `intent/utility` | yes | yes |
| `memoryExtractor` | generator | yes | `intent/utility` | yes | yes |
| `decomposer` | generator | yes | `openai/gpt-6-luna` | yes | yes |
| `summarizer` | generator | yes | `intent/utility` | yes | yes |
| `analyzer` | generator | yes | `intent/utility` | yes | yes |
| `intentClassifier` | generator | yes | `intent/utility` | yes | yes |
| `combiner` | handler | no | none | yes | no |
| `upsertResource` | handler | no | none | no | no |
| `keyedRouter` | router | no | none | yes | no |
| `intentRouter` | sequencer | yes (its classifier) | `intent/utility`, via `model` passed to the classifier | no | no |
| `cascadingRouter` | sequencer | yes (the evaluators you pass) | none: the router has no `model`; each evaluator carries its own | no | no |
| `sessionTitleGenerator` | sequencer | yes | `openai/gpt-6-luna` | no | no |
| `consultSessionHistoryTool` | sequencer (a tool for a generator's `tools`) | yes | `intent/utility` | no (fixed output union) | no |
| `historySummary` | not a block: `{ capability, fold, resource }` | only through the `summarize` block you pass | none | no | no |

Cites: kinds and models: `an:46-48`, `cr:84`, `dc:52-53`, `me:48-50`, `su:52-54`, `ic:89-91`, `cb:155-160`, `up:40-45`, `kr:59-95`, `ir:46-139`, `cas:248-322`, `st:45-86`, `co:200-284`, `hs:148-351`. Existing table `p-util:23-47`. `intent/utility` is an intent name the app maps to real models; unresolved, it falls back to the resolver's `defaultModel` (`p-models:50,68`; resolver refuses `intents` without `defaultModel`, `packages/core/test/models/create-model-resolver-intents.test.ts:31-36`). The page's "default models" sentence needs only the intent name and a link.

Suggested grouping so no table runs past six rows: (a) six generators, (b) three no-model blocks (`combiner`, `upsertResource`, `keyedRouter`), (c) routers (`intentRouter`, `cascadingRouter`, plus `keyedRouter` if the writer prefers it here), (d) conversation utilities (`sessionTitleGenerator`, `consultSessionHistoryTool`, `historySummary`).

## 3. Per-block facts

Every block takes `name: string`, required except `historySummary` (`hs:131,149`) and `consultSessionHistoryTool` (`co:46,201`), where it defaults. Config tables list only what the code declares.

### 3.1 Shared by the six generator utilities

- Each returns a `generator` block whose `user` slot is the block's input run through `toUserContent`: a string is passed as is, anything else becomes 2-space-indented JSON. So input is any value; none declares an `inputSchema`. `tu:12-18`; `an:60`, `cr:86`, `dc:61`, `me:62`, `su:62`, `ic:93`; test `packages/core/test/to-user-content.test.ts`.
- `model` is `GeneratorConfig["model"]` (a model id string or the generator's accepted forms). `an:26`.
- `outputSchema` replaces the default; the block's output type follows it. `an:44`.
- `itemVisibility` unset by default: output flows to the next block and is not emitted to the client or history. Setting `{ client: true, history: true }` surfaces it; `{ client: false, history: false }` records it for observability only. `p-util:55-60`; `an:29-34` (stale wording, see 0.2); `p-blocks`/`packages/core/src/blocks/generator.ts:1271` (undefined: no auto-emitted items).
- Each fixes its own system prompt; none exposes a `prompt` option. [source]

### 3.2 `contextReducer`

- Config: `name`, `mode?: "distill" | "denoise" | "compress"` (default `distill`), `model?`, `outputSchema?`, `itemVisibility?`. `cr:44-59,79`.
- Output by mode (default schemas), `cr:7-21`:

| Mode | Output | Optional |
| --- | --- | --- |
| `distill` (default) | `{ distilled: string, keyPoints: string[] }` | none |
| `denoise` | `{ cleaned: string, removedCategories?: string[] }` | `removedCategories` |
| `compress` | `{ compressed: string, compressionRatio?: number, dropped?: string[] }` | `compressionRatio`, `dropped` |

- What each mode asks the model for: distill keeps decisions, constraints and implications over wording; denoise removes irrelevant or repeated content and keeps original order and structure; compress cuts to a length or token budget keeping facts, identifiers and constraints, and signals what it dropped. `cr:23-42` [source]. No budget field (0.6).
- The TypeScript default type parameter is the distill schema even when `mode` is another; pass `outputSchema` to get the right inferred type for denoise and compress. `cr:46-49,138-143` [source]. Do not state as a rule unless the writer type-checks it.

### 3.3 `memoryExtractor`

- Config: `name`, `model?`, `outputSchema?`, `itemVisibility?`. `me:25-39`.
- Output: `{ memories: Array<{ type: "fact" | "preference" | "constraint" | "decision", content: string, confidence?: number (0 to 1), source?: string }> }`. `me:7-23`. An empty `memories` array when nothing durable is found (the prompt says so). `me:57-60` [source].
- It only proposes candidates. It writes nothing; the prompt tells the model not to describe persistence. Storing them is your block's job. `me:60`, `p-util:179`.

### 3.4 `decomposer`

- Config: `name`, `model?` (default `openai/gpt-6-luna`), `outputSchema?`, `context?: GeneratorSlot` (extra context in the system prompt), `history?: GeneratorHistoryConfig` (lets it resolve references to earlier turns), `itemVisibility?`. `dc:25-41,53`.
- Output: `{ tasks: Array<{ id: string, title: string | null, goal: string, context: string | null, deps?: string[], priority?: "high" | "medium" | "low" }> }`. `dc:7-23`. `title` and `context` are `null`, never absent, so the schema works with strict structured output. `dc:9-14`; test `t-dc:16-22` ("default output schema is OpenAI strict-compatible"); title and context carried through, `t-dc:23-50`.
- Behaviour the prompt asks for (the output schema does not validate dependency order or the absence of human-waiting tasks, `dc:7-23`; the page says "asked", not "never"): tasks are ones an agent can finish unaided; it never creates a task that asks a human for input and assumes the likeliest intent when the request is ambiguous; `deps` only for real dependencies; tasks ordered so dependencies come first; `context` copies concrete values the task needs, because the worker sees only its own task. `dc:54-65` [source].
- Web search on (0.8).

### 3.5 `summarizer`

- Config: `name`, `model?`, `granularity?: "brief" | "detailed" | "executive"` (default `brief`), `objectives?: string | string[]`, `outputSchema?`, `itemVisibility?`. `su:20-34,42`.
- Output: `{ summary: string, keyPoints?: string[] }`. `su:7-10`.
- Granularity: `brief` is 1 to 2 sentences, the core takeaway; `detailed` is paragraph-level with context and nuance; `executive` focuses on decisions and recommended actions. `su:12-16`.
- `objectives` (a string or a list) is added to the prompt as a numbered "focus the summary on these objectives" list; absent, the line is left out. `su:45-50,57-62`.
- Fits `historySummary({ summarize })` as is: it takes the `{ summary, turns }` input as JSON and returns `{ summary, keyPoints? }`. `hs:123-129`; `p-ctx:350-352`.

### 3.6 `analyzer`

- Config: `name`, `model?`, `criteria?: string[]` (default `["quality", "risk", "coverage", "confidence"]`), `outputSchema?`, `itemVisibility?`. `an:20,22-35,43`.
- Output: `{ findings: Array<{ criterion: string, assessment: string, severity?: "critical" | "warning" | "info", evidence?: string }>, score?: number, recommendation?: string }`. `an:7-18`. No range is enforced on `score` in the schema.
- `criteria` become a numbered list in the prompt, one finding requested per criterion. `an:51-59`.

### 3.7 `intentClassifier`

- Config: `name`, `categories: Record<string, string>` (label to description, required), `model?`, `outputSchema?`, `itemVisibility?`. `ic:7,15-29`.
- Throws at construction with fewer than 2 categories: `intentClassifier requires at least 2 categories in the "categories" map`. `ic:80-82`; test `t-ic:22-30`.
- Output: `{ category: string, confidence: number (0 to 1), reasoning: string (defaults to "") }`. `category` is checked against the label list: any other value fails the block's output validation with `Category must be one of: <labels>`. `ic:31-45`; test `t-ic:61-78`. `IntentClassifierOutput` types `reasoning` as required `string`. `ic:9-13`.
- With your own `outputSchema`, the same category check is added; the schema must produce an object with a `category` string, else it fails with `Output must include a category field`. `ic:47-70,84-87`.
- Each category description goes into the prompt as `- <label>: <description>`. Test `t-ic:31-60`.

### 3.8 `combiner`

- Config: `name`, `outputSchema?`. `cb:20-25`. No model, no `itemVisibility`.
- Input: an array of artifacts, or `{ artifacts: unknown[] }`. `cb:9-14,111-113`.
- Output: `{ combined: unknown, mergeNotes?: string[] }`. `cb:4-7`. `mergeNotes` is absent when no note was written for an all-arrays or all-objects merge; it is always present for mixed input and for empty input. `cb:119,122-146`.
- Merge rules, `cb:115-147`; test `t-cb:13-87`:

| Input | Result |
| --- | --- |
| `[]` | `combined: []`, note `No artifacts provided; returned an empty combined array.` |
| every artifact an array | the arrays concatenated, then deduplicated by value |
| every artifact a plain object | merged key by key, in order; a key in both sides merges recursively; two arrays under one key concatenate and deduplicate; two different scalars (or an object and a scalar) keep the later one |
| anything else (mixed) | artifacts kept in order, exact duplicates removed, note `Mixed artifact types detected; normalized by preserving artifact order and deduplicating exact matches.` |

- Deduplication compares a serialization with object keys sorted, so key order does not matter and two equal objects are one. `cb:31-44,46-61`.
- Notes written: `<path>: deduplicated array entries during merge.` (only when something was removed) and `<path>: conflicting values resolved by taking the later artifact.` (only when two scalars differ). `<path>` is `combined` or `combined.<key>.<key>`. `cb:63-71,82-84,98`.
- Deterministic: same input, same output. [source]

### 3.9 `upsertResource`

- Config (`UpsertResourceConfig`), `up:3-25`:

| Option | Required | Meaning |
| --- | --- | --- |
| `name` | yes | block name |
| `description` | no | block description |
| `inputSchema` | yes | Zod schema of the input |
| `collectionKey` | yes | the key of the target collection on `ctx.resources` |
| `key` | yes | `(input) => string`, the instance key |
| `state` | yes | `(input, ctx) => Record<string, unknown>`, the state to create or patch with |
| `content` | no | `(input) => string \| undefined`, text written after the state |
| `resources` | no | resource declarations the block registers, so the block installs its own collection |
| `sequencerStateSchema` | no | the outer sequencer's state schema, when the block reads or writes sequencer state |

- Behaviour, `up:46-59`: read `ctx.resources[collectionKey]`; compute `key`, `state`, `content`; `getOrCreate(key, state)` (initial state on create only); then always `patchState(state)`; then, if `content` returned a value (not `undefined`), `writeContent(content)`. So state applies on create and on update.
- It returns nothing. In a sequencer, `.tap(block)` leaves the chain value as the input; `.step(block)` makes the next value `undefined`. Test `t-up:196-217` (tap preserves the value). The existing page's sentence about `.step` ("continue on a transformed value returned by a downstream step") is unclear; state the tap/step difference as above.
- It does not check `collectionKey`; a key `ctx.resources` lacks fails at run time inside the block. [source], `up:47`. Keep out unless the writer needs it.
- Scope and persistence come from the collection you point it at, not from this block. `up:15-19`; test `t-up:219-` ("routes through ctx.resources regardless of the resource's intrinsic scope").

### 3.10 `keyedRouter`

- Config (`KeyedRouterConfig`), `kr:42-51`: `name`, `blocks: Record<string, Block>` (required), `select: (input, ctx) => string` (required), `fallback?: Block`, `inputSchema?`, `outputSchema?`. Returns a router block.
- Runs `blocks[select(input, ctx)]`. Aliasing: two keys may name the same block. Test `t-rt:105-118`.
- Unknown key, no `fallback`: throws `[keyedRouter] no block registered under key "<key>" in router "<name>". Available: <keys, comma-separated>`. With `fallback`, runs it. `kr:82-90`; tests `t-rt:120-150`.
- Only own properties of `blocks` count: a key such as `toString`, `constructor`, `valueOf`, `hasOwnProperty`, `__proto__` is an unregistered key, so it takes the fallback or raises the same error. `kr:80-84`; tests `t-rt:152-190`.
- An error thrown by `select` propagates unwrapped. Test `t-rt:192-200`.
- It does no input adaptation: to hand a different shape to a block, call `block.connectInput(...)` on the block first. `kr:23-26` (header); `p-blocks:582`.
- Existing deeper description: `p-blocks:559-582`. A router that must pick from a list with a model uses `intentRouter`; one that must branch on an evaluator's confidence uses `cascadingRouter` (`p-blocks:584`).

### 3.11 `intentRouter`

- Config (`IntentRouterConfig`), `ir:12-27`: `name`, `categories: Record<string, { description: string, handler: Block }>` (required), `fallback?: Block`, `confidenceThreshold?: number`, `model?` (passed to the classifier; default `intent/utility`).
- Returns a sequencer with `inputSchema: z.any()`: step 1 classifies, step 2 routes. `ir:133-138`. Output is whatever the chosen block returns; there is no wrapper schema. `p-util:907`.
- Throws at construction with fewer than 2 categories: `intentRouter requires at least 2 categories in the "categories" map`. `ir:48-50`.
- Routing, in this order, `ir:104-131`:
  1. `confidenceThreshold` set and the classifier's confidence is **below** it (strict `<`; equal passes): run `fallback`; with no `fallback`, throw `intentRouter "<name>" classified "<category>" with confidence <c>, below threshold <t>, and no fallback handler was provided`.
  2. Otherwise run the handler for the classified category.
  3. A category with no handler: run `fallback`, or throw `intentRouter "<name>" produced unknown category "<category>" and no fallback handler was provided`.
  - No threshold set: the top category always wins, whatever its confidence.
  - Errors are raised when the request runs, not at construction.
- Every handler, and the fallback, receives the **original input**, not the classification. A handler's own `connectInput` still applies, to that original input. One handler used under two categories, or as both a category and the fallback, works. Tests `t-ir:49-92,191-214`; `ri:1-46`.
- Names in the trace: classifier `<name>-intent-classifier`, `<name>-intent-router-input`, `<name>-intent-router`. `ir:53,76,105-107` [source]; keep off the page unless a trace row needs it.
- Takes no `outputSchema` or `itemVisibility`.

### 3.12 `cascadingRouter`

Configured by `CascadingRouterConfig`, `cas:133-144`: `name`, `ambiguous` (required block), `root: CascadeLevel`.

- Types: `CascadeLevel = { ask: evaluator block, on: string, branches: Record<optionKey, CascadeBranch> }`; `CascadeBranch = { minConfidence?: number, block: Block } | { minConfidence?: number, next: CascadeLevel }`. `cas:46-58`.
- The router takes no `model`. Each evaluator named in `ask` carries its own. `cas:133-144`.
- Input and output: the router's input is what the root evaluator accepts. Every evaluator, leaf and `ambiguous` receives that same input (the original, not the evaluator's answers). The router returns whatever the chosen block returns, so all leaves and `ambiguous` should return one output type. `cas:81-85,146-155,228-229`; test `e-cas:140-152` (a leaf two levels down receives the action's input).
- A leaf or `ambiguous` with its own `connectInput` keeps it, applied to the original input. Test `e-cas:226-270`; `ri:1-46`.
- Type checks (compile time), `cas:98-127`: `ask` must accept the router's input; `on` must name a choice question of `ask`; every branch key must be one of that question's options; every leaf must accept the router's input. A typo in a branch key is a compile error. Test `packages/core/test/cascading-router.test-d.ts`.
- Build-time refusals (thrown when `cascadingRouter(...)` is called, each message begins `cascadingRouter "<name>": `), `cas:178-219,252-253`; tests `t-cas:180-258`:

| Refused | Message fragment |
| --- | --- |
| no `ambiguous` | `ambiguous is required: the block every edge that doesn't open runs.` |
| a level whose `ask` is not an evaluator block | `the level at "<path>" must ask an evaluator block.` |
| `on` is not a question the evaluator asks | `routes on "<on>", which evaluator "<name>" doesn't ask.` |
| `on` is not a choice question | `routes on "<on>", which is a <type> question, not a choice.` |
| a branch key that is not an option of `on` | `branch "<path>/<key>": "<key>" is not an option of "<on>".` |
| a branch with both `block` and `next`, or neither | `branch "<path>" needs exactly one of block or next.` |
| `block` that is not a block | `branch "<path>": block is not a block.` |
| `minConfidence` outside 0 to 1 (or NaN, or a non-number) | `branch "<path>": minConfidence must be between 0 and 1 (got <value>).` Both 0 and 1 are allowed. |
| a level that contains itself | `the level at "<path>" is already inside itself; a tree can't loop.` |

  `<path>` is `root`, then `root/<optionKey>` for each nested level. When an evaluator's `questions` is a function of the input, the option and question checks happen at the type level only. Test `t-cas:218-225`.
- Gate: how each level decides, `gate:42-60`; table test `t-cas:28-129`:

| The model | Result | Reason in the verdict |
| --- | --- | --- |
| chose an option with a branch, reported a confidence, and it is at or above that edge's `minConfidence` (or the edge has none) | that edge opens | none; `edge` and `confidence` are recorded |
| reported a confidence below the edge's `minConfidence` | `ambiguous` | `below-floor` |
| reported no usable confidence | `ambiguous`, whether or not the edge has a `minConfidence` | `no-confidence` |
| chose an option with no branch, gave no answer to the routed question, or the answer is not a choice | `ambiguous` | `no-branch` |

  - "Usable confidence" is a finite number from 0 to 1. `NaN`, below 0, above 1 and non-numbers count as none. `gate:29-34`; tests `t-cas:68-96`.
  - A floor is inclusive: confidence equal to `minConfidence` opens the edge. `gate:57-58`; test `t-cas:46-57`.
  - An edge with no `minConfidence` opens on any reported confidence, however low (0.2 in the test). Test `t-cas:38-45`.
  - Order matters: an option with no branch is `no-branch` even when no confidence was reported (the branch check runs before the confidence check). `gate:46-55`.
  - A choice's `probabilities` and a boolean's `probability` are never read as confidence. A choice with `probabilities` and no `confidence` is `no-confidence`. Tests `t-cas:68-76,118-128`.
  - There is no default floor and no way to set one for the whole tree; it is per branch. `gate:57-58` [source].
- Ambiguous lands on `ambiguous` at the level where it happened, so a deeper level is never asked. Test `e-cas:196-204` (below the floor at level 1 never asks level 2); `e-cas:167-176` (a level-1 leaf runs without asking level 2).
- Failures: a provider error or refused model fails the router with that error and does not go to `ambiguous`. A `.rescue` on a sequencer around the router catches it. A request cancelled mid-level ends as aborted, not failed, and does not reach `ambiguous`. `cas:1-11` (header), test `e-cas:308-346`.
- On a model that reports no confidence on its answers, every edge is `ambiguous` (`no-confidence`). Which evaluation models report one: Jev (`typesafe-ai/jev`) does for choice questions; the popular providers' evaluation models do not. [doc] `p-util:1045` (not re-run; the gate's behaviour on missing confidence is the tested part).
- **Trace verdicts** (what a reader can see), tests `e-cas:131-137,183-205,271-300,352-361`:
  - Each level is its own sequencer named `<name>/<path>` (`triage/root`, `triage/root/billing`), with three steps: the evaluator, a handler named `<name>/<path>/gate`, and a router named `<name>/<path>/route`. A level reused under two branches is named by each path it was reached by. `cas:262-317`; test `e-cas:271-300`.
  - The gate's recorded output is `{ input, verdict }`. Verdict, `cas:158-160`:
    - edge opened: `{ level: string, on: string, edge: string, confidence: number }`;
    - ambiguous: `{ level: string, on: string, ambiguous: "no-confidence" | "below-floor" | "no-branch", choice?: string }`. `choice` is present only when the answer was a choice with a string value.
  - Example from the tests: `{ level: "root", on: "team", ambiguous: "no-confidence", choice: "billing" }`; at level 2: `{ level: "root/billing", on: "urgency", ambiguous: "no-confidence", choice: "low" }`. `e-cas:190-193,361`.
  - The evaluator's own row records its answer, including any confidence. Block kinds in the trace: sequencer, evaluator, handler, router. `e-cas:352-362`.
  - Levels on branches not taken never run and have no rows. `e-cas:196-204`.
- Resume: a leaf that suspends resumes without asking either evaluator again and on the same route. `e-cas:366-`. [test]
- Use `intentRouter` instead when you want a generator to write the category and its confidence as its output; use `cascadingRouter` when the decision has more than one question or needs the confidence an evaluation model reports with its answer. `p-util:1063`. Use a plain `router` to branch on a bare answer. `p-util:1047-1060`.

### 3.13 `sessionTitleGenerator`

- Config (`SessionTitleGeneratorConfig`), `st:8-18`: `name`, `model?: string` (default `openai/gpt-6-luna`, a model id string only), `messageLimit?: number` (default 4; turns, see 0.4).
- Returns a sequencer with `inputSchema: z.unknown()`: a generator, then a `.tap` handler that stores the title. `st:83-85`. Sub-block names `<name>:generate` and `<name>:persist`. `st:50,73`.
- The generator reads the last `messageLimit` turns of the session's history, including the current request's output, and is told the current title (`(none)` when unset). It returns `{ title: string }`. The prompt asks for 3 to 8 words, sentence case, no quotes or periods or "Session:" prefix, and to leave an already descriptive title alone. `st:55-69`.
- The handler trims the title and, only when it is non-empty and differs from `ctx.session.metadata.title`, calls `ctx.session.setMetadata({ title })`. Same or empty: nothing written. `st:76-79`.
- Output: `{ title }` from the generator (the persist step is a tap). Discarded under `.sideChain()`; under `.step()` it replaces the value passed downstream. `st:30-32` [doc comment].
- Built for `.sideChain(block)` in a chat sequencer, so it runs after the answer without delaying it. `st:24-33`; `p-util:1228-1233`.
- `setMetadata` persists and emits a `session.metadata.changed` event; `useSession` in `@flow-state-dev/react` refreshes the session detail so a title shows live. `st:26-29`; `p-util:1244-1266` [doc]. `session?.title` on the client; `fsd.sessions.updateMetadata(sessionId, { title })` sets it from outside. `p-util:1260-1264` [doc].
- Takes no `outputSchema` or `itemVisibility`. Keep the "what it does internally" walk-through off the page.

### 3.14 `consultSessionHistoryTool`

Call: `utility.consultSessionHistoryTool(options?)`, returns a tool for a generator's `tools`. A sequencer named `options.name ?? "consultSessionHistory"`. `co:200-202,268-284`.

- Options (`ConsultSessionHistoryOptions`), `co:45-63`:

| Option | Default | Meaning |
| --- | --- | --- |
| `name` | `consultSessionHistory` | the tool's name as the model calls it |
| `model` | `intent/utility` | model the answer runs on |
| `budgetTokens` | 24,000 (`CONSULT_DEFAULT_BUDGET_TOKENS`) | hard cap on history tokens read, counted by the flow's token counter for the answering model |
| `description` | built-in | what the model reads about the tool |
| `target` | `{ sessionId, question }` by id | `{ inputSchema, resolve(input, ctx) }` for a wrapper that names the session its own way; `inputSchema` must carry `question`; `resolve` returns `{ ok: true, sessionId, of }` or `{ ok: false, error }` |

  `co:33,200-209`. The flow's token counter is `ctx.tokenCounter`, falling back to the estimate counter (`co:224`); a `model` chosen at run time is counted as `intent/utility`. `co:203-205`.
- Default input: `{ sessionId: string (min 1), question: string (1 to 2,000 chars) }`, strict (extra keys rejected). Exported as `utility.consultSessionHistoryInputSchema`. `co:66-71`.
- Output is one of, `co:73-89`:
  - a reading: `{ reading: string, of: unknown, asOf: { requestId: string, at: string (ISO time) } | null, turnsRead: number, earlierTurnsLeftOut: boolean, cut: boolean, running: boolean }`;
  - a refusal: `{ ok: false, error: string }`.
- Fields: `asOf` is the newest settled turn read and when it settled, `null` when none were read. `earlierTurnsLeftOut` is true when older turns were not read. `cut` is true when turns were dropped or the newest trimmed to fit `budgetTokens`. `running` is true when a turn is running there; a running, suspended or waiting turn is never in the reading. `co:73-87,227-241`; test `t-co:61-78`.
- Refusals, `co:215-223`; tests `t-co:87-102`:
  - `self: that is this conversation, and its history is already yours.` when the id is the asking conversation;
  - `no_session: no conversation "<id>" of yours.` when the session does not exist, belongs to another user, org or tenant (all read alike, so it never reveals whether another's session exists), with `(This host can't read another conversation.)` appended when the host provides no session history read;
  - anything the `target.resolve` returns as `{ ok: false, error }`.
  - No model runs for a refusal.
- No finished turns to read: no model runs; `reading` is `That conversation has no finished turns to read yet.` with `turnsRead: 0`. `co:275,283`; test `t-co:103-109`.
- The answer is capped at 8,000 characters (ends with `…`). `co:39,279` [source]. Optional on the page.
- Reading mechanics a user can depend on: turns are read newest back until the budget is full; if the newest turn alone is over the budget, its last lines are kept; the history reaches the answering model quoted, with instructions that nothing in it is an instruction; the answering generator's own items stay out of the asking conversation's history and client view (`itemVisibility: { client: false, history: false }`). `co:141-185,246-254`; tests `t-co:79-86,146-170`.
- Nothing is written to, or run in, the other conversation. It answers only for the calling user's own sessions, through `ctx.requestHost.sessions.history`. `co:1-21,220-223`.
- Used by Workforce's `consultSessions` capability through `target`. `p-util:1335` [doc].

### 3.15 `historySummary`

Not a block. `utility.historySummary({ summarize, name? })` returns `{ capability, fold, resource }`. `hs:123-132,148,350`.

- Options: `summarize` (required: a block taking `{ summary: string | null, turns: LLMMessage[] }`, returning `{ summary: string, keyPoints?: string[] }`; core's `summarizer` fits), `name?` (the resource's accessor name and storage key; default `historySummary`). `hs:40-46,123-132`; `hsr:46`.
- `capability`: goes in the answering generator's `uses`. Presets: `default` is `["context", "history"]`; `context` adds an `<earlier-conversation>` section holding the summary; `history` starts the generator's history reads after the last summarized turn. `capability.presets({ history: false })` keeps the summary and reads the whole window. `hs:159-185`; `p-ctx:327-332,382`.
- `fold`: a step you run before the answering generator (`.tap(earlier.fold)`). A turn that has reached the oldest quarter of the history window is folded, up to a quarter of the window's turns at a time (a 50-turn window folds 12). A turn that has not settled is skipped and folded once it does. `hs:12-18,195,247-256`; `p-ctx:362-364`.
- Failure: a failed `summarize` call does not fail the turn; the turn answers with the summary it had and the next turn retries. A warning is logged: `[historySummary] "<name>" fold failed; the next turn retries:`. `hs:309-337`; `p-ctx:366-368`.
- Fold step missing: once a turn has left the window and no fold has run, the answering generator throws, naming the missing step: `historySummary "<name>": turns have left the history window and no fold has run. Run its fold step before this generator (\`.tap(<name>.fold)\`, or workforce's \`beforeAnswer\`).` `hs:165-173`; `p-ctx:370`.
- The stored summary is capped at 8,000 characters; key points are kept under it, under a `Key points:` header. `hs:49-90`. Wrapper tags inside the summary are escaped before the model reads it. `hs:92-105`.
- Full prose and the UI divider recipe belong to `p-ctx`, not to R-04.

## 4. The four questions, for each stored part

Only these utilities store anything. The rest return values and write nothing (`contextReducer`, `memoryExtractor`, `decomposer`, `summarizer`, `analyzer`, `intentClassifier`, `combiner`, `keyedRouter`, `intentRouter`, `cascadingRouter` return only their output; `consultSessionHistoryTool` reads another session and writes nothing: `co:1-21`).

| Stored part | Who owns it | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| `upsertResource`'s target instance | the app: the collection you declare and point `collectionKey` at; this block writes into it | whatever that collection's `client` config exposes; the block adds no rule | wherever that collection's scope and store put it; "the collection's intrinsic scope and ref decide where its instances persist" | one instance per value `key(input)` returns; written again on later calls | 
| `sessionTitleGenerator`'s title | the session; stored as session metadata `title` | clients that read the session: `useSession(sessionId).data.title`; a `session.metadata.changed` event reaches connected streams | the session's metadata in the app's session store | one title per session; each run may replace it |
| `historySummary`'s resource | the conversation (session scope); installed by the block, not by the flow | the client sees only `throughRequestId`, `complete` and `folds`, under `snapshot.resources.session.<name>.clientData` in `client.sessions.state(sessionId)`; the summary text is not exposed | a session-scoped resource, default name `historySummary`, in the app's store | one per session per `name`, however many generators install the capability |

Cites: `up:15-19,46-59`; `st:76-79`, `p-util:1244-1266`; `hsr:46-60` (`scope: "session"`, `client: { expose: [...] }`), `hsr:7-11,40-44`; `p-ctx:374,384`. The stored fields of the history resource: `summary`, `throughRequestId`, `throughStartedAtMs`, `nextRequestId`, `nextSettledRequestId`, `pending`, `gap`, `complete`, `folds`, `attempts`. `hsr:13-37`. State them only if the page documents the resource; the client-visible three are the reference-worthy part. The resource is `writable: true`. `hsr:59`.

## 5. Rows moved to R-04 by other pages (disposition of each)

`grep -rhE --include=*.record.md -e '→ R-04( \(corrected by pass 5\))?$' docs/contributing/docs-revamp/pages` returned three rows, all from `build/route-with-an-evaluator.record.md:89-91`. Each checked against the code.

| Moved row | Verdict | Where it lands |
| --- | --- | --- |
| `cascadingRouter` fields: level `{ ask, on, branches }`, branch `{ block } \| { next }` with optional `minConfidence`, branch keys type-checked against the question's options, the router takes no model of its own, `ambiguous` required. | **True. Carried.** | 3.12: types, type checks, build refusals; `cas:46-58,98-127,133-144,252` |
| `cascadingRouter` on a model with no confidence: every edge resolves to `ambiguous`, with or without `minConfidence`. | **True. Carried.** | 3.12 gate table; `gate:55`; tests `t-cas:58-76`, `e-cas:183-195` |
| `cascadingRouter` trace verdicts: how an `ambiguous` result is recorded, including the `no-confidence` reason (the below-minimum reason sits beside it). The recipe keeps the pointer to a plain `router` for branching on the bare answer. | **True for the verdict part. Carried, with the clause "the recipe keeps the pointer to a plain `router`" dropped.** That clause describes the recipe page, not behaviour; it is not an R-04 fact. The plain-`router` fallback for models without confidence is on the existing page (`p-util:1047-1060`) and is a one-line pointer if the writer wants it. | 3.12 trace verdicts; `cas:158-160`; `e-cas:190-193,361` |

Nothing else in the revamp's records is routed to R-04.

## 6. Existing-page content not carried, and why

- All "Common use cases" bullets, the "Realistic example" blocks, the end-to-end pipelines and the sample JSON outputs: narrative and tutorial, not Reference rows. The sample outputs are model-made illustrations, not a contract (and the combiner note in 0.5 is untrue).
- `contextReducer` "when to reach for each mode" prose: kept only as one clause per mode (3.2).
- `p-util:1243-1253` "What it does internally" for `sessionTitleGenerator`: mechanism; cut. The two-step shape is carried once, as the returned sequencer.
- "An app that sets `intents` must set `default` too" (the `consultSessionHistoryTool` section): a models-page fact, not a utility fact. The resolver refusal is cited at `packages/core/test/models/create-model-resolver-intents.test.ts:31-36` if a link is wanted; the page only needs "map `intent/utility` once" and a link to Models.
- The existing page's four-row cascadingRouter table, the "Which models route" paragraph and the `plain router` snippet: carried as facts above; the snippet is an example for a recipe, not for a reference table.
- `readme:197-209`: the README's per-factory lines disagree with the code in one place (decomposer output, 0.7) and call `consultSessionHistoryTool` and `historySummary` out in full. A README fix is a separate change; flag it, do not copy its decomposer line.

## 7. Limits a reader would otherwise assume away

- No utility declares an `inputSchema` except `combiner` (array or `{ artifacts }`), `upsertResource` (yours), `consultSessionHistoryTool` (default `{ sessionId, question }`) and the routers' pass-through (`z.any()` / `z.unknown()`). The six generators take any value. `cb:9-14`, `up:10`, `co:66-71`, `ir:135`, `cas:319`, `st:83`, `tu:12-18`.
- `memoryExtractor` stores nothing; `analyzer` and `intentClassifier` route nothing; `intentClassifier` alone does not dispatch.
- `cascadingRouter` has no default floor; the same goes for `intentRouter`, whose threshold is off unless set.
- `keyedRouter` does not adapt input and does not call a model.
- `consultSessionHistoryTool` reads only the calling user's own sessions and never runs, wakes or writes the other conversation.
- `historySummary` needs its `fold` step run before the answering generator or it throws once turns have left the window.

## 8. Draft disposition

- All three R-04 rows carried (section 5). The clause "the recipe keeps the pointer to a plain `router`" is dropped, as 5 says; the page keeps the plain-`router` pointer for models that report no confidence.
- Finding 0.12 (strict-mode typing limit) is left off the page: not re-verified.
- Left off as mechanism or narrative: trace block names of `intentRouter`, the `cutToBudget` reading mechanics beyond newest-first, stored fields of the history resource beyond the three client-visible ones, the `contextReducer` type-parameter default.
- Page's examples: `routeTicket` plus all three sibling blocks are shown as titled files, each a core `handler({ name, execute })`. Type-checked in revise round 3 (see below).

## 9. Rows moved off this page (pass 6, revise round 1)

Each paragraph below left the page and is a row for the target page, which the page links. R-01 `blocks`, R-03 `sequencer-methods`, R-06 `items`, R-08 `resources`, R-21 `models`, R-22 `errors`. The facts above (3.x) stay true; they are the source for the rows.

| Row | Target | Fact-sheet source |
| --- | --- | --- |
| `intent/utility` is mapped by the model resolver; unmapped falls to `defaultModel` | R-21 | section 2 |
| Visibility flags `client` and `history`: unset, both true, both false | R-06 | 3.1 |
| `.tap` vs `.step` after a block that returns nothing | R-03 | 3.9 |
| Router branches receive the router's original input; `connectInput` reshapes it (cascadingRouter). keyedRouter and intentRouter now state it on this page too (revise round 3); R-03 keeps the general row | R-03 | 3.10, 3.11, 3.12 |
| Router on an answer with no confidence: plain `router` branches on the bare answer; a cascade level goes to `ambiguous` and asks no deeper level | R-01 | 3.12 |
| Provider error, refused model, cancellation inside a router | R-22 | 3.12 |
| Cascading router trace rows, gate `verdict` records, suspended leaf resumes without re-asking evaluators | R-06 | 3.12 |
| `sessionTitleGenerator` `.sideChain()` vs `.step()` output. Its metadata write and `session.metadata.changed` moved back onto this page (revise round 3) | R-06 | 3.13 |
| `historySummary` fold failure and missing-fold error | R-22 | 3.15 |
| `historySummary` session resource: owner, client-visible fields, key, count | R-08 | section 4 |
| `upsertResource` write semantics | R-08 | 3.9 |

Left out as mechanism: the `consultSessionHistoryTool` quoted-history prompt wording and the `sessionTitleGenerator` "told the current title" prompt input.

## Revise round 2 notes

- Link targets: models is `concepts/models.md` and there is no reference blocks page; the no-confidence behavior is carried by the page's own "How a level decides" table.
- The trace verdict shape (3.12 "Trace verdicts") now sits on the page itself, not behind a link to the items page.
- The route-ticket example imports three sibling blocks; the page shows `billing-reply.ts` as a minimal `handler({ name, execute })` and says the other two are the same shape (type-check in pass 4 failed without the siblings, passed with stubs of this shape).

## Revise round 3 notes

- Examples: `route-ticket.ts`, `billing-reply.ts`, `technical-reply.ts`, `human-review.ts` are all on the page. Extracted at their titled paths under `apps/kitchen-sink/.docs-tc-R-04/`, `tsc` with `strict: true`, `moduleResolution: "bundler"`, against workspace `@flow-state-dev/core` (`packages/core/dist/index.d.ts`): exit 0. Removing `human-review.ts` gives TS2307 on `./human-review`, so the check reaches the imports. Folder deleted.
- `intentRouter` (3.11), re-checked: strict `<` at `ir:105-108`; the below-threshold throw at `ir:113-115` is an `Error` raised inside the router's `execute`, so at request time; the only construction throw is `ir:48-50`. Original input, not the classification, reaches the handler via `routedInputAdapter(input => input.originalInput)` `ir:61`; a handler's own `connectInput` applied to it, test `t-ir:71-91`; original input forwarded, test `t-ir:191-214`. The page fills the message for the worked case (`route-ticket`, `billing`, 0.62, 0.7) from the template at `ir:114`. Pointing to `intentClassifier` for the classification itself follows 3.7 and section 7.
- `keyedRouter` (3.10), re-checked: own-property lookup `kr:82-84`; fallback before throw `kr:85-86`; message `kr:87-90` (keys joined with `", "`); `toString` and the other prototype keys fall back or throw, tests `t-rt:152-190`; `select` errors unwrapped, test `t-rt:192-200`; no model and no input adaptation, header `kr:23-26`.
- `sessionTitleGenerator` (3.13), re-checked: `.sideChain()` usage, header `st:24-43`; `messageLimit` default 4 and turn definition `st:11-17,47`, passed as `history: { limit }` `st:55`; trim and conditional `ctx.session.setMetadata({ title })` `st:76-79`; `session.metadata.changed` emitted `packages/engine/src/context/createExecutionContext.ts:3367`, dispatched to `onSessionMetadataChanged` `packages/client/src/stream-client/streams.ts:746`, merged into the session detail's `title` by `useSession` `packages/react/src/hooks/useSession.ts:1571-1586` [source].

