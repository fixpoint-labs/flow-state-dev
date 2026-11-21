# Fact sheet: Models (R-21, reference, `reference/models`)

Pass 1. Cites only: existing user docs (`apps/docs/**`), the exported surface and its doc comments, tests, `goals/`,
and one example (`labs/teammates`). No spec was read. The rows other pages' depth passes moved here (the `→ R-21` lines
in the `*.record.md` files) are checked in section 1; every one is carried, corrected or named as dropped.

Marks: **[run]** I ran it in this pass with a throwaway vitest file (an in-memory resolver over `MockLanguageModelV3`),
deleted afterwards. **[test]** a committed test asserts it. **[read]** I read the code and no test pins it; pass 5
should run it before the page states it. **[doc]** only an existing user page says it.

Abbreviations (all under `/home/user/flow-state-dev/`):

| Abbr | File |
|---|---|
| `cmr` | `packages/core/src/models/createModelResolver.ts` |
| `pd` | `packages/core/src/models/providerDetection.ts` |
| `ffm` | `packages/core/src/models/fallbackModel.ts` |
| `sm` | `packages/core/src/models/selectModel.ts` |
| `rp` | `packages/core/src/models/reorderByPreference.ts` |
| `cch` | `packages/core/src/models/caching.ts` |
| `mt` | `packages/core/src/models/types.ts` |
| `cam` | `packages/core/src/models/createAiSdkModelResolver.ts` |
| `evl` | `packages/core/src/models/evaluate.ts` |
| `evg` | `packages/core/src/models/evaluationModelGateway.ts` |
| `tm` | `packages/core/src/types/model.ts` |
| `gen` | `packages/core/src/blocks/generator.ts` |
| `evb` | `packages/core/src/blocks/evaluator.ts` |
| `cmg` | `packages/core/src/capability/merge.ts` |
| `cpt` | `packages/core/src/capability/types.ts` |
| `uie` | `packages/core/src/errors/unresolved-intent-error.ts` |
| `dep` | `packages/core/src/helpers/deprecation.ts` |
| `crg` | `packages/core/src/utility/cascading-router-gate.ts` |
| `mi` | `packages/contracts/src/types/model-identity.ts` |
| `ct` | `packages/contracts/src/items/types.ts` |
| `cfs` | `packages/engine/src/flowstate/createFlowState.ts` |
| `fst` | `packages/engine/src/flowstate/types.ts` |
| `cth` | `packages/engine/src/transports/host/createInboundTransportHost.ts` |
| `mo` | `packages/fsdev/src/model-override.ts` |
| `mdoc` | `apps/docs/docs/fundamentals/models.md` |
| `cdoc` | `apps/docs/docs/advanced/custom-model-resolver.md` |
| `idoc` | `apps/docs/docs/streaming/items.md` |
| `tmm` | `labs/teammates/host.mts`, `labs/teammates/fsdev.config.mts` |

Tests, all under `packages/core/test/models/`: `create-model-resolver-intents.test.ts` (`t-int`),
`create-model-resolver-env-overrides.test.ts` (`t-env`), `create-model-resolver-intent-defaults.test.ts` (`t-def`),
`create-model-resolver-colon.test.ts` (`t-col`), `create-model-resolver-evaluation.test.ts` (`t-eval`),
`create-model-resolver-preference.test.ts` (`t-pref`), `fallback-model.test.ts` (`t-fb`), `caching.test.ts` (`t-cch`),
`model-identity.test.ts` (`t-id`), `slash-multi-hop-rejection.test.ts` (`t-slash`).

---

## 0. Where each name lives

- `createModelResolver`, `selectModel` and `IntentDefaults` are exported from `@flow-state-dev/core` (`packages/core/src/index.ts:408-415`). `createModelResolver`, `createAiSdkModelResolver`, `wrapAiSdkModel`, `createFallbackModel`, `isRetryableError`, `detectAvailableProviders`, `parseModelString`, `applyCaching`, `DEFAULT_CACHING_CONFIG` and the `selectModel` types are exported from `@flow-state-dev/core/models` (`packages/core/src/models/index.ts`). The existing page imports from the subpath. **[read]**
- Provider packages are not dependencies of `core`. The resolver loads them by name when it needs them: `@ai-sdk/anthropic` (`createAnthropic`), `@ai-sdk/openai` (`createOpenAI`), `@ai-sdk/google` (`createGoogle`); gateways `@ai-sdk/gateway` (`createGateway`) and `@openrouter/ai-sdk-provider` (`createOpenRouter`). `cmr:125-134`; `packages/core/package.json:185-206` (`@ai-sdk/openai` is only a dev dependency). **[read]**
- `createFlowState({ models })` builds the resolver with `createModelResolver`. `FlowStateModelsConfig` has seven fields: `default`, `intents`, `gateways`, `retryPolicy`, `providers`, `providerPreference`, `keys` (`fst:33-41`). They map to `defaultModel`, `intents`, `gateways`, `retryPolicy`, `providers`, `providerPreference`, `keys` (`cfs:215-227`). **`intentDefaults` and `env` are not forwarded.** To use either, build the resolver yourself and pass it as `createFlowState({ modelResolver })` (`fst:191-196`, `cfs:1044-1046`: `modelResolver` replaces `models` entirely). **[read]**, and `fst:191-196` says it in a doc comment.
- Existing page `mdoc` says `models.default` and `models.intents` "are forwarded to the model resolver the runtime builds for you" and shows `createFlowState({ models: { default, intents } })`. True. It does not say the other two options are not forwarded.

---

## 1. Rows other pages moved here

Each row is a claim. Verdict, then where it appears in section 2 onward.

