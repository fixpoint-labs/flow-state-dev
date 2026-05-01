---
sidebar_position: 7
---

# Models

Every generator block needs a model. The framework gives you multiple ways to specify one, from a single model string to a preset that handles fallback across providers automatically.

## Model Strings

The simplest form. A slash-separated provider and model ID:

```ts
const chat = generator({
  name: "chat",
  model: "openai/gpt-5.4",
  prompt: "You are a helpful assistant.",
});
```

Supported formats:

| Format | Example | What it does |
|--------|---------|-------------|
| `provider/model` | `"anthropic/claude-sonnet-4-6"` | Direct provider call |
| `preset/name` | `"preset/small"` | Resolves to the best available model in that preset |
| `gateway/provider/model` | `"vercel/openai/gpt-5.4"` | Routes through a gateway |

## Presets

Presets are named model lists. When you write `model: "preset/small"`, the framework picks the first model in that preset's list that has a working API key configured. If that model fails at runtime, it retries then falls back to the next one.

This means one line of config gives you multi-provider redundancy:

```ts
const chat = generator({
  name: "chat",
  model: "preset/small",
  prompt: "You are a helpful assistant.",
});
```

If your `ANTHROPIC_API_KEY` is set, this resolves to `claude-haiku-4-5`. If Anthropic is down, it tries OpenAI, then Google. Your generator code doesn't change.

### Built-in Presets

The framework ships these presets:

| Preset | Models (tried in order) | Notes |
|--------|------------------------|-------|
| `small` | gpt-5.4-mini, claude-haiku-4-5, gemini-3-flash | `maxTokens: 1024` |
| `medium` | gpt-5.4, claude-sonnet-4-6, gemini-2.5-pro | General-purpose |
| `large` | claude-opus-4-6, gpt-5.4, gemini-3.1-pro-preview | Highest capability |
| `thinking-small` | gpt-5.4, claude-sonnet-4-6, gemini-2.5-pro | Extended reasoning enabled |
| `thinking-medium` | gpt-5.4, claude-sonnet-4-6, gemini-2.5-pro | Extended reasoning enabled |
| `thinking-large` | claude-opus-4-6, gpt-5.4, gemini-3.1-pro-preview | Extended reasoning enabled |
| `tiny` | gpt-5.4-nano, gemini-3.1-flash-lite-preview | Cheapest, fastest |

The thinking presets activate provider-specific reasoning features. For Anthropic models, this enables extended thinking with a 10,000-token budget. The models in thinking presets are the same tier as their non-thinking counterparts, but the generation config tells them to reason before answering.

### Custom Presets

Define your own or override built-ins when creating the model resolver:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  presets: {
    coding: {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
      defaults: { maxTokens: 8192 },
    },
  },
});
```

Then use it like any other preset:

```ts
const coder = generator({
  name: "coder",
  model: "preset/coding",
});
```

## Array Fallback

Don't need a named preset? Pass an array directly. The framework tries each model in order:

```ts
const chat = generator({
  name: "chat",
  model: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
  prompt: "You are a helpful assistant.",
});
```

This gives you the same retry-and-fallback behavior as presets, without defining a named group. Useful for one-off blocks where a preset would be overkill.

## Dynamic Selection

The `model` field accepts a function. It receives the block's input and context, so you can pick models based on what's happening at runtime:

```ts
const adaptive = generator({
  name: "adaptive",
  model: (input, ctx) => {
    if (input.message.length > 2000) return "preset/large";
    return "preset/small";
  },
  prompt: "You are a helpful assistant.",
});
```

The function can return any valid model value: a string, a preset reference, an array, or a resolved model instance.

### `selectModel`

Inline model functions work, but they tend to accumulate type casts and get hard to scan. `selectModel` is a declarative alternative. You give it a default and a list of rules:

```ts
import { generator, selectModel } from "@flow-state-dev/core";

const assistant = generator({
  name: "assistant",
  model: selectModel("preset/small", [
    { prefer: (_input, ctx) => ctx.user?.state.preferredModel },
  ]),
  prompt: "You are a helpful assistant.",
});
```

Rules are evaluated in two phases. **Prefer rules** run first. Each returns a candidate model string. The first non-null value that differs from the default wins. **When rules** run second. Each has a boolean condition and a fixed model to use when it's true.

```ts
model: selectModel("preset/small", [
  // Phase 1: prefer — check user override
  { prefer: (_input, ctx) => ctx.user?.state.preferredModel },

  // Phase 2: when — condition-based overrides
  { when: (input) => input.message.length > 5000, use: "preset/large" },
  { when: (_input, ctx) => ctx.session.state.mode === "create", use: "preset/medium" },
])
```

If no rule matches, the default is returned. Prefer rules that return `null`, `undefined`, an empty string, or the default value itself are skipped, so a user state field that hasn't been set yet falls through cleanly.

This is what the kitchen sink example uses. The user picks a preset from the UI, the selection lands in user state, and a `prefer` rule picks it up at generation time:

```ts
model: selectModel("preset/small", {
  prefer: (_input, ctx) => ctx.user?.state.preferredModel,
})
```

Both `prefer` and `when` callbacks can be async.

## User-Facing Model Selection

For apps where end users should control which model runs, the pattern is:

1. Store the user's choice in user state (persists across sessions)
2. Expose a flow action that updates it
3. Read the choice in the generator's `model` function

Here's the flow-level setup:

```ts
const userStateSchema = z.object({
  preferredModel: z.string().default("preset/small"),
});

