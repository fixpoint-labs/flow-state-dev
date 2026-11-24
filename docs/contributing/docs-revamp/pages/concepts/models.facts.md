# Facts for Models (C-18, concept)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example. No spec, issue, changeset or `docs/internal`.

Paths are from the repo root. Abbreviations:

- `fm` = `apps/docs/docs/fundamentals/models.md`
- `sm` = `apps/docs/docs/getting-started/setting-up-models.md`
- `env` = `apps/docs/docs/configuration/environment.md`
- `ss` = `apps/docs/docs/fundamentals/state-and-scopes.md`
- `gen` = `packages/core/src/blocks/generator.ts`
- `res` = `packages/core/src/models/createModelResolver.ts`
- `fb` = `packages/core/src/models/fallbackModel.ts`
- `pd` = `packages/core/src/models/providerDetection.ts`
- `sel` = `packages/core/src/models/selectModel.ts`
- `mt` = `packages/core/src/models/types.ts`
- `ct` = `packages/core/test/models`
- `fs` = `packages/engine/src/flowstate/types.ts` (the `createFlowState` options)
- `hc` = `examples/hello-chat` (the one example that uses it)

Legend: **[page]** the page states it. **[ref]** it belongs on `reference/models` (or `reference/environment`); the page links, does not state it. **[verify]** not confirmed or contradicted by another source; keep off the page or soften. **[cut]** history, mechanism, migration, SDK-version or roadmap note; never on the page.

Page scenario (suggested; the names are not in the code, every fact below is about the framework): a support desk. A `classify` generator reads a ticket and wants a small, fast model. A `reply` generator writes the answer and wants a better one. The app maps the purpose `utility` to a cheap model and `chat` to a stronger one, each with a second choice behind it. The page carries this one example through the opening, the figure, the code and the failure section. Names that do work: `utility`, `chat`, `openai/gpt-6-luna`.

## 1. A model is a string (opening, smallest example)

- A generator names its model with `model:`. The simplest value is a string: provider, slash, model id. `fm:11-21`, `gen:599` (`model?: ResolvableModel`), `gen:283-290` (`ResolvableModel` is `string | string[] | GeneratorModel | function`). [page]
- Small, fast model, written the way the project writes it everywhere: `model: "openai/gpt-6-luna"`. `hc/src/flows/hello-chat/flow.ts:19,39`, `examples/hello-chat/fsdev.config.ts:10-12`. Answers cold-read question 1. [page]
- A generator with a literal model string and no `models` config on `createFlowState` runs: the app does not have to configure anything beyond a key. `examples/hello-chat/fsdev.config.ts:10-12,16-22` (no `models` option; "model strings like "openai/gpt-6-luna" in the flow resolve automatically"), `sm:7`, `sm:39` ("That's the whole configuration step for the default setup"). [page]
- The string is resolved to a provider at run time: the first part (`openai`) names the provider, the rest is the model id. The id is passed to the provider as written. `res:1073-1110` (direct path), `fm:35` (the model id "reaches whoever serves the call exactly as you typed it"). [page: one clause; the spelling traps are ref]
- The provider is reached through the Vercel AI SDK. `fm:734-736` ("talks to providers through the Vercel AI SDK"), `CLAUDE.md`-independent: `res:1-10` (header: "maps model strings ... into resolved GeneratorModel instances"). [ref; the page need not name the SDK]
- A model value may also be a function of the block's input and context, or a `GeneratorModel` instance. `gen:283-290`, `gen:713-770` (`resolveModelValue`: function awaited; string, array, instance handled), `fm:229-244`. [ref]
- `selectModel(default, rules)` is a declarative form of such a function: `when` rules swap the model, `preferProvider` rules reorder an intent's candidates. `sel:1-60`, `packages/core/test/select-model.test.ts:17-170`, `fm:277-306`. [ref]
- String forms: `provider/model`, `name:model` (pins one provider or gateway, never falls back to another), `intent/<name>`. `fm:23-31`, `res:1-10`, `res:683-684`. Three-part `gateway/provider/model` strings are refused. `fm:37-46`. [ref: all of it. The page shows `provider/model` and `intent/<name>`]
- Built-in provider names: `anthropic`, `openai`, `google`. Built-in gateway names: `vercel`, `openrouter`. `mt:6-14` (`providerNames`, `gatewayTypes`), `res:116-125` (`PROVIDER_PACKAGES`, `GATEWAY_PACKAGES`). [ref]
- Evaluator blocks take a model too, narrower: one model, no intents, no arrays, no `selectModel`. `fm:9`, `fm:520`. [ref; the page may say "this page is about generators" in a clause and link]