| # | Source row (page, short) | Verdict | Where |
|---|---|---|---|
| 1 | run-a-starter: default model, fixed OpenAI model for helper calls, what another provider needs | **Carried, narrowed.** True of the Teammates starter only, not the framework. | 2.14 |
| 2 | models (concept): intents table, `default` required once any intent exists; answers for unconfigured intent and when no model in the list can be reached | **Carried.** "Reached" means resolvable when the generator resolves, not a runtime failure. | 3.2, 3.3 |
| 3 | models: fallback and retry, list order, retry up to attempt limit, generate vs stream, errors list each model | **Carried, one clause dropped as untrue.** "An error after content has started is never retried on another model" is false for a retryable error. A stream that throws a retryable error after yielding chunks moves to the next model and the next model's text follows the first's. **[run]** | 5.1 to 5.5 |
| 4 | models: an intent's list skips unusable models; an array on a generator does not skip, it throws at resolve | **Carried.** True. | 3.4, 4.4 |
| 5 | models: `selectModel`, `preferProvider` reorders before key checks | **Carried.** | 4.5 |
| 6 | models: provider keys and gateways table; `FSDEV_INTENT_<NAME>` per environment | **Carried.** | 6, 7 |
| 7 | models: what is recorded, `model.actual` and `model.requested`, and what `requested` holds for an intent | **Carried, extended.** `requested` also holds the default model string when an intent fell through. **[run]** | 9 |
| 8 | models: where a model is set (generator forms, evaluator one model, capability generator-only, block wins) | **Carried.** | 4 |
| 9 | utility-blocks: `intent/utility` mapped by the app; unmapped falls to `defaultModel` | **Carried.** | 2.12, 3.3 |
| 10 | worker-md: `intent/chat` as the worker `model` default, resolver maps it | **Carried.** | 2.12 |
| 11 | cli: model override goes through the configured resolver, not evaluator strings, not queue background work | **Carried.** | 7.6 |
| 12 | glossary: model resolver, string format, fallback order, custom resolvers | **Carried as a pointer**, the page holds the detail. | 2, 5, 8 |
| 13 | blocks: evaluator build and run refusals with exact messages; string resolves through `resolveEvaluationModel`, no fallback resolver | **Carried.** | 10 |
| 14 | blocks: which evaluation models report confidence; missing confidence and `cascadingRouter` | **Carried.** | 10.6 |
| 15 | patterns: intents used as pattern defaults, a `model` option overrides them | **Corrected.** Not every pattern default is an intent: five internal generators default to the literal `openai/gpt-6-luna`, and the supervisor's reviewer and synthesizer take no `model` option. | 2.13 |
| 16 | generators: array is a fallback group, per-attempt waits, stream once per model | **Carried.** Wait formula is `min(maxDelayMs, baseDelayMs * 2^(attempt-1))`; with the defaults only one wait (1,000 ms) ever happens. Stream: see row 3. | 5 |
| 17 | generators: prompt caching defaults, breakpoints and ttl, per-provider markers | **Carried.** | 11 |
| 18 | generators: what the trace captures of the model input; identity stamp on items and trace row | **Split.** The identity stamp is carried (9). What `block_trace.generator` holds of the prompt and messages is the generator page's (R-29 owns the trace). Only the model fields of the trace are here. | 9 |
| 19 | errors: model-call retry and fallback | **Carried** (same as rows 3, 16). Its "provider-load and message-prepare failures skip to the next model only before the first chunk" is true (`ffm:266-268`). | 5 |
| 20 | environment: resolution rows (no installed package error; thrown at `resolver(...)` time; gateway key; direct beats gateway; `provider/model` falls through, `name:model` never; empty-group error names two gateway keys; `typesafe-ai/` needs a gateway key) | **Carried, one clause corrected.** `typesafe-ai/...` needs a *gateway that supports evaluation*, not strictly `AI_GATEWAY_API_KEY`: an OpenRouter key alone gives `Gateway "openrouter" does not support evaluation models`. **[test]** `t-eval:154-169` | 6, 10 |
| 21 | environment: `env` replaces `process.env` only for `FSDEV_INTENT_<NAME>` and `FSDEV_DEFAULT_MODEL` | **Carried.** True: `detectAvailableProviders` is called without `env` (`cmr:721-724`). | 7.4 |
| 22 | environment: override rows (name mapping, one `provider/model` or `name:model`, error prefix, collisions, undeclared warn, default applies without intents, literal `model:` unchanged, warning silenced by `NODE_ENV=production` or `FSD_QUIET_WARNINGS=1`) | **Carried.** | 7 |
| 23 | route-with-an-evaluator: how each credential reaches an evaluation model; which strings the gateway does not serve; the default `typesafe-ai/jev` | **Carried.** The "gateway does not serve OpenAI's as an evaluation model" part is **[doc]** only (it depends on the gateway service). | 10 |

Nothing is dropped outright. Row 18's prompt-capture half and row 3's final clause are the only parts left off the page, and each is named above.

---

## 2. Model string format

2.1 A model string is trimmed first; an empty string throws `Model string cannot be empty.` `pd:170-174`. **[read]**

2.2 Three forms. The parser decides by position:
- **`name:model`**: the first `:` comes before the first `/` (or there is no `/`). `name` is everything before the first colon; the model id is everything after it, untouched, later colons and slashes included. `openrouter:openai/gpt-oss-20b:free` asks the route `openrouter` for `openai/gpt-oss-20b:free`. A missing name or a missing model id throws `Invalid model format: "<s>". A named route needs a name and a model id, e.g. "vercel:openai/gpt-6.1-sol" or "openai:gpt-6.1-sol".` `pd:176-188`. **[test]** `t-col`, `t-slash`.
- **`provider/model`**: exactly two slash-separated parts, where the colon (if any) comes after the slash. `openai/gpt-oss:free` is provider `openai`, model id `gpt-oss:free`. `pd:190-203`. **[read]**
- **`intent/<name>`**: two parts with `intent` first. `<name>` must match `^[a-zA-Z][a-zA-Z0-9_-]*$` or it throws `Invalid intent name: "<name>". Intent names must match ...` `pd:152,192-201`. `intent/a/b` throws `intent/* model strings must be 2 parts (intent/name).` `pd:205-209`. **[test]** `t-int:66-91`.

2.3 Any other shape (a three-part slash string such as vercel/anthropic/claude-sonnet-5.5, or a one-part string with no colon) throws `Invalid model format: "<s>". Expected "provider/model" (e.g., "openai/gpt-6.1-sol") or a named route "name:model" (e.g., "vercel:openai/gpt-6.1-sol").` `pd:211-215`. **[test]** `t-slash`. The message gives the colon form as an example; it does not print the rewritten string. The existing page says it "names its colon spelling": loosely true. Migration notes are cut from this page by the page plan.

2.4 When a bad string fails depends on where it sits. In `defaultModel`, an intent candidate, `FSDEV_INTENT_*` or `FSDEV_DEFAULT_MODEL` it fails when the resolver is built (`cmr:490-523,563-580`). On a generator it fails the first time that string is resolved, which can be inside a request (`cmr:1378`). On an evaluator, `checkModelConfig` calls `parseModelString` when the block is built (`evb:150-157`), so a malformed string (`Invalid model format`) or an intent string throws at build; an unknown route, a missing key or a missing package throws at first resolution. **[test]** `t-slash:57-80`.

2.5 Name resolution for `name:model` (`classifyRoute`, `cmr:415-438`): a name is a gateway when it is a key of `gateways` (with a non-null value) or the built-in `vercel` or `openrouter`; else a provider when it is a key of `providers` (value not `undefined`) or the built-in `openai`, `anthropic`, `google`; else it throws `Unknown route "<name>" in "<s>". The name before ":" must be a key of providers or gateways, or a built-in one (providers: anthropic, openai, google; gateways: vercel, openrouter). Registered: <list or (none)>.` Own keys only, so `constructor:x` is unknown. **[test]** `t-col`, `create-model-resolver-named-gateways.test.ts`.

2.6 One name, one route. `createModelResolver` throws when a name is a key of both `providers` and `gateways` (`createModelResolver: "<name>" is a key of both providers and gateways, so "<name>:<model>" would name two routes. Rename one of them.`) or when a `providers` key is `vercel` or `openrouter` (`... is a providers key and the name of the built-in <name> gateway ... Rename the provider, or pass the instance under gateways.`). `cmr:441-458`. **[test]** `create-model-resolver-named-gateways.test.ts`.

2.7 The lane decides routing (`cmr:674-688` doc comment): `provider/model`, "the provider directly, else a configured gateway"; `name:model`, "a named route, pinned ... Never falls through"; `intent/name`, the intent's group. **[read]**

2.8 The id reaches the provider or gateway exactly as written; the framework does not respell it (`cmr:1108`: the gateway fall-through passes `${providerName}/${modelId}`). Which spelling a service accepts is the service's rule. `mdoc` says Anthropic writes `claude-sonnet-5-5` with hyphens and the Vercel gateway `claude-sonnet-5.5` with dots. **[doc]** (service naming; not checkable here).

2.9 `resolver.resolveId(modelString, { preferProvider? })` returns the concrete string: input unchanged for a non-intent string (after classifying a colon string, so an unknown route throws); for an intent, the first candidate (after preference reordering) that resolves, else `defaultModel`, else the input. `cmr:1385-1418`; `tm:329-352`. **[read]**

2.10 `resolver.providerOf(modelString)` names the provider a string's call reaches: `anthropic` for `vercel:anthropic/...`, the route name for a provider route such as `triage:native`, `unknown` for an intent or any string that would throw. `cmr:996-1017`. **[read]**

2.11 `canonicalizeIntentName(name)` is `name.toUpperCase().replace(/-/g, "_")` (`pd:161-163`); used for env overrides (section 7).

