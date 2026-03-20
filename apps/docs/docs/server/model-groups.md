---
sidebar_position: 3
---

# Model Groups

How to use semantic model labels with automatic fallback across providers.

## The Problem

Every production AI app needs model fallback. API keys expire, providers go down, rate limits hit. Hardcoding a single model ID means a single point of failure.

Model groups solve this. Instead of `model: "gpt-5.4"`, you write `model: provider("fast")`. The framework resolves to the best available model at execution time, retries on failure, and falls back to the next provider automatically.

## Quick Start

```ts
import { createFSDProvider, defaultGroups } from "@flow-state-dev/server";
import { generator } from "@flow-state-dev/core";

const provider = createFSDProvider({
  groups: defaultGroups,
});

const chat = generator({
  name: "chat",
  model: provider("fast"),
  prompt: "You are a helpful assistant.",
});
```

`provider("fast")` returns a `GeneratorModel` that tries models in order until one works. No changes to your generator code — it's a drop-in replacement for any model reference.

## Default Groups

Three built-in groups ship with the framework:

| Group | Models (preference order) | Defaults |
|-------|--------------------------|----------|
| `fast` | claude-sonnet-4.6, gpt-5.4-mini, gemini-3-flash | `maxTokens: 1024` |
| `thinking` | claude-opus-4.6, gpt-5.4, gemini-3.1-pro-preview | Anthropic extended thinking enabled |
| `balanced` | claude-sonnet-4.6, gpt-5.4, gemini-3-flash | None |

The first available model in each list is used. "Available" means the app has an API key for that provider (direct key or gateway).

## Provider Detection

The provider factory auto-detects which providers are available by checking environment variables:

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |

If only `ANTHROPIC_API_KEY` is set and you call `provider("fast")`, it resolves to `claude-sonnet-4.6`. If that key later fails, it skips to `gpt-5.4-mini` — which won't be available either, so it moves to `gemini-3-flash`. If nothing works, you get a clear error listing what was tried.

### Explicit Keys

Override auto-detection with explicit keys:

```ts
const provider = createFSDProvider({
  groups: defaultGroups,
  keys: {
    anthropic: process.env.MY_ANTHROPIC_KEY,
    openai: process.env.MY_OPENAI_KEY,
  },
});
```

## Gateways

Gateways are availability multipliers. A single gateway key makes all providers available without needing individual API keys.

### Vercel AI Gateway

Zero-config on Vercel deployments. If `AI_GATEWAY_API_KEY` is set (or auto-provided via Vercel OIDC), all providers are available:

```ts
const provider = createFSDProvider({
  groups: defaultGroups,
  gateways: {
    vercel: { type: "vercel" },
  },
});
```

The gateway is also auto-detected from `AI_GATEWAY_API_KEY` even without explicit config. Just deploy to Vercel and it works.

### OpenRouter

```ts
const provider = createFSDProvider({
  groups: defaultGroups,
  gateways: {
    openrouter: { type: "openrouter" },
  },
});
```

Reads from `OPENROUTER_API_KEY`.

### Priority

Direct API keys take priority over gateways. If you have `ANTHROPIC_API_KEY` set and a Vercel gateway configured, Anthropic models use the direct key (lower latency, no intermediary). Other providers route through the gateway.

## Custom Groups

Override defaults or add new groups:

```ts
import { createFSDProvider, defaultGroups } from "@flow-state-dev/server";

const provider = createFSDProvider({
  groups: {
    ...defaultGroups,
    // Override built-in
    fast: {
      models: ["openai:gpt-5.4-nano", "google:gemini-3.1-flash-lite-preview"],
      defaults: { maxTokens: 512 },
    },
    // Add new
    coding: {
      models: ["anthropic:claude-opus-4.6", "openai:gpt-5.4"],
      defaults: { maxTokens: 8192 },
    },
  },
});

const coder = generator({
  name: "coder",
  model: provider("coding"),
});
```

### Group Defaults

Group `defaults` set baseline generation config. Caller config always wins:

```ts
const provider = createFSDProvider({
  groups: {
    thinking: {
      models: ["anthropic:claude-opus-4.6", "openai:gpt-5.4"],
      defaults: {
        maxTokens: 4096,
        providerOptions: {
          anthropic: { thinking: { budgetTokens: 10000 } },
        },
      },
    },
  },
});
```

Provider-specific options are filtered at runtime. If `thinking` resolves to an OpenAI model, the `anthropic` provider options are stripped — they won't leak to the wrong provider.

## Retry and Fallback

The fallback behavior is configurable:

```ts
const provider = createFSDProvider({
  groups: defaultGroups,
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

## Explicit Providers

For full control, pass AI SDK provider instances directly instead of relying on auto-detection:

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const provider = createFSDProvider({
  groups: defaultGroups,
  providers: { anthropic, openai },
});
```

When `providers` is set, env var auto-detection is skipped. Only the providers you pass are available.

## Introspection

Check what's available at runtime:

```ts
provider.groups();              // ["fast", "thinking", "balanced"]
provider.available("fast");     // ["anthropic:claude-sonnet-4.6", "openai:gpt-5.4-mini"]
```

`available()` returns only the models in a group that have a working provider configured.

## Dynamic Model Selection

Use a function for `model` to pick groups based on input:

```ts
const adaptive = generator({
  name: "adaptive",
  model: (input, ctx) => {
    return input.needsReasoning
      ? provider("thinking")
      : provider("fast");
  },
});
```

## Relationship to Custom Model Resolver

`createFSDProvider` and `createAiSdkModelResolver` solve different problems:

- **Model resolver** maps string model IDs to concrete models. Used when generators specify `model: "gpt-5.4"` as a string.
- **Model groups** provide `GeneratorModel` instances directly, with built-in fallback. Used when generators specify `model: provider("fast")`.

They work side by side. Use model groups for generators that should be portable across providers. Use the resolver for generators that target a specific model.