## 2. Naming the job, not the model (section, figure)

- An **intent** is a name for a purpose, mapped to an ordered list of model strings in the app's config. A generator writes `model: "intent/utility"`; the app decides which model fills it. `sm:43`, `fm:50`, `res:80-82` (option doc: "Map of intent name -> ordered candidate model strings"). [page]
- The intent is written on the generator as the string `"intent/<name>"`, not as a separate field. `fm:50`, `fm:156-240` (every worked example), `gen:599`. [page]
- The mapping lives in the `models` option of `createFlowState`: `models.default` (one model string) and `models.intents` (name to list of strings). `fs:30-37` (`FlowStateModelsConfig`), `fs:155-156`, `fm:75-98` (example), `sm:45-70` (example). [page]
- Example shape that the page can use (adapted from `fm:79-97`, `sm:47-70`; models taken from docs): `models: { default: "openai/gpt-6-luna", intents: { utility: ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"], chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"] } }`. Model names appear in `fm:87-91`, `sm:56-65`. [page: example; re-check names against the model-name rule at draft time]
- `createFlowState` forwards `models.default` as the resolver's `defaultModel` and `models.intents` as its `intents`, unchanged. `engine/src/flowstate/createFlowState.ts:199-210` (`toModelResolverOptions`), `fm:98`. [ref]
- To swap the cheap model everywhere you edit one list in `models.intents.utility`; no block changes. Answers cold-read question 2. `sm:92-93` ("One place to change. Moving your chat traffic to a new model is an edit to this map, not a search across every block that calls an LLM."), `fm:242` ("blocks declare what they need; the resolver decides which model fills the role"). [page]
- A generator that names an intent cannot change what the intent means; the map is read when the resolver is built, once. Mutations of the options after construction do not reach already-resolved intents. `res:` option doc on `env` ("Reads at construction time only"), `mt:39-45` (intent defaults "Captured at resolver construction time"). [ref]
- Intent names are the app's to choose: they must match `/^[a-zA-Z][a-zA-Z0-9_-]*$/`. `pd:152`, `ct/create-model-resolver-intents.test.ts:66-91` (rejects a digit-leading name, a slash, a dot). [ref]
- Six names the docs recommend: `utility`, `chat`, `plan`, `synthesize`, `code`, `reason`. There are no built-in lists behind them; the app configures each. `fm:62-73` ("there are no built-in defaults"), `sm:95`. [page: `utility` and `chat` only, by name. The table is ref]
- What `utility` and `chat` are for: `utility` is the smallest reliable model, for classification, routing, extraction, summaries, titles; `chat` is user-facing assistant turns. `fm:66-73`. [page]
- The mapping is plain code in the app, kept next to the flows, not stored anywhere by the framework. See section 7 (four questions). [page]
- Where a candidate is chosen: the resolver walks the list in order and takes the first model whose provider has a key set and an installed SDK package. Everything else is skipped. `sm:82`, `res:1182-1196` (each candidate goes through `tryResolveSingleModel`; an unresolvable one is dropped), `res:779-796` (`isPackageProviderAvailable`: key present and package resolvable), `ct/create-model-resolver-intents.test.ts:107-121` ("intent resolves to first available candidate"). [page]
- So the same config works on a machine with only one provider's key: with only `ANTHROPIC_API_KEY` set the first anthropic entry wins; with only `OPENAI_API_KEY`, the first openai entry. `sm:82`. [page, as a sentence]
- A gateway key (`AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`) makes every provider available through that gateway. Direct keys win over a gateway for the same provider. `sm:23`, `fm:418`, `pd:53-58,105-115`. [page: one sentence; the rest is ref]
- Probe (run during this sheet, not a repo test): with only an `openai` provider configured, `intent/utility` whose list is `["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"]` resolves and runs `gpt-6-luna`, skipping the unconfigured first entry. Same result as `ct/create-model-resolver-intents.test.ts:107-121`. [page]
- An intent name that was never declared: the resolver warns once in dev and uses the default. `fm:100`, `res:1160-1168`, `ct/create-model-resolver-intents.test.ts:157-178` ("unknown intent warns once and falls back to defaultModel"). [page: a clause; message text ref]
- An intent with no list and no default is a setup error that names the intent and where to set a model (`models.intents.<name>`, `models.default`, `FSDEV_DEFAULT_MODEL`). `ct/create-model-resolver-intents.test.ts:139-155`, `res:1142-1147` (`resolveDefaultModel` throws `UnresolvedIntentError`). [ref]
- `models.default` is required when `models.intents` has any entry, and must be a model string, never another `intent/<name>`; both are checked at construction. `res:480-496`, `ct/create-model-resolver-intents.test.ts:31-46`, `sm:84`, `fm:100`. [page: one sentence; error text ref]
- Candidates in an intent list may not be `intent/*` strings either. `res:515-525`, `ct/create-model-resolver-intents.test.ts:48-55`. [ref]
- Environment override: `FSDEV_INTENT_<NAME>` replaces one intent's list with one model string; `FSDEV_DEFAULT_MODEL` replaces the default; read once when the resolver is built. `env:41-46`, `fm:104-150`, `ct/create-model-resolver-env-overrides.test.ts:197-240`. [ref: reference/environment. The page does not name `FSDEV_INTENT_*`; the Next link to Environment covers the `FSDEV_*` variables]
- The resolved model of a request shows on every generator item and on its `block_trace`: `actual` (the model that ran), `requested` (present when different; for an intent it is `intent/<name>`), `gateway` (when a gateway routed it). `fm:683-693`, `packages/contracts/src/types/model-identity.ts:9-17`, `ct/model-identity.test.ts:126-145`. [page: one sentence, so the reader can see which model answered; the field names and what `requested` holds are ref]