2.12 Intent names the framework itself asks for, by default, when no model is given (verified in source, not only in docs):
- `intent/utility`: `contextReducer`, `memoryExtractor`, `summarizer`, `analyzer`, `intentClassifier` (`packages/core/src/utility/context-reducer.ts:84`, `memoryExtractor.ts:50`, `summarizer.ts:54`, `analyzer.ts:48`, `intent-classifier.ts:91`); `consultSessionHistoryTool` (`consult-session-history.ts:202`); `intentRouter` through its classifier; the skills classifier and activator (`packages/orchestration/src/skills/skill-classifier-gen.ts:68`); and the generator's `repair.coerce` pass (`gen:390`, used by `gen:1156-1166`). **[read]**
- `intent/chat`: a worker's `model` setting when neither the worker file nor the flow's `model` option sets one (`packages/workforce/src/agent-worker-flow.ts:134,276,468`). **[read]**
- Patterns: see 2.13.
- The existing page documents six names: `utility`, `chat`, `plan`, `synthesize`, `code`, `reason`. The code accepts any name that matches the regex (2.2), and no source file asks for `plan`, `code` or `reason` by default. **[doc]**. The framework has no built-in model lists for any intent: an intent with no config resolves through `defaultModel` (3.3).

2.13 Pattern defaults (`packages/patterns/src`), for the pattern pages to link, not to restate:
- `intent/synthesize`: supervisor reviewer and synthesizer (`supervisor/index.ts:159,228`, no `model` option on either); plan-and-execute executor (`plan-and-execute/index.ts:346`); debate moderator, synthesizer and judge (`debate/blocks/default-moderator.ts:62`, `default-synthesizer.ts:74`, `default-judge.ts:101`); round-robin referee and synthesizer (`round-robin/blocks/default-referee.ts:43`, `default-synthesizer.ts:41`).
- `intent/chat`: debate debater (`default-debater.ts:67`); round-robin roster agent (`default-roster-agent.ts:95`).
- Literal `openai/gpt-6-luna`: plan-and-execute replanner, synthesizer and the LLM evaluator (`plan-and-execute/index.ts:275,571`, `blocks/evaluate-progress.ts:156`); `routedSpecialists` controller and synthesizer (`routedSpecialists/index.ts:184,279`); the goal synthesizer (`shared/planning-entry.ts:276`). Each takes a `model?: string` option that replaces it. So a pattern can need an OpenAI key (or a gateway) even when the app configures no intents. **[read]**
- Where a pattern takes `model?: string` it overrides that pattern's default for its internal generators (`round-robin/index.ts:140`, `debate/index.ts:179`).

2.14 Example (the Teammates starter). Its server passes `models: { default: options.model, intents: { utility: ["openai/gpt-6-luna"] } }` (`tmm` host.mts:108). The default for `options.model` is `process.env.TEAMMATES_MODEL ?? "openai/gpt-6-luna"` (`fsdev.config.mts:24`). So `TEAMMATES_MODEL` changes the worker model and never the `utility` intent, which stays on `openai/gpt-6-luna`; with only an Anthropic key, utility calls (every default `intent/utility` block above) need an OpenAI key or a gateway key. To use another provider for those calls the app config must change, and that provider's package must be installed (3.4). **[read]** Starter-specific: the page should name it as the one worked example, not as a framework default. The framework itself has no default model.

---

## 3. Intents

3.1 An intent is a named, ordered list of candidate model strings, `intents: { chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"] }`. A generator uses it as `model: "intent/chat"`. `cmr:82-83,1149-1206`.

3.2 `defaultModel` is a single model string. It is required when `intents` has at least one entry: `createModelResolver: defaultModel is required when intents are configured` (`cmr:482-488`). An empty `intents: {}` needs none (`t-int:93`). It must be `provider/model` or `name:model`, never `intent/*`: `createModelResolver: defaultModel must not be an intent/* string (got "<s>").` (`cmr:490-497`). An intent candidate that is `intent/*` throws `createModelResolver: intent "<name>" candidate "<c>" must not be an intent/* string.` (`cmr:516-522`). A bad intent name throws `createModelResolver: invalid intent name "<name>". Must match <regex>.` (`cmr:501-505`). All checked at construction. **[test]** `t-int:31-91`.

3.3 What answers when the intent is not usable (`cmr:1149-1206`):
- Intent name not in `intents`, or its list is empty: a development warning `[flow-state-dev] Unknown or empty intent "<name>"; falling back to defaultModel.` (once per process per intent), then `defaultModel`. **[test]** `t-int:157`.
- Every candidate fails to resolve (see 3.4): `defaultModel`.
- No `defaultModel` either: throws `UnresolvedIntentError`, `name "UnresolvedIntentError"`, `code "unresolved_intent"`, `retryable: false`, `details: { intent }`, message `No model is configured for "intent/<name>": the app sets no `models.intents.<name>` and no `models.default` to fall back on. Set one where the app creates its FlowState (`createFlowState({ models: { default: "<provider>/<model>" } })`, or `defaultModel` on `createModelResolver`), or set the FSDEV_DEFAULT_MODEL environment variable.` `uie:10-32`. **[test]** `t-int:139`; **[run]** (code `unresolved_intent`).
- **A runtime failure of every candidate does not fall to `defaultModel`.** The default is used only when no candidate could be resolved when the intent was resolved. If candidates resolved and then all fail on the call, the call throws `All models in group "intent/<name>" failed:` and one line per attempt (5.4). **[run]** The existing page says "If the whole list is unreachable, it falls back to the resolver's `defaultModel`"; true for resolution, not for call-time failure.
- When the default answers, the model is the plain default model, not a group: no retry and no fallback around it (`cmr:1194-1196`). **[read]**

3.4 What "resolvable" means for a candidate (`tryResolveSingleModel`, `cmr:1131-1140,1177-1192`): resolving the candidate string must not throw. For `provider/model` that means: an entry for the provider in `providers` whose factory does not throw, or the provider's package installed and its key set, or a gateway that can serve it (section 6). For `name:model` it means the route works (6.5). A candidate that does not resolve is dropped silently from the list; the rest keep their order. The package is only resolved on disk at this point, not executed (`cmr:179-184`). **[test]** `t-int:123,205,244,285`.

3.5 Intent resolution is cached per `(intent name, normalised provider preference)`, so a resolver holds one group per pair for its lifetime. `cmr:764-768,1155-1157`. Changing `intents` or the environment after construction has no effect (7.3). **[read]**

3.6 Resolver-level `providerPreference` and the per-call `preferProvider` reorder an intent's candidates (4.5).

---

## 4. Where a model is set

### 4.1 Generator `model`

`model?: ResolvableModel` on `generator({...})` (`gen:599`). `ResolvableModel` is a string, a `string[]`, a `GeneratorModel` instance, or a function `(input, ctx) => string | string[] | GeneratorModel | ModelSelection` (sync or async) (`gen:283-290`). **[read]**

4.2 Resolution at each run (`resolveModelValue`, `gen:715-772`): a function is called with the block's input and context; a `selectModel` result with a `preferProvider` is unwrapped and the preference is passed down as the per-call option. Then:
- a string: `ctx.resolveModel(string, blockName, callOptions)`, so an intent, a plain string and a named route all go through the app's resolver;
- an array: an empty array throws `Generator "<name>" model array cannot be empty`; otherwise a fallback group named `<blockName>-fallback`, with the candidates in array order, retried with a **fixed** `{ maxAttemptsPerModel: 2, baseDelayMs: 1000, maxDelayMs: 10000 }`. The resolver's own `retryPolicy` is not used for an array (`gen:754-759`). The trace's `generator.model` is the array's first entry (`gen:760,3112`). **[read]**
- a `GeneratorModel` instance: used as it is, with no resolver and no fallback;
- anything else: throws `Generator "<name>" model must resolve to a model id string, string array, or GeneratorModel instance`.

4.3 A generator with no `model` of its own and none from a capability throws when the block is built: `Generator "<name>" requires a model. Set one on the block or via a capability that contributes `model`.` (`gen:2908-2912`). **[read]**

