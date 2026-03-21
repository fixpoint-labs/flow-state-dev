---
sidebar_position: 2
---

# Custom Model Resolver

How to configure AI model resolution for your generators.

## How Model Resolution Works

Generator blocks specify a `model` string (e.g., `"openai/gpt-5.4-mini"`). At runtime, the server resolves this string to an actual AI SDK model instance via a **model resolver**.

```ts
const chatGen = generator({
  name: "chat",
  model: "openai/gpt-5.4-mini",  // Resolved at runtime
  // ...
});
```

Model strings use slash format: `"provider/model"`. For gateway routing, use three segments: `"vercel/openai/gpt-5.4"`.

## Zero-Config Resolver

The simplest setup auto-detects providers from environment variables:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver();
// Detects OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY
```

Pass it to the router:

```ts
const router = createFlowApiRouter({
  registry,
  modelResolver: resolver,
});
```

## Resolver with Options

Configure explicit keys, presets, and retry policy:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  keys: {
    openai: process.env.MY_OPENAI_KEY,
    anthropic: process.env.MY_ANTHROPIC_KEY,
  },
  presets: {
    fast: { models: ["openai/gpt-5.4-mini"] },
  },
  retryPolicy: {
    maxAttemptsPerModel: 3,
  },
});
```

## Array Fallback

Generators support array fallback directly. The resolver tries models in order:

```ts
const chat = generator({
  name: "chat",
  model: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
  prompt: "You are a helpful assistant.",
});
```

## Provider Search Tools

When generators use `search: true`, the framework needs access to the provider's tool namespace (e.g., `anthropic.tools.webSearch_20250305()`). The `createModelResolver()` handles this automatically when it detects provider API keys.

For multi-provider setups, search tools are resolved based on the provider prefix in the model string:

```ts
// "anthropic/claude-sonnet-4-6" → Anthropic search tools
// "openai/gpt-5.4" → OpenAI search tools
```

When a provider doesn't support search, `search: true` on generators will be silently ignored — the model just won't have search available. No error is thrown.

The framework auto-detects the provider from the model string's prefix and maps normalized search config to provider-specific parameters. See [Web search](/docs/fundamentals/blocks#web-search) for generator-side configuration.

## Testing

In tests, use `createMockModelResolver` to avoid real API calls:

```ts
import { createMockModelResolver } from "@flow-state-dev/testing";

const mockResolver = createMockModelResolver({
  models: {
    "openai/gpt-5.4-mini": { output: "Mocked response" },
  },
});
```

Or use generator mocks in test harnesses (preferred):

```ts
const result = await testFlow({
  flow: myFlow,
  action: "chat",
  input: { message: "Hello" },
  generators: {
    "chat": { output: "Mocked!" },
  },
});
```
