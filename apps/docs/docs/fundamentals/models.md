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

`defaultModel` is required when `intents` is non-empty. It must be a `provider/model` or `gateway/provider/model` string, never another `intent/*`. Both rules are enforced at construction: missing `defaultModel` throws `createModelResolver: defaultModel is required when intents are configured`, and an `intent/*` default throws `createModelResolver: defaultModel must not be an intent/* string`. If a generator references an intent name that isn't configured, the resolver logs a dev warning (`[flow-state-dev] Unknown or empty intent "<name>"; falling back to defaultModel.`) and uses `defaultModel`.

See [Custom Model Resolver](/docs/advanced/custom-model-resolver) for the full options reference.

### Worked examples

One generator per intent, wired to a realistic block shape. The point is to show what each intent looks like in practice; production blocks would add the usual prompt and schema details.

`utility` — a small classifier with a structured output:

```ts
const classifyIntent = generator({
  name: "classify-intent",
  model: "intent/utility",
  outputSchema: z.object({
    intent: z.enum(["greeting", "question", "complaint", "other"]),
    confidence: z.number(),
  }),
  prompt: "Classify the user's message. Be conservative on confidence.",
});
```

`chat` — a user-facing assistant turn:

```ts
const assistant = generator({
  name: "assistant",
  model: "intent/chat",
  prompt: "You are a helpful assistant. Keep replies under three sentences.",
});
```

`plan` — a planner producing a list of subtasks:

```ts
const planTasks = generator({
  name: "plan-tasks",
  model: "intent/plan",
  outputSchema: z.object({
    steps: z.array(z.object({
      title: z.string(),
      rationale: z.string(),
    })),
  }),
  prompt: "Break the goal into 3-6 concrete steps with a one-line rationale each.",
});
```

`synthesize` — combining prior outputs into a structured result. This intent doubles as the structured-JSON intent; apps should point it at JSON-reliable models (Sonnet/GPT-class), not the cheapest tier.

```ts
const synthesize = generator({
  name: "synthesize-findings",
  model: "intent/synthesize",
  outputSchema: z.object({
    summary: z.string(),
    keyPoints: z.array(z.string()),
  }),
  prompt: "Combine the research and analysis into a single structured report.",
});
```

`code` — a code-review generator returning structured findings:

```ts
const reviewCode = generator({
  name: "review-code",
  model: "intent/code",
  outputSchema: z.object({
    findings: z.array(z.object({
      severity: z.enum(["info", "warn", "error"]),
      file: z.string(),
      line: z.number(),
      message: z.string(),
    })),
  }),
  prompt: "Review the diff. Flag correctness issues, not style.",
});
```

`reason` — open-ended deliberation, free-form output:

```ts
const deliberate = generator({
  name: "deliberate",
  model: "intent/reason",
  prompt: "Work through the tradeoffs out loud. End with a recommendation.",
});
```

Examples use `intent/*` strings, not the underlying `provider/model`. That's the point of intents: blocks declare what they need; the resolver decides which model fills the role.

## Array Fallback

Don't need a named intent? Pass an array directly. The framework tries each model in order:

```ts
const chat = generator({
  name: "chat",
  model: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
  prompt: "You are a helpful assistant.",
});
```

This gives you the same retry-and-fallback behavior as named intents, without defining one. Useful for one-off blocks where defining an intent would be overkill.

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

The function can return any valid model value: a string, an intent string, an array, or a resolved model instance.

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

## Gateways and fallback

Gateways let you route provider calls through a single proxy. The resolver supports gateway-prefixed model strings explicitly, and also falls back to a configured gateway when a bare `provider/model` can't be loaded directly. This section covers both, plus the env-var detection rules that drive provider availability.

### Gateway model strings

A `gateway/provider/model` string routes the call through the named gateway:

```ts
const chat = generator({
  name: "chat",
  model: "vercel/openai/gpt-5.5",
  prompt: "You are a helpful assistant.",
});
```

```ts
const chat = generator({
  name: "chat",
  model: "openrouter/anthropic/claude-sonnet-4.6",
  prompt: "You are a helpful assistant.",
});
```

Gateway strings work anywhere a model string works: directly on a generator, inside `selectModel`, and inside intent candidate lists.

### Provider detection

The resolver figures out which providers are available by checking environment variables:

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

### Direct-then-gateway fallback

Bare `provider/model` strings (no gateway prefix) have a two-tier resolution:

1. **Direct first.** If the provider package is installed and a direct API key is configured, the resolver loads the direct provider and calls it.
2. **Gateway fallback.** If the direct package fails to load — not installed, can't be required in a bundled Next.js context, factory throws — the resolver walks configured gateways (explicit `options.gateways` entries first, then gateways auto-detected via env vars). The first gateway that covers this provider is used to route the call.

This is what makes `"openai/gpt-5.5"` keep working on Vercel even when `@ai-sdk/openai` isn't in the bundle, as long as `AI_GATEWAY_API_KEY` is set. The behavior is intentional, not a hidden quirk.