4.4 **Array vs intent when a provider is unusable.** An intent drops candidates that do not resolve (3.4). An array does not: each string is resolved immediately, in order, when the generator resolves its model (`gen:750-755`), so one string whose provider has no key, no package and no gateway throws from `ctx.resolveModel` before any model is called, even when an earlier entry would have answered. **[read]** (nothing pins it; the throw is the same as `resolver("<s>")` throwing, which `t-int:285` pins.)

4.5 `selectModel(default, rules)` (`sm:104-140`; exported from `@flow-state-dev/core`):
- `default` is `string | string[]`; `rules` is one rule or an array. A rule is `{ preferProvider: (input, ctx) => string | string[] | null | undefined }` or `{ when: (input, ctx) => boolean, use: string | string[] }`; both callbacks may be async. `input` and `ctx` are the block's.
- Rules run in order. The first `preferProvider` rule that returns a non-null, non-empty value sets the preference; later ones are skipped. The first `when` that is true sets the model; later ones are skipped. The two kinds do not short-circuit each other.
- Result: the bare model (string or array) when no preference was collected, otherwise `{ model, preferProvider }`.
- A preference reorders only an **intent** (`resolver(modelId, blockName, { preferProvider })` consults it only for `intent/*`, `cmr:1378-1382`). On a plain string it has no effect. In an array, the call's `preferProvider` is passed to `ctx.resolveModel` for each entry (`gen:716-751`), so an entry that is `intent/<name>` is reordered and a plain `provider/model` or `name:model` entry is not. `rp:189-212`: the candidate list is regrouped by provider (stable): the preferred providers first in the order given, then the rest in their original order; a provider name no candidate has changes nothing; duplicates and blank names are dropped. The reorder happens before candidates are resolved, so a preferred provider with no key or package is skipped like any unusable candidate, not an error (`cmr:1175-1192`). Provider names come from `providerOf` (2.10), so `vercel:anthropic/claude-sonnet-5.5` counts as `anthropic`. **[test]** `t-pref`, `reorder-by-preference.test.ts`.
- A call's `preferProvider` replaces the resolver's `providerPreference` for that call (`cmr:1153-1154`). `providerPreference` on `createModelResolver` is the default for every intent (`cmr:73`). **[test]** `t-pref`; `t-int:180`.

4.6 `providerOptions` and `caching` on the generator are covered in sections 11 and 12.

### 4.7 Evaluator `model`

`model: string | EvaluationModel`, required (`evb:344-349`). Checked when the block is built (`checkModelConfig`, `evb:143-170`), each failing as `Evaluator "<name>": <message>`:
- an intent string: `"intent/x" is an intent. An evaluator takes one model, not an intent, a fallback list or selectModel.`
- an array or a function: `an evaluator takes one model, not an intent, a fallback list or selectModel.`
- a text model (it can generate but has no evaluation method): `the model can generate but not evaluate.` then a newline and `Pass an evaluation model, e.g. openai.evaluationModel("gpt-6-luna"), or a model string.`
- anything else that is not a string or an evaluation model: `model must be a model string or an evaluation model, e.g. openai.evaluationModel("gpt-6-luna").`
- a string that does not parse (bad format) throws the parser's `Invalid model format` at build.

**[read]**; `packages/core/test/evaluator.test.ts` covers the refusals (pass 5 should confirm the exact strings by running). Resolution is in section 10.

### 4.8 Capabilities

A capability can set `model`, `providerOptions` and `caching` in a preset (`cpt:143-147`). They are generator-only. A capability used by any other block kind throws at merge: `Capability "<name>" <source> declares model, but the consuming block is a <kind>. model is only valid on generator blocks.` (the same for `providerOptions` and `caching`) (`cmg:607-632`). Among several capabilities the last one wins (`cmg:607-614`, `acc.model = surface.model`); the block's own setting wins over any capability (`gen:2905-2926`: only filled `=== undefined`). **[read]**; the evaluator's `uses` doc says capabilities "cannot supply an evaluator's model, tools or context" (`evb:387-390`).

---

## 5. Fallback and retry

All of this belongs to a **group**: an intent with at least one resolved candidate (`groupName` `intent/<name>`), or a generator's model array (`<blockName>-fallback`). A single string or an instance has no group and nothing added here.

5.1 Order: candidates are tried in list order (for an intent, after the preference reorder and with unusable ones dropped). `ffm:168-205,229-275`. **[test]** `t-fb`.

5.2 `generate` (non-streamed) per model, up to `maxAttemptsPerModel` attempts (default 2). After a failed attempt that is retryable and not the last, it waits `min(maxDelayMs, baseDelayMs * 2^(attempt-1))` ms, then tries the same model again. Defaults: 2 attempts, `baseDelayMs` 1000, `maxDelayMs` 10000; so with the defaults one wait of 1,000 ms; with 3 attempts the waits are 1,000 then 2,000. After the last attempt it moves to the next model. `ffm:179-203`. **[test]** `t-fb:187-222`.

5.3 What ends a model's attempts at once and moves to the next (generate path): a non-retryable error, or a provider-load error (a provider or gateway package that is installed but failed to load; `error.name === "ProviderLoadError"`). `ffm:188-192`. **[test]** `t-fb:223,242`.

5.4 Retryable means (`isRetryableError`, `ffm:41-76`, checked in this order): (1) the error has a boolean `isRetryable`: that value; (2) the error is a `LoadAPIKeyError` (`constructor.name` `LoadAPIKeyError` or `AI_LoadAPIKeyError`): not retryable; (3) it has `statusCode`: retryable only for 429, 500, 502, 503; (4) its message contains `fetch failed`, `ECONNREFUSED` or `ETIMEDOUT`: retryable; otherwise not. A non-`Error` value is not retryable. **[test]** `t-fb:75-150`.

5.5 When every model fails, the call throws one `Error` whose message is `All models in group "<group>" failed:` then, for each failed attempt, `  <modelId>: <message>` on its own line. A model that was attempted twice appears twice. `ffm:152-156,207`. **[run]** (`All models in group "intent/chat" failed:|  anthropic/c1: boom`). If every candidate failed only because its messages could not be prepared for its provider (an attached file its provider cannot take), the first such error is thrown instead (`ffm:152-154`). `createFallbackModel` called with an empty list throws (an intent never does: `resolveIntent` falls to `defaultModel`, or throws `UnresolvedIntentError` with none, 3.4): `Model group "<name>" has no available models. Configure API keys for at least one provider in the group, or set AI_GATEWAY_API_KEY / OPENROUTER_API_KEY for gateway access.` (`ffm:313-318`); a generator's empty array throws its own message (4.2).

5.6 **Streaming** (`stream` and `streamStep`, `ffm:218-279`): each model is tried once, no retry and no wait.
- Fails with a retryable error: moves to the next model, **whether or not it had already yielded chunks.** **[run]**: a first model yielding `a` then throwing a retryable error, and a second yielding `b`, produced `a`, `b`, `finish`. A caller that renders chunks as they arrive therefore sees both.
- Fails with a non-retryable error: thrown to the caller at once, before or after chunks. **[test]** `t-fb:374`.
- A provider-load error or a message-prepare failure before the first chunk: moves to the next model (`ffm:266-268`). After the first chunk it is checked as any error (a `ProviderLoadError` is not retryable by 5.4, so it is thrown). **[test]** `t-fb:342`; **[read]** for the after-chunk case.
- When every model fails: `All streaming models in group "<group>" failed:` plus the same per-attempt lines. Reached only when every failure was retryable (or a skip case).
- Existing page `mdoc` ("Retry and Fallback") says "fallback only works before the first chunk arrives ... a mid-stream failure propagates to the caller". The code does that for a non-retryable error and moves on for a retryable one. In practice AI SDK 7 reports a provider error part in the middle of a stream as a `finish` chunk with `finishReason: "error"` rather than a throw (`packages/core/test/models/ai-sdk-model-resolver.test.ts:831`), so the common mid-stream failure does not reach this loop. **[test]** for that last point, **[run]** for the first. Pass 5 should decide the wording; the safe sentence is "A stream is tried once per model" plus the three bullets above.

