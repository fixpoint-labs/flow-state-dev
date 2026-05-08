---
sidebar_position: 3
---

# Model Groups

How to use semantic model labels with automatic fallback across providers.

## The Problem

Every production AI app needs model fallback. API keys expire, providers go down, rate limits hit. Hardcoding a single model ID means a single point of failure.

Two mechanisms in the framework solve this. **Intents** are named routing groups configured on the model resolver — generators reference them with `model: "intent/<name>"`. **Model groups** are the same idea inside the `createFSDProvider` factory, used when you want a callable provider object (`provider("fast")`) instead of a magic string. Both walk an ordered candidate list, filter to providers the app has keys for, retry on failure, and fall back to the next entry.

## Quick Start: Intents

```ts
import { createModelResolver } from "@flow-state-dev/core/models";
import { generator } from "@flow-state-dev/core";

const resolver = createModelResolver({
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    chat: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5", "google/gemini-2.5-pro"],
  },
});

const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
});
```

`"intent/chat"` resolves to the first available candidate. If none of an intent's models are reachable, the resolver falls back to `defaultModel`. Generators also accept array fallback directly:

```ts
const chat = generator({
  name: "chat",
  model: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6"],
  prompt: "You are a helpful assistant.",
});
```

## Canonical intent names

The framework documents six intent names — `utility`, `chat`, `plan`, `synthesize`, `code`, `reason`. Apps configure their own model lists; the framework does not ship default model strings. See [Models](/docs/fundamentals/models#canonical-intent-names) for the cognitive shape of each.

`synthesize` doubles as the structured-JSON intent. Apps should point it at JSON-reliable models, not the cheapest tier.

## Provider Detection

The model resolver auto-detects which providers are available by checking environment variables:

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |

If only `ANTHROPIC_API_KEY` is set and an intent's first candidate is `anthropic/claude-sonnet-4.6`, that's what runs. If that key later fails, the resolver skips to the next candidate, and so on.

### Explicit Keys

Override auto-detection with explicit keys:

```ts
const resolver = createModelResolver({
  keys: {
    anthropic: process.env.MY_ANTHROPIC_KEY,
    openai: process.env.MY_OPENAI_KEY,
  },
});
```

## Gateways

Gateways are availability multipliers. A single gateway key makes all providers available without needing individual API keys.

### Vercel AI Gateway

Zero-config on Vercel deployments. If `AI_GATEWAY_API_KEY` is set (or auto-provided via Vercel OIDC), all providers are available. Use the `vercel/` prefix in model strings to route through the gateway:

```
"vercel/openai/gpt-5.5"                — OpenAI via Vercel gateway
"vercel/anthropic/claude-sonnet-4.6"   — Anthropic via gateway
```

The gateway is auto-detected from `AI_GATEWAY_API_KEY` even without explicit config. Just deploy to Vercel and it works.

### OpenRouter

Uses `OPENROUTER_API_KEY`.

### Priority

Direct API keys take priority over gateways. If you have `ANTHROPIC_API_KEY` set and a Vercel gateway configured, Anthropic models use the direct key (lower latency, no intermediary). Other providers route through the gateway.

## Provider Preference

Intents encode a use-case shape — "what kind of work." They do not encode a brand choice. If you want to say "I prefer Anthropic across the board," that is an orthogonal axis called **provider preference**.

The option name is `preferProvider` everywhere it appears: `selectModel`, `createFSDProvider`, and the per-call resolver options.

The resolver walks the intent's list, but reorders it first: models from preferred providers come first (in the order you give), the rest come after in their original order. Availability filtering and retry/fallback run on the reordered list.

### With `createFSDProvider`

`createFSDProvider` exposes the same idea as a callable factory. Per-call preference:

```ts
import { createFSDProvider, defaultGroups } from "@flow-state-dev/core/models";

const provider = createFSDProvider({ groups: defaultGroups });

// Default: group's natural order
provider("balanced");

// Prefer Anthropic; fall back to the rest of the group if no Anthropic model is available
provider("balanced", { preferProvider: "anthropic" });

// Ordered preference
provider("balanced", { preferProvider: ["anthropic", "google"] });
```

Provider-level default (applies to every call unless overridden):

```ts
const provider = createFSDProvider({
  groups: defaultGroups,
  providerPreference: "anthropic",
});

provider("balanced");                                       // uses anthropic models first
provider("balanced", { preferProvider: "openai" });         // call-site wins
provider("balanced", { preferProvider: [] });               // explicit "no preference"
```

### With `createModelResolver`

Set the default on the resolver. Every `intent/<name>` resolution reorders accordingly:

```ts
const resolver = createModelResolver({
  providerPreference: "anthropic",
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: { chat: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"] },
});
```

Per-call override flows through the resolver callable's third argument:

```ts
resolver("intent/chat", "block-name", { preferProvider: "openai" });
```

### Reordering example

Intent `chat` = `["openai/gpt-5.5", "anthropic/claude-opus-4.7", "google/gemini-2.5-pro", "anthropic/claude-sonnet-4.6"]`.

| `preferProvider` | Order used |
|------------------|------------|
| `undefined` | openai/gpt-5.5, anthropic/claude-opus-4.7, google/gemini-2.5-pro, anthropic/claude-sonnet-4.6 |
| `"anthropic"` | anthropic/claude-opus-4.7, anthropic/claude-sonnet-4.6, openai/gpt-5.5, google/gemini-2.5-pro |
| `["anthropic","google"]` | anthropic/claude-opus-4.7, anthropic/claude-sonnet-4.6, google/gemini-2.5-pro, openai/gpt-5.5 |

Relative order within a provider bucket is preserved.

### Strict mode

By default, `preferProvider` is a soft preference — if no preferred model is available, the rest of the group is still tried. Opt in to strict mode for compliance-style use cases ("only ever Anthropic"):

```ts
provider("balanced", { preferProvider: "anthropic", strict: true });
```

Strict mode throws when no model from the preferred providers is available. The error message names the group and the preferred providers.

### Precedence

Highest wins:

1. Call-site `{ preferProvider }` on `provider(...)` or on the resolver's per-call options
2. `createFSDProvider({ providerPreference })` (or `createModelResolver({ providerPreference })`)
3. Nothing — the group's natural order

Call-site `preferProvider` is an override, not a merge. An empty array `preferProvider: []` explicitly means "no preference" — it does not re-inherit the group-level default.

### Dynamic preference (per-input or per-user)

Use the existing `model: (input, ctx) => ...` callback form, not a new mechanism:

```ts
const chat = generator({
  name: "chat",
  model: (input, ctx) =>
    provider("balanced", { preferProvider: ctx.user.state.preferredProvider }),
});
```

For declarative selection, `selectModel` exposes a `preferProvider` rule kind that *collects* (does not short-circuit) — it composes with `when` rules so you can choose an intent and a provider preference independently. See [Models — selectModel](/docs/fundamentals/models#selectmodel).

### Introspection

`provider.explain(groupName, options?)` returns the ordered candidate list with availability status, plus the model the resolver would choose. Useful for debugging and for building UI selectors.

```ts
provider.explain("balanced", { preferProvider: "anthropic" });
// {
//   preset: "balanced",
//   prefer: ["anthropic"],
//   candidates: [
//     { modelId: "anthropic/claude-sonnet-4.6", providerName: "anthropic",
//       available: true, source: "key" },
//     { modelId: "openai/gpt-5.5", providerName: "openai",
//       available: true, source: "gateway", gateway: "vercel" },
//     { modelId: "google/gemini-2.5-pro", providerName: "google",
//       available: false, reason: "no-key-no-gateway" },
//   ],
//   willUse: "anthropic/claude-sonnet-4.6",
// }
```

## Retry and Fallback

The fallback behavior is configurable:

```ts
const resolver = createModelResolver({
  retryPolicy: {
    maxAttemptsPerModel: 3,  // default: 2
    baseDelayMs: 500,        // default: 1000
    maxDelayMs: 15000,       // default: 10000
  },
});
```

When a model call fails:

1. If the error is retryable (429, 500, 502, 503, network errors), retry the same model with exponential backoff
2. After `maxAttemptsPerModel` retries, move to the next model in the list
3. Non-retryable errors (auth failures, bad requests) skip directly to the next model
4. If all models are exhausted, throw with a summary of every error

### Streaming

Streaming uses a simpler fallback: if a stream fails before yielding its first chunk, the next model is tried. Mid-stream failures propagate to the caller — there's no way to transparently resume a stream from a different model.

## Model String Format

Model strings use slash format:

| Format | Example | Description |
|--------|---------|-------------|
| `provider/model` | `"openai/gpt-5.5"` | Direct provider |
| `gateway/provider/model` | `"vercel/openai/gpt-5.5"` | Via gateway |
| `intent/<name>` | `"intent/chat"` | Named intent (resolver-configured) |

## Relationship to Model Resolver

`createModelResolver` handles direct strings, gateway strings, intents, and array fallback in one API:

- **Model strings** like `"openai/gpt-5.5"` are resolved to concrete AI SDK model instances
- **Intents** like `"intent/chat"` resolve through the configured candidate list with built-in fallback to `defaultModel`
- **Array fallback** like `["openai/gpt-5.5", "anthropic/claude-sonnet-4.6"]` tries models in order

Zero-config usage auto-detects providers from environment variables:

```ts
const resolver = createModelResolver();
```
