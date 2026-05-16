---
sidebar_position: 7
---

# Models

Every generator block needs a model. The framework gives you multiple ways to specify one, from a single model string to a named intent that handles fallback across providers automatically.

## Model Strings

The simplest form. A slash-separated provider and model ID:

```ts
const chat = generator({
  name: "chat",
  model: "openai/gpt-5.5",
  prompt: "You are a helpful assistant.",
});
```

Supported formats:

| Format | Example | What it does |
|--------|---------|-------------|
| `provider/model` | `"anthropic/claude-sonnet-4.6"` | Direct provider call |
| `intent/<name>` | `"intent/chat"` | Resolves to the first available model in the named intent |
| `gateway/provider/model` | `"vercel/openai/gpt-5.5"` | Routes through a gateway |

## Intents

An intent is a named routing group. When you write `model: "intent/utility"`, the framework picks the first candidate in that intent's list that has a working API key configured. If that model fails at runtime, it retries then falls back to the next one. If the whole list is unreachable, it falls back to the resolver's `defaultModel`.

One line of config gives you multi-provider redundancy:

```ts
const chat = generator({
  name: "chat",
  model: "intent/chat",
  prompt: "You are a helpful assistant.",
});
```

### Canonical intent names

The framework documents six intent names. Apps configure their own model lists per intent — there are no built-in defaults. Pick names from this list when you can; add your own when you need to.

| Intent | Cognitive shape |
|--------|-----------------|
| `utility` | Bounded utility tasks: classification, routing, extraction, summarization, titles. Smallest reliable model. |
| `chat` | User-facing assistant turns. App-tunable. |
| `plan` | Goal decomposition, task graphs, supervisor planning. Errors compound — point this at your strongest model. |
| `synthesize` | Combining intermediate artifacts; structured-JSON heavy work. **Doubles as the structured-JSON intent** — apps should point it at JSON-reliable models (Sonnet/GPT-class), not the cheapest tier. |
| `code` | Code generation, review, debugging. |
| `reason` | Open-ended deliberation that doesn't fit the other names. |

### Configuring intents

Intents are configured on the model resolver:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    utility: ["anthropic/claude-haiku-4.5", "openai/gpt-5.5-nano"],
    chat: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    plan: ["anthropic/claude-opus-4.7"],
    synthesize: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
  },
});
```

`defaultModel` is required when `intents` is non-empty. It must be a `provider/model` or `gateway/provider/model` string — never another `intent/*`. See [Custom Model Resolver](/docs/advanced/custom-model-resolver) for the full options reference.

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
    if (input.message.length > 2000) return "intent/reason";
    return "intent/chat";
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
  model: selectModel("intent/chat", [
    { preferProvider: (_input, ctx) => ctx.user?.state.preferredProvider },
  ]),
  prompt: "You are a helpful assistant.",
});
```

Rules are evaluated in two phases. **PreferProvider rules** run first and *collect* — every non-null result contributes a provider-name preference (`"anthropic"`, `"openai"`, etc.) that the resolver uses to reorder the intent's candidate list. **When rules** run second. Each has a boolean condition and a fixed model to use when it's true.

```ts
model: selectModel("intent/chat", [
  // Phase 1: preferProvider — provider-name preference, collected into the resolver
  { preferProvider: (_input, ctx) => ctx.user?.state.preferredProvider },

  // Phase 2: when — condition-based model swaps
  { when: (input) => input.message.length > 5000, use: "intent/reason" },
  { when: (_input, ctx) => ctx.session.state.mode === "create", use: "intent/plan" },
])
```

If no `when` matches, the default is returned. `preferProvider` returns a *provider name* (or array of names), not a model string — the two compose: `when` chooses the intent, `preferProvider` shapes ordering inside it. Both callbacks can be async.

## User-Facing Model Selection

For apps where end users should control which model runs, the pattern is:

1. Store the user's choice in user state (persists across sessions)
2. Expose a flow action that updates it
3. Read the choice in the generator's `model` function

Here's the flow-level setup:

```ts
const userStateSchema = z.object({
  selectedModel: z.string().default("anthropic/claude-sonnet-4.6"),
});

const setSelectedModel = handler({
  name: "set-selected-model",
  inputSchema: z.object({ selectedModel: z.string() }),
  userStateSchema,
  execute: async (input, ctx) => {
    await ctx.user!.patchState({ selectedModel: input.selectedModel });
  },
});

const kitchenSink = defineFlow({
  kind: "my-app",
  actions: {
    chat: { block: chatPipeline, inputSchema },
    setSelectedModel: { block: setSelectedModel, inputSchema: z.object({ selectedModel: z.string() }) },
  },
  user: { stateSchema: userStateSchema },
});
```

On the client side, call the action when the user picks a new model. The change takes effect on the next generation — no restart needed.

```ts
await session.sendAction("setSelectedModel", { selectedModel: "anthropic/claude-opus-4.7" });
```

Surface the current selection through the user scope's `client` block so the UI stays in sync:

```ts
user: {
  stateSchema: userStateSchema,
  client: {
    derived: {
      preferences: (ctx) => ({
        selectedModel: ctx.state.selectedModel,
      }),
    },
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

## Observable model identity

When a generator runs, the resolved model identity flows out on every emitted item (`message`, `reasoning`, `source`, `tool_output`, and the transient `tool_call_progress`) and on the generator's `block_trace`. The shape is the same in both places:

```ts
type ModelIdentity = {
  actual: string;       // the concrete model that ran
  requested?: string;   // present when different (intents, fallback, substitution)
  gateway?: string;     // present when a gateway routed the call
};
```

A chat UI can read this directly from any message item to render a per-message model badge:

```tsx
import { ModelBadge } from "@flow-state-dev/react";

<ModelBadge model={item.model} />
```

Items emitted by handlers do not carry `model`. See [streaming/items.md](../streaming/items.md#observable-model-identity) for the full surface, including `block_trace.model` semantics.

## What to Read Next

- [Server Setup](/docs/server/setup) — wiring the resolver into your app
- [Model Groups](/docs/advanced/model-groups) — deeper dive into presets, gateways, introspection
- [Custom Model Resolver](/docs/advanced/custom-model-resolver) — advanced resolver configuration
