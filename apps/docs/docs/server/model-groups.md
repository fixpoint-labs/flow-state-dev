---
sidebar_position: 3
---

# Model Groups

How to use semantic model labels with automatic fallback across providers.

## The Problem

Every production AI app needs model fallback. API keys expire, providers go down, rate limits hit. Hardcoding a single model ID means a single point of failure.

Model groups solve this. Instead of `model: "gpt-5.4"`, you write `model: "preset/fast"` or pass an array of models. The framework resolves to the best available model at execution time, retries on failure, and falls back to the next provider automatically.

## Quick Start

```ts
import { createModelResolver } from "@flow-state-dev/core/models";
import { generator } from "@flow-state-dev/core";

const resolver = createModelResolver({
  presets: {
    fast: { models: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4-mini", "google/gemini-3-flash"] },
  },
});

const chat = generator({
  name: "chat",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
});
```

`"preset/fast"` resolves to the first available model in the preset's list. No changes to your generator code — it's a drop-in replacement for any model reference.

Generators also support array fallback directly:

```ts
const chat = generator({
  name: "chat",
  model: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
  prompt: "You are a helpful assistant.",
});
```

## Default Presets

Three built-in presets ship with the framework:

| Preset | Models (preference order) | Defaults |
|--------|--------------------------|----------|
| `fast` | anthropic/claude-sonnet-4-6, openai/gpt-5.4-mini, google/gemini-3-flash | `maxTokens: 1024` |
| `thinking` | anthropic/claude-opus-4-6, openai/gpt-5.4, google/gemini-3.1-pro-preview | Anthropic extended thinking enabled |
| `balanced` | anthropic/claude-sonnet-4-6, openai/gpt-5.4, google/gemini-3-flash | None |

The first available model in each list is used. "Available" means the app has an API key for that provider (direct key or gateway).

## Provider Detection

The model resolver auto-detects which providers are available by checking environment variables:

| Provider | Environment Variable |
|----------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |

If only `ANTHROPIC_API_KEY` is set and you use `"preset/fast"`, it resolves to `anthropic/claude-sonnet-4-6`. If that key later fails, it skips to `openai/gpt-5.4-mini` — which won't be available either, so it moves to `google/gemini-3-flash`. If nothing works, you get a clear error listing what was tried.

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
"vercel/openai/gpt-5.4"    — OpenAI via Vercel gateway
"vercel/anthropic/claude-sonnet-4-6"  — Anthropic via gateway
```

The gateway is auto-detected from `AI_GATEWAY_API_KEY` even without explicit config. Just deploy to Vercel and it works.

### OpenRouter

Uses `OPENROUTER_API_KEY`.

### Priority

Direct API keys take priority over gateways. If you have `ANTHROPIC_API_KEY` set and a Vercel gateway configured, Anthropic models use the direct key (lower latency, no intermediary). Other providers route through the gateway.

## Custom Presets

Override defaults or add new presets:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  presets: {
    // Override built-in
    fast: {
      models: ["openai/gpt-5.4-nano", "google/gemini-3.1-flash-lite-preview"],
      defaults: { maxTokens: 512 },
    },
    // Add new
    coding: {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
      defaults: { maxTokens: 8192 },
    },
  },
});

const coder = generator({
  name: "coder",
  model: "preset/coding",
});
```

### Preset Defaults

Preset `defaults` set baseline generation config. Caller config always wins:

```ts
const resolver = createModelResolver({
  presets: {
    thinking: {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
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
| `provider/model` | `"openai/gpt-5.4"` | Direct provider |
| `gateway/provider/model` | `"vercel/openai/gpt-5.4"` | Via gateway |
| `preset/name` | `"preset/fast"` | Built-in preset |

## Introspection

Check what's available at runtime:

```ts
resolver.presets();              // ["fast", "thinking", "balanced"]
resolver.available("fast");      // ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4-mini"]
```

`available()` returns only the models in a preset that have a working provider configured.

## Dynamic Model Selection

Use a function for `model` to pick presets based on input:

```ts
const adaptive = generator({
  name: "adaptive",
  model: (input, ctx) => {
    return input.needsReasoning
      ? "preset/thinking"
      : "preset/fast";
  },
});
```

## Relationship to Model Resolver

`createModelResolver` handles both model resolution and presets in a unified API:

- **Model strings** like `"openai/gpt-5.4"` are resolved to concrete AI SDK model instances
- **Presets** like `"preset/fast"` resolve through the preset's model list with built-in fallback
- **Array fallback** like `["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"]` tries models in order

Zero-config usage auto-detects providers from environment variables:

```ts
const resolver = createModelResolver();
```
