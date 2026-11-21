---
title: Models
type: reference
description: "The model string forms, intents, where a model is set, fallback and retry, provider keys and gateways, per-environment overrides, prompt caching, provider options, custom resolvers, and what is recorded about the model that answered."
---

# Models

A generator is the block that calls a model, and it names the model with a string such as `openai/gpt-6-luna`. The model resolver turns that string into a callable model, finds a provider key for it, tries a second model when the first fails, and records which model answered. An app has one, and every generator and evaluator goes through it.

A string can also name a purpose instead of a model: `intent/chat`. The app lists, in one place, which models do that job in order of preference. Moving a job to another model is then an edit to that list, not a search through blocks. [Models](../concepts/models.md) builds the idea; this page is the lookup.

The examples use the `support` flow. `reply` writes the answer to a ticket and asks for the `chat` job.

```ts title="src/flows/support/blocks/reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";

export const reply = generator({
  name: "reply",
  model: "intent/chat",
  prompt: "Write a reply to the ticket.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

`flow.ts` registers `reply` as the flow's action:

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { reply } from "./blocks/reply";

export default defineFlow({
  kind: "support",
  actions: {
    reply: { block: reply, userMessage: (input) => input.message },
  },
})();
```

The app says which models do the `chat` job in `fsdev.config.ts`:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import supportFlow from "./src/flows/support/flow";

