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