5.7 The resolver's `retryPolicy` (`CreateModelResolverOptions.retryPolicy`, also `models.retryPolicy` on `createFlowState`): `{ maxAttemptsPerModel?, baseDelayMs?, maxDelayMs? }`, defaults 2, 1000, 10000 (`cmr:112-116,715-718`; `mt:87-95`); applies to intent groups only. A generator's array uses the fixed values in 4.2. **[read]**

5.8 A single model string (no group) gets no framework retry or fallback. (The AI SDK's own retry inside a call is its own default; evaluation turns it off, 10.4.) The generator-level `retry` policy and tool retry are Errors (R-22).

5.9 Tool-loop note: the group exposes `generateStep` and `streamStep` over the candidates that implement them, and each step call picks a candidate independently (`ffm:285-309`), so a step's fallback can hand the next model a history another provider produced. The code comment calls this a known limit. **[read]** Not for the page unless a reader needs it; flagged here as a limit.

---

## 6. Providers, keys and gateways

6.1 Keys, one per built-in provider (`pd:8-18`):

| Provider | Variable | Package |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic` |
| `openai` | `OPENAI_API_KEY` | `@ai-sdk/openai` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` |
| Vercel gateway (`vercel`) | `AI_GATEWAY_API_KEY` | `@ai-sdk/gateway` |
| OpenRouter gateway (`openrouter`) | `OPENROUTER_API_KEY` | `@openrouter/ai-sdk-provider` |

The `keys` option (`{ openai: "...", anthropic: "..." }`) is checked before the environment variable (`pd:52-58`); it is for the three built-in providers. **[test]** `provider-detection.test.ts`.

6.2 Availability order (`detectAvailableProviders`, `pd:44-123`): (1) direct keys; (2) gateways configured in `gateways`, in key order; (3) gateways whose env var is set. A provider already available keeps its earlier source, so **a direct key beats a gateway** for the same provider, and a configured gateway beats an environment-detected one. A gateway (config with a key, a raw instance, or an env key) makes `anthropic`, `openai`, `google` available through it. **[test]** `provider-detection.test.ts`; `t-int:205`.

6.3 `provider/model` resolution (`resolveSingleModel`, `cmr:1066-1121`), first match wins:
1. an entry for the provider in `providers` (a function, or an object with `languageModel`): use it; if its factory throws, fall to step 3;
2. the provider's package, when its key is set and the package resolves on disk: loaded the first time the model is called, not at resolve time;
3. a gateway that can serve it: an availability entry, else the first usable entry of `gateways` in order (a config with a key, or an instance), else `AI_GATEWAY_API_KEY` (Vercel) before `OPENROUTER_API_KEY` (`cmr:866-897`); the gateway gets `provider/model` as written;
4. otherwise it throws, when step 1's factory did not throw (if it did and the direct package did not also fail to load, that factory's own error is rethrown, `cmr:1011-1017`), `No provider available for "<provider>". Tried: direct package (not installed), gateways (none configured for this provider). Install the provider package, set its API key, or configure a gateway (e.g. AI_GATEWAY_API_KEY).` The "direct package" part reads `(not installed)` when no key is set, and `(failed to load)` when the key is set but the package cannot be resolved on disk (`isPackageProviderAvailable` adds the provider to `directLoadFailed`), so a key with no installed package and no gateway reads `(failed to load)`. A package that resolves but fails on import is a different, lazy error. `cmr:782-790,1223-1232`. **[test]** `t-int:285`; `create-model-resolver-loading.test.ts`.

The error is thrown when the string is resolved (when `resolver("<s>")` is called, or when a generator starts), not when the app starts (an intent candidate with this problem is dropped instead, 3.4). **[test]** `t-int:285`.

6.4 A key set with the package not installed, and no gateway, gives the same step-4 error (the key does not help). With a gateway key set, the same string runs through the gateway instead, which is why `openai/...` keeps working on a host that bundles no `@ai-sdk/openai`. **[test]** `t-int:244`; **[doc]** `mdoc` "Direct-then-gateway fallback".

6.5 `name:model` never falls through (`cmr:1048-1065,963-995`):
- a **gateway route** (`vercel:`, `openrouter:`, or a `gateways` key): uses that gateway. A key is needed: for a config entry its `apiKey`, else the env var of its type; an instance needs none. Missing: `No API key found for gateway "<name>". Set <ENV_VAR> environment variable.` (`cmr:1060-1061,952-961`);
- a **provider route** (`openai:`, `anthropic:`, `google:`, or a `providers` key): uses that provider only. Failure: `"<s>" names the <name> provider, but <reason>. A "name:model" string does not fall back to a gateway; write "<name>/<modelId>" to allow one.` where `<reason>` is `no API key is set (<ENV_VAR>)`, `its package "<pkg>" is not installed`, or `it is not usable as a language-model provider` (a name with no env var). **[test]** `t-col`.

6.6 `gateways: Record<string, GatewayConfig | instance>` where `GatewayConfig = { type: "vercel" | "openrouter", apiKey? }` (`mt:12-13,75-78`). The key of each entry is the route name for `name:model`. Two entries of one `type` with different keys are two accounts. A pre-created instance (`createGateway({ apiKey })`) avoids dynamic package loading, which is the form to use where a bundler cannot find the package (`cmr:44-56`; `mt:80-85`). **[test]** `create-model-resolver-named-gateways.test.ts`.

6.7 `providers: Record<string, provider>`: keys are the names in `name/model` and `name:model`. A value is a function `(modelId) => languageModel` or an object with `languageModel(modelId)` (`cmr:354-370`). A provider you register wins over the installed package and the environment key for that name. Other providers still auto-load. **[read]**

6.8 Gateway key coverage for non-built-in providers: the availability map covers the three built-in names only (`mt:5`), but a `provider/model` string for any other provider name still falls to a gateway that has a key through step 3 of 6.3. **[read]** Not for the page unless useful.

6.9 Retry of `LoadAPIKeyError`: not retryable, falls to the next model (5.4).

---

## 7. Per-environment overrides

7.1 Two variables, read from `process.env` at construction (`cmr:543-544,594-638`):

| Variable | Replaces |
|---|---|
| `FSDEV_INTENT_<NAME>` | the candidate list of the declared intent `<name>`; it becomes a one-element list |
| `FSDEV_DEFAULT_MODEL` | `defaultModel` (or `models.default`) |

`<NAME>` is the intent name uppercased with `-` turned into `_`: `chat` gives `FSDEV_INTENT_CHAT`; `my-custom` gives `FSDEV_INTENT_MY_CUSTOM` (`pd:161-163`). **[test]** `t-env:243`.

7.2 A value is one model string: `provider/model` or `name:model`. Not accepted: `intent/*`, an empty or whitespace-only value, a bad format, an unknown route, a comma-separated list (it is not one valid string). Each throws at construction with the variable's name: `createModelResolver: <VARIABLE> must be a non-empty string.`; `createModelResolver: <VARIABLE>: <parser or route error>` (for example `createModelResolver: FSDEV_INTENT_CHAT: Invalid model format: "garbage". ...`); `createModelResolver: <VARIABLE> must be a 'provider/model' or 'name:model' string; received "intent/foo".` `cmr:558-580`. **[test]** `t-env:81-135`, `t-slash`.

7.3 Read once, at construction. Setting a variable after the resolver exists has no effect (the intent cache is built from the construction-time values). `cmr:697-699,764-768`. **[read]**

7.4 `env` option: `createModelResolver({ env })` replaces `process.env` as the source of **only** these two variables. Provider and gateway keys still come from `keys` or the real `process.env` (`cmr:721-724`, `namedGateway` `cmr:956-959`). `createFlowState({ models })` has no `env`, so it always reads `process.env` (1, section 0). **[test]** `t-env:255`; **[read]** for the key part.