const setPreferredModel = handler({
  name: "set-preferred-model",
  inputSchema: z.object({ preferredModel: z.string() }),
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ preferredModel: input.preferredModel });
  },
});

const kitchenSink = defineFlow({
  kind: "my-app",
  actions: {
    chat: { block: chatPipeline, inputSchema },
    setPreferredModel: { block: setPreferredModel, inputSchema: z.object({ preferredModel: z.string() }) },
  },
  user: { stateSchema: userStateSchema },
});
```

On the client side, call the action when the user picks a new model. The change takes effect on the next generation — no restart needed.

```ts
await session.sendAction("setPreferredModel", { preferredModel: "preset/large" });
```

Surface the current selection via `clientData` so the UI stays in sync:

```ts
user: {
  stateSchema: userStateSchema,
  clientData: {
    preferences: (ctx) => ({
      preferredModel: ctx.state.preferredModel,
    }),
  },
},
```

## Provider Detection

The model resolver figures out which providers are available by checking environment variables:

| Provider | Variable |
|----------|----------|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Vercel Gateway | `AI_GATEWAY_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

A gateway key makes all providers available through that gateway. Direct keys take priority over gateways when both exist for the same provider.

Zero-config setup (auto-detects from env):

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver();
```

## Retry and Fallback

When a model call fails:

1. Retryable errors (429, 500-503, network) retry the same model with exponential backoff
2. After exhausting retries, moves to the next model in the list
3. Auth errors and bad requests skip immediately to the next model
4. If everything fails, throws with a summary of what was tried

For streaming, fallback only works before the first chunk arrives. Once a stream starts producing tokens, a mid-stream failure propagates to the caller. There's no transparent way to resume a stream from a different model.

Configure retry behavior:

```ts
const resolver = createModelResolver({
  retryPolicy: {
    maxAttemptsPerModel: 3,  // default: 2
    baseDelayMs: 500,        // default: 1000
    maxDelayMs: 15000,       // default: 10000
  },
});
```

## Preset Defaults

Presets can carry default generation settings that apply to every model in the group:

```ts
const resolver = createModelResolver({
  presets: {
    thinking: {
      models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
      defaults: {
        maxTokens: 4096,
        providerOptions: {
          anthropic: { thinking: { type: "enabled", budgetTokens: 10000 } },
        },
      },
    },
  },
});
```

Provider-specific options are filtered at runtime. If the preset resolves to an OpenAI model, the `anthropic` options are stripped automatically.

## Prompt Caching

Every generator opts into prompt caching by default. For Anthropic models that means the adapter stamps `providerOptions.anthropic.cacheControl` on the last system message, so tools + system get cached together. OpenAI, Google, and DeepSeek cache implicitly and are left alone. If you're routing through the Vercel AI Gateway, the adapter sets `providerOptions.gateway.caching: 'auto'` instead and lets the gateway mark breakpoints for the underlying provider.

You don't have to configure anything to get the win. When it matters, tune it:

```ts
const chat = generator({
  name: "chat",
  model: "anthropic/claude-sonnet-4-6",
  prompt: LONG_SYSTEM_PROMPT,
  caching: {
    enabled: true,         // default true
    breakpoints: "auto",   // "auto" (default) or "manual"
    ttl: "5m",             // "5m" (default) or "1h"
  },
});
```

What the modes do:

| Mode | Behavior |
|------|----------|
| `enabled: false` | No cache markers emitted, regardless of provider. |
| `breakpoints: "auto"` | Adapter decides placement per provider. Skips Anthropic marking when the cacheable prefix is below ~1024 tokens (the API activation floor). |
| `breakpoints: "manual"` | Adapter passes your `providerOptions` through untouched. Use this when you want to place multiple breakpoints (e.g., system + end-of-history for long multi-turn agents) or different TTLs per part. |

`caching` can be a function of `(input, ctx)` when the decision depends on per-call state.

### Observing cache hits

The adapter threads Anthropic's cache counters into `GeneratorModelUsage`:

```ts
result.usage = {
  promptTokens: 1200,
  completionTokens: 48,
  totalTokens: 1248,
  cacheCreationInputTokens: 1100,  // first turn
  cacheReadInputTokens: 0,
}
// ...subsequent turn on the same stable prefix:
result.usage = {
  promptTokens: 1200,
  completionTokens: 52,
  totalTokens: 1252,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 1100,       // ~90% cheaper than a fresh input
}
```

The DevTool's token usage panel surfaces the same numbers per call and aggregated per session.

### Cost model in one line

Cache write is ~1.25× the input rate; cache read is ~0.1×. One read refunds the write premium. For any generator called more than once with a stable system prompt, default-on is strictly cheaper.

For a fuller treatment — including the audit of call paths that existed before default-on, the minimum-prefix threshold, and manual-mode placement patterns — see [`docs/PROMPT_CACHING.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/docs/PROMPT_CACHING.md).

## What to Read Next

- [Server Setup](/docs/server/setup) — wiring the resolver into your app
- [Model Groups](/docs/advanced/model-groups) — deeper dive into presets, gateways, introspection
- [Custom Model Resolver](/docs/advanced/custom-model-resolver) — advanced resolver configuration