## 3. When a model fails (section, dashed arrow in figure)

- Two ways to name a fallback: an intent with a list (section 2), or an array on the generator: `model: ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5-5"]`. The models are tried in order. `fm:246-258`, `gen:741-760`, `ct/generator-model-array-routes.test.ts:33-46`. [page]
- An empty array is refused: `Generator "<name>" model array cannot be empty`. `gen:743`. [ref]
- When the first model fails the call, the request goes to the next model in the list; the caller gets the second model's answer and the first model's error is not surfaced. Answers cold-read question 3. `fb:158-203` (`executeWithFallback`: errors are collected, next entry tried, result returned), `ct/fallback-model.test.ts:204-221` (retries exhausted then next model's response), `ct/fallback-model.test.ts:316-340` (stream: first stream throws, next candidate's text arrives). [page]
- A failure that is a transient provider problem (HTTP 429, 500, 502, 503, a network error) is retried on the same model first, then the next model is tried. Default: two attempts per model, 1000 ms base delay, 10000 ms cap, exponential backoff. `fb:42-65` (`isRetryableError`), `fb:158-203`, `res:111-115` (`DEFAULT_RETRY_POLICY`), `mt:88-96` (`ModelRetryPolicy`), `ct/fallback-model.test.ts:187-221`, `fm:530-537,541-549`. [page: transient errors retry, then move on. Numbers and the policy are ref]
- Auth failures and bad requests are not retried; on a `generate` call they move to the next model at once. `fb:158-203`, `ct/fallback-model.test.ts:223-240`. [ref; see the stream caveat below]
- **Stream caveat [verify, keep off the page]:** on the streaming path (the path a text generator uses when the model streams, `gen:3287-3340`) the loop does not retry the same model; a retryable error moves to the next candidate, and a non-retryable error (auth, bad request) is thrown, not skipped. `fb:218-290`, `ct/fallback-model.test.ts:374-400` ("still surfaces an arbitrary non-retryable error instead of falling through"). `fm:532-534` says auth errors skip to the next model, which is true on `generate` and not on `stream`. The page says only "when the first model fails (rate limit, outage), the next one answers".
- **Mid-stream caveat [verify, keep off the page]:** `fm:537` says fallback only works before the first chunk. The code's comment says an error after content surfaces, but the catch only guards provider-load and prepare failures after a first chunk, so a retryable error after chunks falls to the next model. `fb:218-290`. Not covered by a test. Do not state either way.
- A provider package that fails to load is skipped to the next candidate without retries. `fb:77-79`, `fb:176-182`, `ct/fallback-model.test.ts:242-261`. [ref]
- If every model fails, the call throws one error listing each model and what it said: `All models in group "<name>" failed:` then one line per model. `fb:152-156`, `fb:199`, `ct/fallback-model.test.ts:263-281`, `fm:535`. [page: the guarantee only (it throws), linked to the reference row; the error's contents are ref]
- An intent differs from an array in one way a reader can hit: the intent skips a model whose key or package is missing before any call; an array does not. With an array `["anthropic/claude-sonnet-5-5", "openai/gpt-6-luna"]` and only an openai provider configured, the generator throws `No provider available for "anthropic". Tried: direct package (not installed), gateways (none configured for this provider)...` and never reaches the second entry. The throw happens when the generator resolves its model (every entry is resolved up front), before any model is called. Probe run during this sheet (not a repo test), `gen:748-756` (`ctx.resolveModel(modelStr)` is called for each entry and throws), `res:1182-1196` (the intent path uses `tryResolveSingleModel`). [page: two sentences: an intent's list passes over a model with no key, a generator's list needs a key for every model in it; the throw, its timing and its message are ref, linked to the Models reference]
- The array form uses a fixed retry policy (2 attempts, 1000 ms, 10000 ms); the resolver's `retryPolicy` option applies to intents. `gen:758` (policy literal), `res:1199` (`retryPolicy` passed to the intent's group). `mt:88` calls it "fallback arrays and intents" and `res:56` says "Retry policy for fallback arrays and intents". Conflict between the option's doc comment and the code. [verify, ref only if confirmed]
- If no model in the intent list has a key or installed package (none resolves), the call uses the default model instead. This is distinct from every resolved model failing when called, which throws the one error listing each (no fall-through to `default`). `res:1194-1196`, `ct/create-model-resolver-intents.test.ts:123-137` ("all candidates unavailable falls back to defaultModel"), `fm:50`. [page: one sentence. This is a fallback of its own, set by `models.default`]
- The default model is a plain string with no list of its own; if it names a provider you have no key for, whatever falls through to it fails. `sm:86`. [page: one clause]
- No fallback happens inside a `name:model` string: a string that names its route never falls back to another. `fm:33`. [ref]
- Bare `provider/model` with no direct package or key falls through to a configured gateway. `fm:428-437`, `res:1085-1110`, `ct/create-model-resolver-intents.test.ts:205-242`. [ref]
- Prompt caching, reasoning (`providerOptions`, `intentDefaults`), observability of cache hits are on by default or are per-provider knobs. `fm:551-681`. [ref: do not state on the page]