7.5 What happens to a variable that names something the app does not declare:
- `FSDEV_INTENT_<NAME>` for an intent not declared: a development warning once, then ignored: `[flow-state-dev] FSDEV_INTENT_NOSUCH does not match any declared intent (declared: chat, plan, utility); ignoring the override.` (`(none)` when none declared). `cmr:619-632`. **[test]** `t-env:136,153,349`.
- `FSDEV_DEFAULT_MODEL` applies with or without declared intents; a malformed one throws even with no intents (`t-env:163,172`).
- Two declared intents that canonicalise to one name (`my-custom`, `my_custom`) throw at construction whether or not the variable is set: `createModelResolver: intent names "my-custom" and "my_custom" both map to environment variable FSDEV_INTENT_MY_CUSTOM, which is ambiguous. Rename one to avoid collisions for env-var overrides.` `cmr:506-515`. **[test]** `t-env:55`.
- Variable names are matched case-sensitively and exactly (`FSDEV_INTENT_` prefix then the canonical name).

7.6 Reach:
- A literal string on a block (`model: "openai/gpt-6.1-sol"`) is not changed by either variable; only intents and the default are. `cmr:647-668`. **[read]**; the existing precedence list in `cdoc` ("Precedence") states it.
- Effective order for an intent: (1) the block's literal string, (2) the intent's `FSDEV_INTENT_<NAME>`, (3) the intent's in-code list, (4) `FSDEV_DEFAULT_MODEL`, (5) in-code `defaultModel`. Items 3 to 5 are the fall-through 3.3. **[doc]** `cdoc`, consistent with the code.
- `intentDefaults` stay attached to the intent name: an override replaces the list only, and a provider key block for a provider that does not win is dropped (8.4). **[test]** `t-env:278`.
- Each applied override logs once per process in development: `[flow-state-dev] Intent "<name>" overridden by FSDEV_INTENT_<NAME>; resolves to "<model>".` and `[flow-state-dev] defaultModel overridden by FSDEV_DEFAULT_MODEL; resolves to "<model>".` Silenced by `NODE_ENV=production` and by `FSD_QUIET_WARNINGS=1`; the override still applies. The once-per-process key is the variable name, so two resolvers with the same override log once. `cmr:701-713`; `dep:19-40`. **[test]** `t-env:305-430`.
- **`fsdev` flag `--model <id>`** (`-m`) forces every generator that runs in the command's process onto one model id, replacing whatever the generator asked for, including an intent: the forced id goes through the app's resolver, so its gateways and providers apply (`mo:15-28`; `fsdev run`/`chat`: `run.ts:482-488`, `chat.ts:234-242`). It does not touch evaluator model strings (their resolution goes to the base resolver unchanged, `mo:20-26`, **[test]** `fsdev/test/model-override.test.ts`). `fsdev dev` with an `fsdev.config.*` exits 2 with `--model can't be combined with fsdev.config.*; the config builds the router with its own resolver. Set the model in the config, or pass --no-config.` (`dev.ts:325-331`). Without a config, a bare default resolver is wrapped.
- The override does not reach background work handed to a queue. At the dispatch that loses it, the host logs at warn level: `[flow-state] the model override on this run does NOT apply to background work dispatched to a queue: request "<id>" (flow "<kind>") will run under the worker's own model configuration, not the override. Generators in this process still use it.` `cth:779-787`. **[read]**

7.7 Answer to the lookup "How do you override an intent per environment?": set `FSDEV_INTENT_<NAME>` (one model string) in that environment, or `FSDEV_DEFAULT_MODEL` for the fall-through; the intent must be declared in the app's `intents`. `fsdev --model` is the per-command form.

---

## 8. Custom resolvers and `intentDefaults`