A worked resolution trace:

```ts
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core/models";

// App config
const resolver = createModelResolver({
  gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    utility: ["openai/gpt-5.5-nano", "anthropic/claude-haiku-4.5"],
    chat: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6"],
  },
});

// In Next.js production where @ai-sdk/openai isn't in the bundle:
generator({ name: "chat", model: "intent/chat", prompt: "..." });

// Resolution trace:
// 1. "intent/chat" → candidates: ["openai/gpt-5.5", "anthropic/claude-sonnet-4.6"]
// 2. Try "openai/gpt-5.5":
//      - Direct openai package: load fails (not in bundle)
//      - Gateway fallback: vercel gateway covers openai → use it
//      - Wraps as gateway-routed openai/gpt-5.5
// 3. Request succeeds.
//    item.model = { actual: "openai/gpt-5.5", gateway: "vercel" }
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

Every generator opts into prompt caching by default. For Anthropic models that means the adapter stamps `providerOptions.anthropic.cacheControl` on the last system message, so tools + system get cached together. OpenAI, Google, and DeepSeek cache implicitly and are left alone. OpenRouter is treated like Anthropic, since its API proxies `cache_control` through unchanged. If you're routing through the Vercel AI Gateway, the adapter sets `providerOptions.gateway.caching: 'auto'` instead and lets the gateway mark breakpoints for the underlying provider.

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

## Thinking and reasoning

Different providers expose "thinking" or "reasoning" in different shapes. The framework doesn't normalize them yet (see the note at the end of this section), but it does two things that make the surface usable today: it streams reasoning output as items automatically, and it passes `providerOptions` straight through to the underlying AI SDK provider.

### Streaming reasoning output

Whenever the resolved model produces reasoning chunks, the generator emits them as `ReasoningItem` items on the stream. No configuration needed. See [streaming/items.md](../streaming/items.md) for the item shape.

### The `providerOptions` escape hatch

To turn thinking on for Anthropic, set a budget on `providerOptions.anthropic.thinking`:

```ts
const reasoner = generator({
  name: "reasoner",
  model: "anthropic/claude-opus-4.7",
  providerOptions: { anthropic: { thinking: { budgetTokens: 10000 } } },
  prompt: "Work through the problem step by step.",
});
```

For OpenAI, use `reasoning_effort`:

```ts
const reasoner = generator({
  name: "reasoner",
  model: "openai/gpt-5.5",
  providerOptions: { openai: { reasoning_effort: "high" } },
  prompt: "Work through the problem step by step.",
});
```

For Google, use `thinkingConfig`:

```ts
const reasoner = generator({
  name: "reasoner",
  model: "google/gemini-3.1-pro",
  providerOptions: { google: { thinkingConfig: { thinkingBudget: 8000 } } },
  prompt: "Work through the problem step by step.",
});
```

The shapes above match what the AI SDK accepts for each provider. Verify against the SDK docs if you're targeting a newer model; the field names occasionally shift.

### Intent defaults for thinking

When you want every generator that resolves through `intent/plan` (or any thinking-shaped intent) to send a budget without spelling it out at each call site, attach it to the intent itself via `intentDefaults`:

```ts
const resolver = createModelResolver({
  defaultModel: "openai/gpt-5.4",
  intents: {
    plan: ["anthropic/claude-opus-4.7", "openai/gpt-5.5"],
  },
  intentDefaults: {
    plan: {
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
      },
    },
  },
});
```

When Anthropic wins resolution, the thinking budget is applied. When the fallback runs the OpenAI candidate instead, the `anthropic.*` block is dropped — only the resolved provider's keys travel with the request. A generator that sets its own `providerOptions` at the call site still wins on key collisions.

See [Custom Model Resolver](/docs/advanced/custom-model-resolver#intent-defaults) for the full configuration surface.

### Forward note: normalized reasoning levels

A normalized `reasoning: 'low' | 'medium' | 'high'` level — orthogonal to model choice, with per-model clamp behavior — is on the roadmap but not yet implemented. Until it ships, the `providerOptions` escape hatch above is the supported surface.

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

## Migration from presets

The `preset/*` API was removed as part of the intents rollout. Any `preset/*` string now throws at construction time with this mapping:

```
preset/fast, preset/tiny, preset/small  → intent/utility
preset/medium                           → intent/chat
preset/large                            → intent/code or intent/reason
preset/thinking-*                       → intent/reason or intent/plan
                                          with reasoning enabled (FIX-517)
```

The runtime error still references FIX-517 (normalized reasoning levels). That feature was deferred and never shipped; for callers migrating from `preset/thinking-*`, see [Thinking and reasoning](#thinking-and-reasoning) above for the `providerOptions` escape hatch that ships today.

## What to Read Next

- [Server Setup](/docs/server/setup) — wiring the resolver into your app
- [Custom Model Resolver](/docs/advanced/custom-model-resolver) — resolver options, intent defaults, gateway configuration, and provider introspection