## 4. Letting the user choose (section)

- The pattern: store the user's choice in user state, expose a flow action that writes it, read it in the generator's `model` function. `fm:308-313`. [page]
- The generator's `model` value may be a function `(input, ctx) => string | string[] | instance | selection`. It is called on each run, with the block context, so it can read `ctx.user.state`. `gen:283-290`, `gen:713-725` (`resolveModelValue` awaits the function), `fm:229-244`, `fm:253-260` (`selectModel` reads `ctx.user?.state.preferredProvider`). [page]
- The user's choice is user-scope state: it lasts across that user's sessions, inside one organization. `ss:22` ("User ... Across sessions for a user, per organization"), `fm:312`. [page]
- A change takes effect on the next generation; no restart. `fm:342`. [page]
- The UI sees the choice only if the user scope's `client` block exposes it (`derived` or `expose`). `fm:350-362`, `ss:25` ("the browser sees only the fields a scope's client config exposes"). [ref; the page may say "expose it through the user scope's client config if the UI shows it" in a clause, or skip]
- A raw user-supplied string reaches the resolver: a user's value should be limited to model strings the app allows. [verify: no doc or test says this; do not state]
- The user picks a model string. To let the user pick a provider while the app keeps its own purpose names, `selectModel("intent/chat", [{ preferProvider: (_i, ctx) => ctx.user?.state.preferredProvider }])` reorders an intent's candidates by provider name before availability is checked. `sel:1-60`, `fm:277-306`, `res:1149-1181` (reorder before filtering), `ct/create-model-resolver-preference.test.ts`. [page: one sentence as the second way to let the user choose; the rules and phases are ref]
- `selectModel` evaluates `preferProvider` rules first (collected, never short-circuiting) and `when` rules second (first true wins). `sel:1-12`, `fm:262`. [ref]
- Two examples of the generator's function form in the docs: pick by input length, `if (input.message.length > 2000) return "intent/reason"`. `fm:233-244`. [ref]