8.1 The contract an app can supply (`ModelResolver`, `tm:329-395`; `createFlowState({ modelResolver })` `fst:191-196`; `createFlowApiRouter({ modelResolver })`, `cdoc`): a callable `(modelId, blockName?, options?: { preferProvider? }) => GeneratorModel` that is also given
- `resolveId(modelId, options?) => string` (required);
- `resolveEvaluationModel?(modelId, blockName?) => EvaluationModel | Promise<EvaluationModel>` (optional; section 10.3);
- `providerOf?(modelId) => string` (optional; used to label entries of a model array, with `extractProviderName`'s guess as the fallback, `gen:748-749`);
- `prepareMessages?` (the engine sets this for a run; an app resolver need not).
**[read]**

8.2 Helpers: `createModelResolver(options)` (the full resolver), `createAiSdkModelResolver(fn)` (wraps a function `(modelId) => AI SDK language model`, or a provider object such as the `openai` export; `resolveId` returns the id unchanged, no intents, no fallback; `cam:1161-1181`), `wrapAiSdkModel(languageModel, modelId?, { requested?, gateway? })` (a single instance as a `GeneratorModel`, `cam:810-819`). **[read]**

8.3 `createModelResolver` options (`cmr:44-106`): `keys`, `gateways`, `retryPolicy`, `providers`, `providerPreference`, `defaultModel`, `intents`, `intentDefaults`, `env`. **[read]**

8.4 `intentDefaults: Record<intentName, { providerOptions?: Record<provider, Record<string, unknown>> }>` (`mt:55-62`; `cmr:84-95`):
- Every key must be a key of `intents`, or construction throws `createModelResolver: intentDefaults key "<k>" is not a defined intent. Defined intents: <list or (none)>.` (`cmr:526-536`). **[test]** `t-def:39-58`.
- Applied when a candidate of that intent runs: only the sub-object for the provider that won (by `providerOf`), the other providers' sub-objects dropped silently. Merge is deep, with the call's own `providerOptions` winning on a collision; keys that do not collide from both survive. `ffm:93-124`; `mt:37-62`. **[test]** `t-def:77-153,210`.
- Not applied when the intent fell through to `defaultModel`: the default has no intent context (`cmr:90-93`). **[test]** `t-def:184`.
- Captured at construction (`mt:47-51`).
- Precedence, low to high: intent default, generator `providerOptions`, then the prompt-cache marker (set only when absent, 11.5). `cdoc` "Precedence"; consistent with `ffm:107-121` and `cch:116-130`.
- The extra `intentDefaults` shape is `providerOptions` only (`mt:55-62`; the existing page says future fields will be added; not stated here).
- Unreachable from `createFlowState({ models })` (section 0).

8.5 Testing: `createMockModelResolver({ generators?, models?, evaluators?, policy?, onUnmocked?, unmockedDefault? })` from `@flow-state-dev/testing` (`packages/testing/src/mocks/mockGenerator.ts:239-246`). `evaluators` scripts evaluator blocks that name a model string; without it the mock resolver has no `resolveEvaluationModel` and such a block refuses to run. Unmocked generators throw under `policy: "error"` (the default). `cdoc` "Testing". **[read]**

8.6 **Contradiction with `cdoc` "Provider Search Tools"** (not R-21; for the tools page R-42). The page says `createModelResolver()` handles provider search tools "automatically". In code, models it builds (package-loaded, explicit-provider and gateway ones) return `undefined` from `resolveSearchTool` (`cmr:304-307,335`; `wrapAiSdkModel` passes no provider-tools object, `cam:818`), so `search: true` finds no tool and is silently skipped (`gen:3080-3085`). Search tools resolve on `createAiSdkModelResolver(providerObjectWithTools)` (`cam:1119`; `provider-search-tools.test.ts`). Code wins; **[read]**.

---

## 9. What is recorded about the model that answered

`ModelIdentity` (`mi:17-34`; re-exported from `core/types`, `tm:6-9`):

| Field | Meaning |
|---|---|
| `actual: string` | Always set. The provider-reported model id when the provider reports one (for example `gpt-6.1-sol-2026-04-12`), else the winning candidate string. |
| `requested?: string` | What the caller asked for, set only when it differs from `actual`. |
| `gateway?: string` | The gateway type that routed the call (`vercel`, `openrouter`), when one did. |

9.1 How the fields are filled (`buildResolvedIdentity`, `cam:832-843`): `actual = providerReportedId ?? candidate string`; `requested = hint ?? candidate string`; `requested` omitted when equal to `actual`; `gateway` when the hint carries one. **[test]** `t-id`.

9.2 What `requested` holds (`cmr:1170-1183,1050,1070`): for a call through an intent, the intent string `intent/<name>` (also when a later candidate won) **[run]** `{"actual":"c1","requested":"intent/chat"}`; for a plain string, that string **[run]** `{"actual":"c1","requested":"openai/c1"}` (present because the provider reports its id without the provider prefix, which differs from the string); for a gateway route, the string with `gateway` set; **for an intent that fell through to `defaultModel`, the default model's own string, not the intent name** **[run]** `{"actual":"gpt-x","requested":"openai/gpt-x"}` (`cmr:1142-1147`: the default is resolved with no identity override). For an array, each entry carries its own string.

9.3 Where it appears:
- On a generator's `message` (`ct:457`), `reasoning` (`ct:485`), `source` (`ct:612`) and `tool_output` (`ct:366`, "the generator that invoked this tool") items, and on the transient `tool_call_progress` items (`gen:2375,2399`). Handler-emitted messages (`ctx.emit.message`) carry none (`ct:451-457`). `idoc` "Observable model identity" says the same. **[read]**
- On the `block_trace` row for a **generator and an evaluator**: top-level `model` (`ct:228-239`), populated even when the generator emits no items, absent for other block kinds and for a generator that failed before any model call returned. Siblings: `generator.model` (the string the block asked for; the first entry for an array, `gen:760,3112`), and `modelUsage.model` (same requested string) with `promptTokens`, `completionTokens`, `totalTokens`, `providerMetadata?`, `cacheReadTokens?`, `cacheCreationTokens?` (`ct:265-273`); an evaluator also has `evaluator { model, questions }` (`ct:261-264`). **[read]**
- In `onCompleted(output, ctx, meta)` of a generator: `meta.model` is a `ModelIdentity`, always set on the success path (`gen:473-485`). Handlers, sequencers and routers keep two arguments. `mdoc`. **[read]**
- An evaluator's identity (`evl:139-147`): `actual` = `result.response.modelId`; `requested` = the block's string (or `<provider>/<modelId>` for an instance) when different; `gateway` when the evaluation model came through a gateway route (`vercel`, `openrouter` or a `gateways` key; the page states this observable condition) (`evg:20-27`). A model instance the author built, or one a custom resolver returned, has no gateway. **[read]**

9.4 Who, where, how many (the four questions):
- **Owner:** the request that ran the generator. Identity is part of the items and trace row of that request.
- **Who sees it:** items by their own visibility (`message`, `reasoning`, `tool_output` follow `itemVisibility`; `source` and `tool_call_progress` are client-visible and not in history, per the existing items page). The `block_trace` row is not in the normal client stream: it is forwarded only on a stream opened with `?include=trace` (`packages/engine/src/routes/stream-routes.ts:106,178,247`); it is for the DevTool. **[read]** (visibility defaults are R-06's).
- **Where stored:** with the request's items and its trace; nothing outside the request. The resolver itself stores nothing: its caches (`cache`, `intentCache`, loaded provider and gateway packages) live in the process (`cmr:732-767`). Prompt-cache contents live with the provider, not the framework.
- **How many:** one identity per item the generator emits; one per generator run on the trace row (one per evaluator run).

---

## 10. Evaluation models

10.1 A model for an `evaluator` block must be able to evaluate, which is a separate capability from generating (`evb:1-22`). A provider or gateway exposes it as `evaluationModel(id)`; the core `EvaluationModel` type is described as what that call returns (`types/evaluation.ts`). A resolver returns it through `resolveEvaluationModel`. **[read]**

10.2 A string is resolved through the app's resolver (`resolveModelString`, `evb:215-238`), at first execution: `ctx.resolveModel.resolveEvaluationModel`. If the resolver has no such method: `Evaluator "<name>": cannot resolve model string "<s>": the app's model resolver has no resolveEvaluationModel hook. Add resolveEvaluationModel to the resolver, or pass an evaluation model instance.` The framework does not substitute its own resolver. If the hook returns something that cannot evaluate: `Evaluator "<name>": the model resolver returned a model for "<s>" that cannot evaluate.` An evaluation model **instance** never consults the resolver. **[read]**; `create-model-resolver-evaluation.test.ts` covers the built-in hook.

10.3 `createModelResolver`'s own `resolveEvaluationModel(modelString)` (`cmr:1327-1371`):
- an `intent/*` string is refused: `"<s>" is an intent. An evaluator takes one model string, not an intent.` **[test]** `t-eval:180`;
- `name:model`: a gateway route asks that gateway's `evaluationModel(id)`; a provider route asks the registered or installed provider's. **[test]** `t-eval:63-90`;
- `provider/model`: the registered provider (`providers`) or the installed, keyed provider package first, else a gateway. Same order as a generator string, through each source's `evaluationModel`. **[test]** `t-eval:63-99`;
- **`typesafe-ai/...` always goes through a gateway**, even when `providers["typesafe-ai"]` is registered or the library is installed and keyed; with no gateway it throws `No provider available for "typesafe-ai". ...` `cmr:136-142,1340-1359`. **[test]** `t-eval:100-152`. To reach the library, register it under `providers` and use a colon string (`typesafe-ai:jev-latest`, 4.7) or pass `typeSafeAi.evaluationModel("jev-latest")`. `mdoc` says the gateway and the library name the model differently (`jev` vs `jev-latest`); **[doc]**;
- a source that has no `evaluationModel` is refused before any request: `Gateway "<name>" does not support evaluation models, so "<s>" cannot be used by an evaluator. Use a provider or gateway with evaluation support, or pass an evaluation model instance.` (`Provider "<name>" ...` for a provider). When the source came from an installed package the message instead says `The installed "<pkg>" has no evaluationModel; upgrade it to a release with evaluation support, or pass an evaluation model instance.` `cmr:1240-1258`. **[test]** `t-eval:154-178`;
- nothing can serve it: `No provider available for "<provider>". Tried: ...` (the 6.3 error). **[test]** `t-eval:191`.
The AI SDK's global default provider is never consulted (`cmr:1214-1215`; `t-eval:201`).

10.4 One provider call: retries are off (`maxRetries: 0`), no fallback, no intents; the request's abort signal reaches the call. `evl:10-19,104-110`. **[read]** The evaluator's state must be a string, an array or a plain object. (The evaluator page, R-04, owns the rest.)

10.5 Existing page claims, not checkable here: Vercel's gateway needs `@ai-sdk/gateway` 4.0.108 or later for evaluation (an older install gives the "installed package has no evaluationModel; upgrade it" message above); the gateway serves Jev (`typesafe-ai/jev`) as an evaluation model and does not serve OpenAI's models as one, so `openai/gpt-6-luna` with no installed provider and no key goes to the gateway and is rejected; to reach OpenAI's evaluation adapter with only a gateway key, pass an instance made with `createOpenAI({ baseURL: "https://ai-gateway.vercel.sh/v1", apiKey }).evaluationModel(...)`. **[doc]**, depends on the gateway service. The `4.0.108` appears in a test comment (`packages/core/test/evaluator.test.ts:247`) only.

10.6 Confidence. An answer has `confidence` only when the model reported one (`evl:14-16,76-95`): read from `providerMetadata.typesafe.confidence[questionId]`, copied when a finite number; never defaulted; a boolean's `probability` is never copied into it. So only Jev (which writes that metadata) reports confidence; `@ai-sdk/*` evaluation models do not. `cascadingRouter` opens an edge only when the answer is a choice with a branch **and** a finite confidence in [0, 1] that reaches the edge's `minConfidence` (when set); a missing confidence sends every edge to `ambiguous`, reason `no-confidence` (`crg:1-70`; `cascading-router.ts:222-227`). **[read]** The existing evaluation page says Jev reports confidence and the others do not: **[doc]**, consistent with the code (the only reader is `typesafe`). Workforce coordinators' `minConfidence:` is Workforce's (R-25).

---

## 11. Prompt caching

11.1 Every generator caches by default. `caching` on the generator is `{ enabled?: boolean; breakpoints?: "auto" | "manual"; ttl?: "5m" | "1h" }`, or a function `(input, ctx) => CachingConfig | undefined` (`tm:103-126`; `gen:636-646`). Defaults `{ enabled: true, breakpoints: "auto", ttl: "5m" }` (`cch:22-26`); a partial config fills the rest from the defaults (`cch:81-90`). **[read]**; **[test]** `t-cch:17`.

11.2 Behaviour by setting (`applyCaching`, `cch:50-76`):
- `enabled: false`: no markers, any provider. **[test]** `t-cch:30`.
- `breakpoints: "manual"`: nothing is added; the app's own `providerOptions` pass through. **[test]** `t-cch:40`.
- `auto`, by the language model's provider family (the part of the model's `provider` string before the first dot): `anthropic` or `openrouter`: a marker `providerOptions.anthropic.cacheControl = { type: "ephemeral", ttl }` on the **last system message**; `gateway` (any model reached through a Vercel `gateway` instance): a request-level `providerOptions.gateway.caching = "auto"`, and the gateway places breakpoints; anything else (OpenAI, Google, ...): nothing added, those providers cache on their own. `cch:97-114`. **[test]** `t-cch:154-220`.
- Anthropic and OpenRouter get a marker only when the cacheable prefix (system messages plus the JSON of tool definitions) is at least 4,096 characters, a character estimate for about 1,024 tokens; below it nothing is added (`cch:28-34,153-174`). The gateway case has no size check. **[test]** `t-cch:89,102`.
- Never overwrites: a `cacheControl` already on that message, or a `gateway.caching` already set, is kept (`cch:116-130`). **[test]** `t-cch:119,180`.
- `ttl` applies to the Anthropic marker only.

11.3 Usage counters: the generator's usage carries `cacheCreationInputTokens` (tokens written to the cache) and `cacheReadInputTokens` (tokens read), when the provider reports them (`tm:83-97`; `cam:84-123`, from Anthropic's `providerMetadata.anthropic` first, then the SDK's own fields). On the trace row they appear as `modelUsage.cacheCreationTokens` and `cacheReadTokens` (`ct:265-273`). **[read]** The type comments say a cache write bills at about 1.25 times the input rate and a read at about 0.1 (`tm:88-95`); that is provider pricing and not asserted by code. **[doc]** The existing page says the DevTool's token usage panel shows the same numbers per call and aggregated per session; not checked.

11.4 `caching` can be set by a capability preset (4.8).

11.5 Precedence with `providerOptions` (8.4): set-if-absent semantics, so caching never overwrites an option the intent default or the generator set (`cch:116-130`; `cam:458-462`).

---

## 12. Reasoning and provider options

12.1 `providerOptions` on a generator is `Record<string, unknown>` or a function `(input, ctx) => Record<string, unknown> | undefined` (`gen:634,291-293`). It is passed to the AI SDK request untouched (`cam:455-457`), keyed by provider name; the framework does not validate or translate the contents. **[read]**

12.2 Provider-specific settings are the AI SDK's: the existing page shows Anthropic `thinking: { budgetTokens }`, OpenAI `reasoningEffort` (the AI SDK key under `providerOptions.openai`; `capability-block-integration.test.ts:717`), Google `thinkingConfig: { thinkingBudget }` and says the names "occasionally shift". The Anthropic `thinking` shape (`t-def:85`, `fallback-model.test.ts:440`) and OpenAI `reasoningEffort` (`capability-block-integration.test.ts:717,730`) appear in tests; **[doc]** for Google; the page should link the AI SDK rather than list them.

12.3 Reasoning output streams as `reasoning` items with no configuration: the adapter turns the SDK's `reasoning-delta` parts into `reasoning_delta` chunks (`cam:981-985`) and the generator emits them as `reasoning` items (`ct:482-486`; `gen:2316`), each stamped with the model identity (9.3). **[read]**

12.4 Per-intent defaults for provider options: 8.4.

12.5 There is no framework-wide reasoning level (`low`/`medium`/`high`): no code reads one. The existing page's "Forward note: normalized reasoning levels ... on the roadmap" is a roadmap note and is cut. **[read]** (absence)

12.6 For a per-model effort setting, put `providerOptions` on the generator, or on the intent through `intentDefaults` so every generator using the intent gets it; the provider-key filter then drops the settings meant for a provider that did not win (8.4).

---

## 13. Lookups

**In what order are fallbacks tried?**
1. Within an intent: the list's order, after the preference reorder (`providerPreference` or `selectModel`'s `preferProvider`) with unusable candidates dropped. `defaultModel` is not part of the list; it is used only when the intent is unknown or no candidate could be resolved.
2. Within an array on a generator: the array's order, every entry resolved up front.
3. Per model: up to `maxAttemptsPerModel` attempts on a retryable error with `min(maxDelayMs, baseDelayMs * 2^(attempt-1))` ms between them; a non-retryable or provider-load error moves on at once. Stream: one attempt per model.
4. If every model fails, one error lists every attempt.

**How do you override an intent per environment?** 7.7.

---

## 14. Not stated, and why

- Cost multipliers (1.25x, 0.1x) as a promise: provider pricing, not behaviour the framework controls (11.3).
- Which Anthropic or OpenAI model ids exist: model naming is the provider's.
- The "AI SDK 7" section of `mdoc` (Node 22 or newer; `ai` and `@ai-sdk/*` major pairing; MCP redirects; OpenRouter peer warning): release or upgrade notes, owned by the Upgrading page and Environment (the Node floor is `engines.node >=22.3.0`, `packages/core/package.json:180-182`). `allowSystemInMessages: true` is set on every request (`cam:330`), an implementation detail. Not carried.
- "User-facing model selection" (store a model in user state, read it in the generator's `model` function): a recipe, not a reference row. The pieces it uses are all here (4.1, 4.5).
- The worked per-intent examples (`classifyIntent`, `assistant`, `planTasks`, `synthesize`, `reviewCode`, `deliberate`): examples, not facts. The only facts in them: the six intent names are a convention (2.12).
- `assertStrictCompatible` and OpenAI strict-output rules for `outputSchema`: generators' (R-29), not the model resolver's.
- Whether the resolver's retry applies to tool calls or to `generator.retry`: R-22.
- Not run: any call to a real provider or gateway. Every `[run]` mark used an in-memory mock model. The `?include=trace` delivery and the identity on items were read, not run end to end.

## 15. Existing-page statements the code contradicts or narrows

1. `mdoc` Retry and Fallback: "fallback only works before the first chunk ... mid-stream failure propagates": narrower than the code for a thrown retryable error (5.6).
2. `mdoc` Intents: "If the whole list is unreachable, it falls back to defaultModel": true for resolution only (3.3).
3. `mdoc` Prompt Caching: "~1024 tokens (the API activation floor)": the code's check is 4,096 characters of system messages plus tool definitions (11.2).
4. `cdoc` Provider Search Tools: 8.6.
5. `mdoc` Env-var overrides: "Each applied or ignored override emits one dev-only log": applied ones log (7.6); an ignored (undeclared) one also warns (7.5). Consistent.
6. `mdoc` Intents ("Configuring intents"): shows `models.intents` only; `intentDefaults` cannot be set that way (section 0).
7. Neighbour sheets: `concepts/models` row 3 last clause (section 1, row 3); `patterns` row (section 1, row 15).