export default createFlowState({
  flows: [supportFlow],
  models: {
    default: "openai/gpt-6-luna",
    intents: {
      utility: ["anthropic/claude-haiku-5-5", "openai/gpt-6-luna"],
      chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"],
    },
  },
});
```

`createModelResolver`, `createAiSdkModelResolver`, `wrapAiSdkModel`, `createFallbackModel`, `isRetryableError`, `detectAvailableProviders`, `parseModelString`, `applyCaching` and `DEFAULT_CACHING_CONFIG` come from `@flow-state-dev/core/models`. `createModelResolver` and `selectModel` also come from `@flow-state-dev/core`.

`models` on `createFlowState` forwards these options to the resolver it builds:

| `models` option | Resolver option | Meaning |
| --- | --- | --- |
| `default` | `defaultModel` | One model string. Required once `intents` has an entry. |
| `intents` | `intents` | Intent name to an ordered list of model strings. |
| `gateways` | `gateways` | Named gateways. See [Providers, keys and gateways](#providers-keys-and-gateways). |
| `retryPolicy` | `retryPolicy` | Attempts and delays for an intent's list. See [Fallback and retry](#fallback-and-retry). |
| `providers` | `providers` | Providers you register by name. |
| `providerPreference` | `providerPreference` | Providers to try first for every intent. |
| `keys` | `keys` | API keys for `openai`, `anthropic` and `google`. |

`intentDefaults` and `env` are not forwarded. To use either, build the resolver with `createModelResolver` and pass it as `createFlowState({ modelResolver })`, which replaces `models` entirely. See [Custom resolvers](#custom-resolvers).

## Model strings

A string is trimmed first. An empty string throws `Model string cannot be empty.` The position of the first `:` and `/` decides the form.

| Form | Written as | Routes to |
| --- | --- | --- |
| `provider/model` | `anthropic/claude-sonnet-5-5` | The provider directly, else a configured gateway |
| `name:model` | `vercel:openai/gpt-6.1-sol`, `openai:gpt-6.1-sol`, `triage:native` | The route registered under `name`, and nothing else |
| `intent/<name>` | `intent/chat` | The intent's list, then `defaultModel` |

- **`provider/model`** has exactly two slash-separated parts, with any colon after the slash: `openai/gpt-oss:free` is provider `openai`, id `gpt-oss:free`.
- **`name:model`** has its first colon before its first slash, or no slash. Everything after the first colon reaches the route untouched, so `openrouter:openai/gpt-oss-20b:free` asks `openrouter` for `openai/gpt-oss-20b:free`. A missing name or id throws.
- **`intent/<name>`** takes a name matching `^[a-zA-Z][a-zA-Z0-9_-]*$`. `intent/a/b` throws `intent/* model strings must be 2 parts (intent/name).`
- Any other shape, such as vercel/anthropic/claude-sonnet-5.5 or a one-part string with no colon, throws `Invalid model format: "<s>". Expected "provider/model" ... or a named route "name:model" ...`.

The id reaches the provider or gateway exactly as written, so spell it the way that service does. Anthropic writes `claude-sonnet-5-5`; the Vercel gateway writes `claude-sonnet-5.5`.

**When a bad string fails.** In `defaultModel`, an intent's list, `FSDEV_INTENT_*` or `FSDEV_DEFAULT_MODEL`, it throws when the resolver is built. On a generator it throws the first time that string is resolved, which can be inside a request. An evaluator parses its string when the block is built, so a malformed string or an intent string throws then. An unknown route, a missing key or a missing package throws at the evaluator's first resolution.

**Route names.** The name in `name:model` is a gateway when it is a key of `gateways` or the built-in `vercel` or `openrouter`. Otherwise it is a provider when it is a key of `providers` or the built-in `openai`, `anthropic` or `google`. Any other name throws `Unknown route "<name>" in "<s>"`, with the registered names listed. `createModelResolver` throws when one name is a key of both `providers` and `gateways`, or when a `providers` key is `vercel` or `openrouter`.

These resolver methods read a string without calling a model:

| Method | Returns |
| --- | --- |
| `resolveId(modelString, { preferProvider? })` | The concrete string. A non-intent string comes back as given, after an unknown route throws. An intent gives its first candidate that resolves, else `defaultModel`, else the input. |
| `providerOf(modelString)` | The provider the call reaches: `anthropic` for `vercel:anthropic/...`, the route name for a provider route, `unknown` for an intent or a string that would throw. |

## Intents

An intent is a name for a job and an ordered list of model strings: `intents: { chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"] }`. `reply` above uses it as `model: "intent/chat"`.

Rules checked when the resolver is built:

| Rule | Error |
| --- | --- |
| `defaultModel` is required when `intents` has an entry. An empty `intents: {}` needs none. | `createModelResolver: defaultModel is required when intents are configured` |
| `defaultModel` is `provider/model` or `name:model`, never `intent/*`. | `createModelResolver: defaultModel must not be an intent/* string (got "<s>").` |
| A candidate is never `intent/*`. | `createModelResolver: intent "<name>" candidate "<c>" must not be an intent/* string.` |
| An intent name matches the name pattern above. | `createModelResolver: invalid intent name "<name>". Must match ...` |

**What answers.** A candidate is usable when its string resolves: a provider you registered, or the provider's package installed and its key set, or a gateway that can serve it. A candidate that does not resolve is dropped from the list without an error, and the rest keep their order.

| Situation | Result |
| --- | --- |
| Some candidates resolve | Those, in order, as a fallback group. |
| The intent is not in `intents`, or its list is empty | A development warning, once per process per intent: `[flow-state-dev] Unknown or empty intent "<name>"; falling back to defaultModel.` Then `defaultModel`. |
| No candidate resolves | `defaultModel`. |
| No candidate resolves and there is no `defaultModel` | Throws `UnresolvedIntentError`: `name "UnresolvedIntentError"`, `code "unresolved_intent"`, `retryable: false`, `details: { intent }`. |
| Candidates resolve, then every one fails on the call | Throws `All models in group "intent/<name>" failed:`. `defaultModel` is not tried. |

When `defaultModel` answers, it answers as one plain model: no retry and no fallback around it.

The framework has no model list for any intent. An intent the app does not configure uses `defaultModel`. Changing `intents` or the environment after the resolver is built has no effect.

### Intent names the framework asks for

When no model is given, built-in blocks ask for these names:

| Name | Asked for by |
| --- | --- |
| `intent/utility` | `contextReducer`, `memoryExtractor`, `summarizer`, `analyzer`, `intentClassifier`, `intentRouter`, `consultSessionHistoryTool`, the skills classifier and activator, and a generator's schema-repair pass. See [Utility blocks](./utility-blocks.md). |
| `intent/chat` | A worker's `model` setting when neither its `WORKER.md` nor the flow's `model` option sets one. See [WORKER.md](./worker-md.md). |

Patterns default differently. Several internal generators ask for `intent/synthesize` or `intent/chat`. Others default to the literal `openai/gpt-6-luna`, so a pattern can need an OpenAI key or a gateway even when the app configures no intents. A pattern's `model` option replaces its default. [Patterns](./patterns.md) lists each.

Any name matching the pattern is valid. Nothing asks for `plan`, `code` or `reason` by default.

The Teammates starter passes `models: { default, intents: { utility: ["openai/gpt-6-luna"] } }`. Its `TEAMMATES_MODEL` variable sets `default` and never `utility`, so with only an Anthropic key its utility calls need an OpenAI key or a gateway key.

## Where a model is set

| Where | Accepts | Notes |
| --- | --- | --- |
| Generator `model` | A string, a `string[]`, a `GeneratorModel` instance, or `(input, ctx) =>` any of those, or a `selectModel` result | Required unless a capability supplies one. |
| Evaluator `model` | A model string or an evaluation model | One model. Required. |
| Capability preset | `model`, `providerOptions`, `caching` | Generators only. |

**Generator.** A string goes through the app's resolver, so an intent, a plain string and a named route all work. An array becomes a fallback group in array order, retried with a fixed `{ maxAttemptsPerModel: 2, baseDelayMs: 1000, maxDelayMs: 10000 }`. The resolver's `retryPolicy` does not apply to an array. An instance is used as it is, with no resolver and no fallback. An empty array throws `Generator "<name>" model array cannot be empty`. A generator with no model of its own and none from a capability throws when built: ``Generator "<name>" requires a model. Set one on the block or via a capability that contributes `model`.``

**An array does not skip unusable models.** Each string is resolved up front, in order. One string whose provider has no key, no package and no gateway throws before any model is called, even if an earlier entry would have answered. An intent's list skips such a string.

**`selectModel(default, rules)`** picks per call. `default` is a string or array, and `rules` is one rule or an array of them:

| Rule | Shape | Effect |
| --- | --- | --- |
| Prefer a provider | `{ preferProvider: (input, ctx) => string \| string[] \| null \| undefined }` | The first rule that returns a non-empty value sets the preference. |
| Switch model | `{ when: (input, ctx) => boolean, use: string \| string[] }` | The first rule whose `when` is true sets the model. |

Both callbacks may be async. The two kinds do not short-circuit each other. A preference reorders only an intent's candidate list: the candidates are regrouped by provider, preferred providers first in the order given, the rest in their original order, before candidates are resolved. A preferred provider with no key or package is skipped like any unusable candidate. In an array, the call's preference is passed to each entry, so an entry that is an `intent/<name>` string is reordered and a plain `provider/model` or `name:model` entry is not. On a plain string the preference has no effect. A call's preference replaces the resolver's `providerPreference` for that call.

```ts title="src/flows/support/blocks/reply.ts"
import { generator, selectModel } from "@flow-state-dev/core";
import { z } from "zod";

export const reply = generator({
  name: "reply",
  model: selectModel("intent/chat", [
    { preferProvider: (_input, ctx) => ctx.user?.state.preferredProvider },
  ]),
  userStateSchema: z.object({ preferredProvider: z.string().optional() }),
  prompt: "Write a reply to the ticket.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
});
```

**Evaluator.** Checked when the block is built, each failing as `Evaluator "<name>": <message>`:

| Given | Message |
| --- | --- |
| An intent string | `"intent/x" is an intent. An evaluator takes one model, not an intent, a fallback list or selectModel.` |
| An array or a function | `an evaluator takes one model, not an intent, a fallback list or selectModel.` |
| A model that can generate but not evaluate | `the model can generate but not evaluate.`, then a line asking for an evaluation model or a model string |
| Anything else that is not a string or an evaluation model | `model must be a model string or an evaluation model ...` |

A string that does not parse throws the parser's `Invalid model format` at build.

**Capabilities.** A capability that declares `model`, `providerOptions` or `caching` throws when a block that is not a generator uses it: `Capability "<name>" <source> declares model, but the consuming block is a <kind>. model is only valid on generator blocks.` Among several capabilities the last wins, and the block's own setting wins over any of them.

## Fallback and retry

A **group** is an intent with at least one resolved candidate, or a generator's model array. A single string or an instance is not a group and gets no framework retry or fallback.

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxAttemptsPerModel` | `2` | Attempts on one model before the next is tried. |
| `baseDelayMs` | `1000` | Wait after the first failed attempt. |
| `maxDelayMs` | `10000` | Cap on any wait. |

Set them as `retryPolicy` on `models` or on `createModelResolver`. They apply to intent groups only. The wait after attempt `n` is `min(maxDelayMs, baseDelayMs * 2^(n-1))`. With the defaults the only wait is 1,000 ms; with three attempts the waits are 1,000 ms and 2,000 ms.

**Order.** Candidates are tried in list order: for an intent, after the preference reorder and with unusable ones dropped; for an array, as written.

**Generate.** Each model gets up to `maxAttemptsPerModel` attempts. After a retryable failure that is not the last attempt, the group waits and tries the same model again. A non-retryable error, or a provider-load error (a provider or gateway package that is installed but failed to load), ends that model's attempts at once and moves on.

**Stream.** Each model is tried once, with no retry and no wait.

| A model fails with | Result |
| --- | --- |
| A retryable error, before or after it yielded chunks | The next model is tried. Chunks already sent stay sent, so a caller that renders chunks as they arrive sees the next model's text after the first's. |
| A non-retryable error, before or after chunks | Thrown to the caller at once. |
| A provider-load error or a message-prepare failure before the first chunk | The next model is tried. |

**What is retryable.** Checked in this order, first match wins:

| # | Test | Retryable |
| --- | --- | --- |
| 1 | The error has a boolean `isRetryable` | That value |
| 2 | It is a `LoadAPIKeyError` | No |
| 3 | It has a `statusCode` | Only 429, 500, 502 or 503 |
| 4 | Its message contains `fetch failed`, `ECONNREFUSED` or `ETIMEDOUT` | Yes |

Anything else, and any value that is not an `Error`, is not retryable. `isRetryableError` is exported.

**When every model fails**, the call throws one `Error`. Its message is `All models in group "<group>" failed:` and then one line per failed attempt, `  <modelId>: <message>`. A model attempted twice appears twice. A streamed call says `All streaming models in group ...`. If every candidate failed only because its messages could not be prepared for its provider, such as an attached file the provider cannot take, the first such error is thrown instead. `createFallbackModel` called with an empty list throws `Model group "<name>" has no available models. Configure API keys ...`. An intent never reaches that: with no candidate left it falls to `defaultModel`, or throws `UnresolvedIntentError` when there is none.

The generator's own `retry` policy and tool retry are on [Errors](./errors.md).

## Providers, keys and gateways

| Provider | Key variable | Package |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | `@ai-sdk/anthropic` |
| `openai` | `OPENAI_API_KEY` | `@ai-sdk/openai` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `@ai-sdk/google` |
| Vercel gateway, route `vercel` | `AI_GATEWAY_API_KEY` | `@ai-sdk/gateway` |
| OpenRouter gateway, route `openrouter` | `OPENROUTER_API_KEY` | `@openrouter/ai-sdk-provider` |

The packages are not dependencies of `@flow-state-dev/core`. Install the ones you use. The `keys` option (`{ openai: "...", anthropic: "..." }`) is read before the environment variable, for the three built-in providers.

**Which providers are available.** In this order: direct keys, then gateways in `gateways` in key order, then gateways whose variable is set. A provider keeps the first source that made it available, so a direct key beats a gateway, and a configured gateway beats one found in the environment. Any gateway makes `anthropic`, `openai` and `google` available through it.

**`provider/model` resolves** by the first match of:

1. An entry for the provider in `providers`. If its factory throws, resolution moves to step 3.
2. The provider's package, when its key is set and the package is installed. It loads the first time the model is called.
3. A gateway that can serve it: a configured one, else the one the environment holds a key for. `AI_GATEWAY_API_KEY` is checked before `OPENROUTER_API_KEY`. The gateway gets `provider/model` as written.
4. Otherwise it throws `No provider available for "<provider>". Tried: direct package (not installed), gateways (none configured for this provider). Install the provider package, set its API key, or configure a gateway (e.g. AI_GATEWAY_API_KEY).` The package part reads `(not installed)` when no key is set for the provider, and `(failed to load)` when the key is set but the package cannot be found. When step 1's factory threw and no gateway can serve the provider, the factory's own error is thrown instead, unless the direct package also failed to load.

The error is thrown when the string is resolved, not at app start. With a gateway key set, the same string runs through the gateway, so `openai/gpt-6-luna` works on a host that bundles no `@ai-sdk/openai`.

**`name:model` never falls through.**

| Route | Behavior | Failure |
| --- | --- | --- |
| A gateway: `vercel`, `openrouter` or a `gateways` key | Uses that gateway. Needs its `apiKey` or its type's variable; an instance needs none. | `No API key found for gateway "<name>". Set <ENV_VAR> environment variable.` |
| A provider: `openai`, `anthropic`, `google` or a `providers` key | Uses that provider only. | `"<s>" names the <name> provider, but <reason>. A "name:model" string does not fall back to a gateway; write "<name>/<modelId>" to allow one.` The reason is `no API key is set (<ENV_VAR>)`, `its package "<pkg>" is not installed`, or `it is not usable as a language-model provider`. |

**Registering your own.**

| Option | Shape | Notes |
| --- | --- | --- |
| `providers` | `Record<string, provider>` | The key is the name used in `name/model` and `name:model`. A value is `(modelId) => languageModel` or an object with `languageModel(modelId)`. A registered provider wins over the installed package and the environment key for that name. Other providers load as usual. |
| `gateways` | `Record<string, { type: "vercel" \| "openrouter", apiKey? } \| instance>` | The key is the route name for `name:model`. Two entries of one `type` with different keys are two accounts. Pass an instance, such as `createGateway({ apiKey })`, where a bundler cannot find the gateway package. |

## Per-environment overrides

These variables replace the app's choice at run time. They are read once, when the resolver is built.

| Variable | Replaces |
| --- | --- |
| `FSDEV_INTENT_<NAME>` | The list of the declared intent `<name>`. It becomes a one-element list. |
| `FSDEV_DEFAULT_MODEL` | `defaultModel`. |

`<NAME>` is the intent name in capitals with `-` turned into `_`: `chat` gives `FSDEV_INTENT_CHAT`, `my-custom` gives `FSDEV_INTENT_MY_CUSTOM`. Names match case-sensitively. To point `chat` at a cheaper model in CI:

```bash title=".env.local"
FSDEV_INTENT_CHAT="openai/gpt-6-luna"
```

| Rule | Behavior |
| --- | --- |
| Value | One `provider/model` or `name:model` string. `intent/*`, an empty value, a bad format, an unknown route and a comma-separated list each throw when the resolver is built, naming the variable: `createModelResolver: FSDEV_INTENT_CHAT: Invalid model format: "garbage". ...` |
| Undeclared intent | A development warning once, then the variable is ignored: `[flow-state-dev] FSDEV_INTENT_NOSUCH does not match any declared intent (declared: chat, utility); ignoring the override.` |
| `FSDEV_DEFAULT_MODEL` | Applies with or without declared intents. A malformed one throws even with none. |
| Name collision | Two declared intents that map to one variable, such as `my-custom` and `my_custom`, throw when the resolver is built, set or not. |
| Reach | A literal string on a block, such as `model: "openai/gpt-6.1-sol"`, is not changed. Only intents and the default are. |
| Read once | Setting a variable after the resolver exists has no effect. |

An `intent/<name>` string resolves from `FSDEV_INTENT_<NAME>` first, then the intent's list in code, then `FSDEV_DEFAULT_MODEL`, then `defaultModel` in code. A literal model string on a block skips all of these.

Each applied override logs once per process in development: `[flow-state-dev] Intent "<name>" overridden by FSDEV_INTENT_<NAME>; resolves to "<model>".` The same is logged for the default. `NODE_ENV=production` or `FSD_QUIET_WARNINGS=1` silences the log, and the override applies either way.

`createModelResolver({ env })` replaces `process.env` as the source of these two variables only. Provider and gateway keys come from `keys` or the real environment. `createFlowState({ models })` has no `env`.

**Per command.** `fsdev run` and `fsdev chat` take `--model <id>` (`-m`). It forces every generator in the command's process onto that id, replacing what the generator asked for, an intent included. The id goes through the app's resolver, so its gateways and providers apply. It does not change evaluator model strings. `fsdev dev` with an `fsdev.config.*` exits 2 with `--model can't be combined with fsdev.config.*; the config builds the router with its own resolver. Set the model in the config, or pass --no-config.` When a run is handed to a queue the flag is dropped: the host logs a warning and the queued run uses the worker's own model configuration. [CLI](./cli.md) has the flag.

## Prompt caching

Every generator caches by default. `caching` takes `{ enabled?, breakpoints?, ttl? }` or `(input, ctx) => CachingConfig | undefined`, and a partial config fills the rest from the defaults.

| Field | Values | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `true` |
| `breakpoints` | `"auto"` or `"manual"` | `"auto"` |
| `ttl` | `"5m"` or `"1h"` | `"5m"` |

| Setting | Effect |
| --- | --- |
| `enabled: false` | No markers on any provider. |
| `breakpoints: "manual"` | Nothing is added. Your own `providerOptions` pass through. |
| `auto` on `anthropic` or `openrouter` | `providerOptions.anthropic.cacheControl = { type: "ephemeral", ttl }` on the last system message, only when the system messages plus the JSON of the tool definitions total at least 4,096 characters, about 1,024 tokens. Below that nothing is added. |
| `auto` through a Vercel `gateway` instance | `providerOptions.gateway.caching = "auto"` on the request, and the gateway places the breakpoints. No size check. |
| `auto` on OpenAI, Google and the rest | Nothing is added. Those providers cache on their own. |

Caching never overwrites a `cacheControl` already on that message or a `gateway.caching` already set. `ttl` applies to the Anthropic marker only. A capability preset can set `caching`.

When the provider reports them, a generator's usage carries `cacheCreationInputTokens` (written to the cache) and `cacheReadInputTokens` (read from it). On the trace row they are `modelUsage.cacheCreationTokens` and `cacheReadTokens`.

## Reasoning and provider options

`providerOptions` on a generator is `Record<string, unknown>` or `(input, ctx) => Record<string, unknown> | undefined`. It reaches the AI SDK request untouched, keyed by provider name. The framework does not validate or translate it, so the names are the provider's and the AI SDK's own: Anthropic `thinking`, OpenAI `reasoningEffort`, Google `thinkingConfig`.

Flow State has no reasoning level of its own. To set one, put `providerOptions` on the generator, or on the intent with `intentDefaults` so every generator that uses the intent gets it.

Reasoning the model streams arrives as `reasoning` items with no setting. Each carries the model identity below.

## Custom resolvers

An app can supply its own resolver as `createFlowState({ modelResolver })` or `createFlowApiRouter({ modelResolver })`. It is a callable `(modelId, blockName?, options?: { preferProvider? }) => GeneratorModel` with these members:

| Member | Required | Meaning |
| --- | --- | --- |
| `resolveId(modelId, options?) => string` | Yes | The concrete model string for an id. |
| `resolveEvaluationModel?(modelId, blockName?)` | No | Returns an `EvaluationModel`, sync or async. Without it, an evaluator given a model string refuses to run. |
| `providerOf?(modelId) => string` | No | Labels the entries of a model array. |

| Helper | Does |
| --- | --- |
| `createModelResolver(options)` | The full resolver: intents, fallback, gateways, overrides. |
| `createAiSdkModelResolver(fn)` | Wraps a function `(modelId) => language model`, or a provider object such as the `openai` export. `resolveId` returns the id unchanged. No intents, no fallback. |
| `wrapAiSdkModel(model, modelId?, { requested?, gateway? })` | Wraps one language model instance as a `GeneratorModel`. |
| `createMockModelResolver(options)` | From `@flow-state-dev/testing`. Scripted generators and evaluators for tests. See the [testing reference](./api/testing.md). |

`createModelResolver` options are `keys`, `gateways`, `retryPolicy`, `providers`, `providerPreference`, `defaultModel`, `intents`, `intentDefaults` and `env`.

**`intentDefaults`** gives every generator that uses an intent the same `providerOptions`:

```ts title="fsdev.config.ts"
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowState } from "@flow-state-dev/engine";
import supportFlow from "./src/flows/support/flow";

const modelResolver = createModelResolver({
  defaultModel: "openai/gpt-6-luna",
  intents: { chat: ["anthropic/claude-sonnet-5-5", "openai/gpt-6.1-sol"] },
  intentDefaults: {
    chat: {
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 4000 } },
      },
    },
  },
});

export default createFlowState({ flows: [supportFlow], modelResolver });
```

| Rule | Behavior |
| --- | --- |
| Keys | Every key must be a key of `intents`, or construction throws `createModelResolver: intentDefaults key "<k>" is not a defined intent. Defined intents: <list or (none)>.` |
| Which provider | Only the sub-object for the provider that won applies. The others are dropped without an error. |
| Merge | Deep. The call's own `providerOptions` win a collision, and keys that do not collide from both survive. |
| Fall-through | Not applied when the intent fell through to `defaultModel`. |
| Precedence | The generator's `providerOptions` win over the intent default. The prompt-cache marker is added last, only where no `cacheControl` is set. |
| When | Captured when the resolver is built. |

An override from `FSDEV_INTENT_<NAME>` replaces the list only. The intent keeps its `intentDefaults`.

## What is recorded about the model that answered

`ModelIdentity` fields:

| Field | Meaning |
| --- | --- |
| `actual` | Always set. The model id the provider reports, such as `gpt-6.1-sol-2026-04-12`, else the winning candidate string. |
| `requested` | What the caller asked for. Set only when it differs from `actual`. |
| `gateway` | The gateway type that routed the call, `vercel` or `openrouter`, when one did. |

What `requested` holds:

| The call | `requested` |
| --- | --- |
| Through an intent | `intent/<name>`, also when a later candidate won. |
| A plain string | That string, present when the provider reports an id that differs from it. For `openai/c1` reporting `c1`: `{ "actual": "c1", "requested": "openai/c1" }`. |
| A gateway route | The string, with `gateway` set. |
| An intent that fell through to `defaultModel` | The default model's own string, not the intent name. |
| A model array | Each entry carries its own string. |

**Where it appears.**

| Place | Detail |
| --- | --- |
| Generator items | The `message`, `reasoning`, `source` and `tool_output` items a generator emits, and its transient `tool_call_progress` items. A message a handler emits with `ctx.emit.message` carries none. See [Items](./items.md). |
| `onCompleted` | A generator's `onCompleted(output, ctx, meta)` receives `meta.model`, a `ModelIdentity`, on success. |
| `block_trace` row | For a generator and an evaluator, a top-level `model`, filled even when the generator emits no items and absent when it failed before any model call returned. Beside it, `generator.model`, the string the block asked for, which is the first entry for an array, and `modelUsage` with `model`, `promptTokens`, `completionTokens`, `totalTokens` and the cache counters above. An evaluator also has `evaluator { model, questions }`. |

The identity is on the items and the trace row only. The trace row reaches a client only on a stream opened with `?include=trace`; it is for the DevTool. The resolver keeps no record of past calls.

An evaluator's identity is `actual` from the response's model id, `requested` the block's string when different, and `gateway` when the evaluation model came through a gateway route (`vercel`, `openrouter` or a `gateways` key). An instance you built, or one a custom resolver returned, has no gateway.

## Evaluation models

An evaluator needs a model that can evaluate, which is separate from generating. A provider or gateway exposes it as `provider.evaluationModel(id)`.

**A string** resolves through the app's resolver, at first execution, with its `resolveEvaluationModel`. An evaluation model instance never consults the resolver.

| Case | Error |
| --- | --- |
| The resolver has no `resolveEvaluationModel` | `Evaluator "<name>": cannot resolve model string "<s>": the app's model resolver has no resolveEvaluationModel hook. Add resolveEvaluationModel to the resolver, or pass an evaluation model instance.` |
| The hook returns a model that cannot evaluate | `Evaluator "<name>": the model resolver returned a model for "<s>" that cannot evaluate.` |

`createModelResolver`'s own `resolveEvaluationModel`:

| String | Resolves through |
| --- | --- |
| `intent/*` | Refused: `"<s>" is an intent. An evaluator takes one model string, not an intent.` |
| `name:model` | That gateway's, or that provider's, `evaluationModel(id)`. |
| `provider/model` | The registered or installed provider, else a gateway. Same order as a generator string. |
| `typesafe-ai/...` | Always a gateway, even with the provider registered or installed. With no gateway it throws `No provider available for "typesafe-ai". ...` |

To reach the `typesafe-ai` library directly, register it under `providers` and write a colon string, or pass an instance. A source with no `evaluationModel` is refused before any request: `Gateway "<name>" does not support evaluation models, so "<s>" cannot be used by an evaluator.` For an installed package the message says to upgrade it to a release with evaluation support. The AI SDK's global default provider is never consulted.

An evaluation call makes one provider request with retries off, no fallback and no intents.

**Confidence.** An answer has `confidence` only when the model reported one, read from `providerMetadata.typesafe.confidence[questionId]` and copied when a finite number. It is never defaulted. Of the models above, only `typesafe-ai` ones report it. `cascadingRouter` opens an edge only when the answer is a choice with a branch and a finite confidence in [0, 1] that reaches the edge's `minConfidence`. A missing confidence sends every edge to `ambiguous`, reason `no-confidence`. [Blocks](./blocks.md) has the evaluator; [Route with an evaluator](../build/route-with-an-evaluator.md) builds one.

## Lookups

**In what order are fallbacks tried?**

1. Within an intent, in list order, after the preference reorder, with unusable candidates dropped. `defaultModel` is not in the list. It answers only when the intent is unknown or no candidate could be resolved.
2. Within a generator's array, in array order, with every entry resolved up front.
3. Per model, up to `maxAttemptsPerModel` attempts on a retryable error, with `min(maxDelayMs, baseDelayMs * 2^(n-1))` ms between them. A non-retryable or provider-load error moves on at once. A stream makes one attempt per model.
4. When every model fails, one error lists every attempt.

**How do you override an intent per environment?** Set `FSDEV_INTENT_<NAME>` to one model string in that environment, or `FSDEV_DEFAULT_MODEL` for the fall-through. The intent must be declared in the app's `intents`. `fsdev run --model <id>` does it for one command. See [Per-environment overrides](#per-environment-overrides).