## 5. What it gets you (observable results in the page's example)

Each is something the reader can see; all tie to the support desk.

- **One edit, every block.** Change `utility` in `models.intents` and `classify`, and every other block that names `intent/utility`, uses the new model. `sm:92`, `fm:242`.
- **A key is all a new machine needs.** The same config runs with whichever provider's key is set; the first model that can be served wins. `sm:82`. A gateway key makes every provider available through it (`sm:23`); [ref], the page does not state it.
- **A failed call does not fail the request.** A rate limit or an outage on the first model goes to the next in the list; one error listing every model is thrown only when all fail. `fb:150-156,199`, `ct/fallback-model.test.ts:204-221,263-281`.
- **You can see which model answered.** Each message item and the block's trace carry `model.actual`, and `model.requested` is `intent/chat` when an intent chose it. `fm:683-693`, `ct/model-identity.test.ts:126-145`.
- **The role name outlives the model name.** `intent/chat` stays the same string when the model behind it is replaced. `sm:93`. (Judgement, not an observable; phrase as "the string in your block does not change".)
- **A dev or CI environment can point everything at the cheap model** with `FSDEV_INTENT_CHAT=openai/gpt-6-luna`, set before start [ref; not in the benefits list]. `env:41-50`, `fm:156-168` (worked example), `ct/create-model-resolver-env-overrides.test.ts:197-210`.

## 6. How it fits with the others (neighbours)

