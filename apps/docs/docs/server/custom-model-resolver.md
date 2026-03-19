---
sidebar_position: 2
---

# Custom Model Resolver

How to configure AI model resolution for your generators.

## How Model Resolution Works

Generator blocks specify a `model` string (e.g., `"gpt-5-mini"`). At runtime, the server resolves this string to an actual AI SDK model instance via a **model resolver**.

```ts
const chatGen = generator({
  name: "chat",
  model: "gpt-5-mini",  // Resolved at runtime
  // ...
});
```

## Default Resolver

By default, the server uses the Vercel AI Gateway:

```ts
const router = createFlowApiRouter({ registry });
// Uses AI_GATEWAY_API_KEY or Vercel OIDC for model resolution
```

## Custom Resolver with AI SDK

Use `createAiSdkModelResolver` to provide your own model mapping:

```ts
import { createFlowApiRouter, createAiSdkModelResolver } from "@flow-state-dev/server";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

const router = createFlowApiRouter({
  registry,
  modelResolver: createAiSdkModelResolver((modelId) => {
    switch (modelId) {
      case "gpt-5-mini":
        return openai("gpt-4o-mini");
      case "claude-sonnet":
        return anthropic("claude-sonnet-4-20250514");
      default:
        return openai(modelId);
    }
  }),
});
```

## Multiple Providers

Route models to different providers based on the model ID pattern:

```ts
const resolver = createAiSdkModelResolver((modelId) => {
  if (modelId.startsWith("claude-")) {
    return anthropic(modelId);
  }
  if (modelId.startsWith("gpt-")) {
    return openai(modelId);
  }
  // Default provider
  return openai(modelId);
});
```

## Environment-Based Configuration

```ts
const resolver = createAiSdkModelResolver((modelId) => {
  const provider = process.env.AI_PROVIDER ?? "openai";

  switch (provider) {
    case "anthropic":
      return anthropic(modelId);
    case "openai":
    default:
      return openai(modelId);
  }
});
```

## Provider Search Tools

When generators use `search: true`, the framework needs access to the provider's tool namespace (e.g., `anthropic.tools.webSearch_20250305()`). This works automatically when you pass the provider object directly:

```ts
import { createAiSdkModelResolver } from "@flow-state-dev/server";
import { anthropic } from "@ai-sdk/anthropic";

// Pass the provider directly — it's both a model factory AND has .tools
const resolver = createAiSdkModelResolver(anthropic);
```

The `anthropic` object from `@ai-sdk/anthropic` is callable (returns a model when called with a model ID) and has a `.tools` property. The resolver detects this and uses it for search tool resolution.

For multi-provider setups, pass the primary provider that should handle search:

```ts
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

// OpenAI as default with search support
const resolver = createAiSdkModelResolver(openai);

// Or use a custom function — search still works if you also
// pass the provider's tools separately
const resolver = createAiSdkModelResolver((modelId) => {
  if (modelId.startsWith("claude-")) return anthropic(modelId);
  return openai(modelId);
});
```

When using a plain function resolver (no `.tools` property), `search: true` on generators will be silently ignored — the model just won't have search available. No error is thrown.

The framework auto-detects the provider from the model's `provider` string and maps normalized search config to provider-specific parameters. See [Web search](/docs/fundamentals/blocks#web-search) for generator-side configuration.

## Testing

In tests, use `createMockModelResolver` to avoid real API calls:

```ts
import { createMockModelResolver } from "@flow-state-dev/testing";

const mockResolver = createMockModelResolver({
  models: {
    "gpt-5-mini": { output: "Mocked response" },
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