- **Generators** are the blocks that need a model. Handlers, sequencers and routers name none. `fm:7`, `gen:599`. Link: `concepts/generators-and-tools`. [page]
- **Evaluators** also take a model, a narrower one: no intents, no fallback. `fm:9`, `fm:520`. [page: a clause]
- **Coding harnesses** (Codex, Cursor, Claude Code) take a `model` option of their own, an id for their SDK, not a framework model string. `packages/codex/src/agent.ts:143`, `packages/cursor/src/agent.ts:205`, `packages/claude-code/src/sdk/types.ts:408`. [page: one clause]
- **Capabilities** may contribute a model to a generator (`PresetDef.model`); the block's own `model` wins. `gen:593-598` (doc: "Optional when a capability in `uses` contributes a model ... a block-level setting always wins"), `packages/core/src/capability/types.ts:143`. [ref; the page may name it in one clause under Capabilities]
- A generator with no model on the block and none from a capability fails at construction: "Missing on both is a runtime error at construction". `gen:593-598`. [ref]
- **Workforce** and other kits take a `model` of their own in their config (`workforce({ model })`). `fs:130-136` (doc example `kits: [harnesses({}), workforce({ model })]`). [verify: do not state; the doc line is only an example of a kit call]
- **Persistence**: nothing on this page stores a model by itself. The only stored part is a user's choice, in user state; see `concepts/persistence`. [page: link]
- **Testing**: a test passes a mock model resolver to `createFlowState({ modelResolver })`. `fs:158-162` (`modelResolver`, "Escape hatch: a pre-built model resolver ... for test mocks (`createMockModelResolver`) or fully custom resolvers"). `createFlowState` builds the resolver from `models` unless `modelResolver` is passed. [ref: `reference/models`, which already holds custom resolvers; the page does not state it]
- Custom resolver: pass `modelResolver` to `createFlowState`, or build one with `createModelResolver(options)` from `@flow-state-dev/core/models` (explicit `providers`, `gateways`, `retryPolicy`, `providerPreference`, `keys`, `intentDefaults`, `env`). `res:50-115` (options), `fs:30-37,158-162`, `sm:117-133`. [ref]
- Provider keys. Answers cold-read question 4. Each provider reads one environment variable: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`; gateways read `AI_GATEWAY_API_KEY` (Vercel) and `OPENROUTER_API_KEY`. The SDK package for that provider must be installed too (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/gateway`, `@openrouter/ai-sdk-provider`). Set them in the shell, a `.env` file, or the host's secret store; `.env.local` works under Next.js; the CLI loads `.env.local` before it imports `fsdev.config.ts`. `pd:8-18`, `sm:15-39`, `env:11-25`. `createFlowState({ models: { keys } })` overrides the environment. `env:25`, `fs:30-37` (`keys`), `pd:53-58` (`config.keys?.[provider] ?? env[envVar]`). [page: one sentence, "keys are environment variables, listed in reference/environment"; the table is ref]
- Keys never appear in a model string, in a block or in flow state. [verify: no source states it; do not state]
- Verify a key: `pnpm fsdev run hello-chat chat -i '{"message": "Say hi."}'` streams text; a provider error means the variable is not exported in that shell. `sm:137-143`. [ref / Start page]

## 7. The four questions for each stored part

Models are mostly configuration, not data. Three things could be called stored; two are not.

| Part | Who owns it | Who can see it | Where it is stored | How many exist |
| --- | --- | --- | --- | --- |
| **The mapping** (`models.default`, `models.intents`) | The app. It is an option of `createFlowState`, in the app's code. | Anyone who can read the app's code or config. Not a block's state, not the browser. The resolved model of a run shows on its items (`model.actual`, `model.requested`), which is the only way a run reveals it. | In the app's source; not in any store. The resolver builds from it once; an environment variable (`FSDEV_INTENT_*`) can replace a list at that moment. `res:` option docs, `env:41-46`. | One mapping per `createFlowState` call; one list per intent name. |
| **The resolver's resolved models** | The running process. | Nobody; internal. | In memory only (an intent's fallback group is cached by intent name and provider preference). `res:766-768,1203`, `mt:39-45`. | One per intent name and preference. Lost on restart; rebuilt on first use. [ref: not stated on the page] |
| **A user's chosen model** (the "letting the user choose" pattern) | The user: it is a field of user state, written by an action the app defines. `fm:308-340`. | Blocks that declare the user state; the browser only if the user scope's `client` config exposes it. `fm:350-362`, `ss:25`. | In the user record of the configured store (memory, filesystem, SQLite, Postgres), so it lasts as long as that store does. `ss:22`, `apps/docs/docs/persistence/overview.md:7,32,45`. | One per user per organization by default; one per flow copy with `isolateUserState`. `ss:25` (figure description). |

- No model call result is stored by this concept; items and traces are in `concepts/streaming` and `concepts/persistence`. [page: link only]
- Keys are not stored by the framework; they are read from the environment or from `models.keys`. `pd:53-58`, `env:25`. [ref]

## 8. Figure facts: *From a block to a provider*

Parts, named from the page's example (labels must be real names):

- Generator `classify`, `model: "intent/utility"`. `fm:48-60`.
- The app's mapping: `utility: ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"]` in `createFlowState({ models })`. `fm:75-97`, `sm:47-70`.
- A model string such as `openai/gpt-6-luna`, which resolves to a provider (`openai`, key `OPENAI_API_KEY`). `res:1073-1110`, `pd:8-12`.
- `RESOLVES TO` arrow: block -> purpose -> mapped string -> provider.
- `ONLY IF THE FIRST FAILS` dashed arrow: the second string in the list, one beside the first. `fb:158-203`.
- Highlighter on the mapping: `res:1182-1196`, `sm:92`.
- Marks the lifetime vocabulary does not apply to: nothing here persists. The figure uses no hatching or dashed outline for lifetime. The dashed arrow is the only dashed mark and it means "only if the first fails". `docs/contributing/user-docs.md` Figures section for the marks.

## 9. Edges for the cold-read question list (answers from this sheet)

1. A small, fast model: `model: "openai/gpt-6-luna"` (section 1), or `model: "intent/utility"` with `utility` mapped to it (section 2).
2. Swap the cheap model everywhere: edit `models.intents.utility` once in `createFlowState` (section 2). For a dev or CI environment only, `FSDEV_INTENT_UTILITY` replaces the list without touching code (`env:41`).
3. First model down: transient errors (429, 5xx, network) retry on the same model, twice by default, then the next in the list answers; all failed throws one error listing each (section 3). The caller never sees the first error unless every model failed.
4. Provider keys: environment variables, one per provider or gateway, plus the provider's SDK package; the full list is `reference/environment` (section 6). `models.keys` overrides.
5. Edge, a model with no key: intent skips it, array throws (section 3).
6. Edge, an intent no one configured: warns and uses `models.default`; with no default, setup error (section 2).
7. Edge, a second user: each user's chosen model is their own user state, not shared (section 7).

## 10. Left off the page

- **[cut]** `## AI SDK 7` (`fm:734-742`), the migration section for `gateway/provider/model` strings (`fm:37-46`), the "intentional, not a hidden quirk" note (`fm:435`), the Forward note on reasoning levels (`fm:679-681`), the doc's cost arithmetic for prompt caching (`fm:604-606`), the `docs/PROMPT_CACHING.md` pointer (`fm:608`).
- **[ref]** String lanes and pinned routes, evaluation models, gateways, provider detection table, direct-then-gateway fall-through, retry and fallback numbers, prompt caching, `providerOptions` and thinking, `intentDefaults`, `FSDEV_*` variables, `selectModel` rules, `ModelIdentity` shape, `onCompleted` meta, custom resolver and its `resolveEvaluationModel`, `createModelResolver` options. Sources: `fm:23-46,246-742`, `advanced/custom-model-resolver`.
- **Contradictions found, resolved to the code:** (a) `fm:532-534` says auth errors skip to the next model; true for `generate`, not for `stream` (`fb:218-290`). (b) `fm:537` and the comment at `fb:215-222` disagree with the catch at `fb:252-290` on mid-stream failures. (c) `res:56` says `retryPolicy` covers arrays; the array path uses a fixed policy (`gen:758`). None of the three is stated on the page.
- The sitemap's "an intent name on the generator" is the string `"intent/<name>"` in `model`; no `intent:` field exists on the generator config (`gen:599`; the generator config has no such key).
