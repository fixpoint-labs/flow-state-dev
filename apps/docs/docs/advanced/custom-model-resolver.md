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

Configure explicit keys, intents, and retry policy:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const resolver = createModelResolver({
  keys: {
    openai: process.env.MY_OPENAI_KEY,
    anthropic: process.env.MY_ANTHROPIC_KEY,
  },
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    utility: ["anthropic/claude-haiku-4.5", "openai/gpt-5.5-nano"],
  },
  retryPolicy: {
    maxAttemptsPerModel: 3,
  },
});
```

## Intents and defaultModel

Intents are named routing groups configured on the resolver. Generators reference them as `model: "intent/<name>"`. The resolver walks the candidate list, filters to providers the app has keys for, and falls back to `defaultModel` when nothing in the intent is reachable.

```ts
const resolver = createModelResolver({
  defaultModel: "anthropic/claude-sonnet-4.6",
  intents: {
    utility:   ["anthropic/claude-haiku-4.5", "openai/gpt-5.5-nano"],
    chat:      ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    plan:      ["anthropic/claude-opus-4.7"],
    synthesize:["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    code:      ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    reason:    ["anthropic/claude-opus-4.7"],
  },
});
```

`defaultModel` is required when `intents` is non-empty. It must parse as `provider/model` or `gateway/provider/model` — never another `intent/*`. The resolver validates these constraints at construction; misconfigured intents throw immediately rather than at first generator call.

Framework canonical intent names are documented in [Models](/docs/fundamentals/models#canonical-intent-names). Apps can add more — names match `^[a-zA-Z][a-zA-Z0-9_-]*$`.

Per-call provider preference flows through the resolver callable's optional third argument:

```ts
resolver("intent/chat", "block-name", { preferProvider: "openai" });
```

## Intent defaults

`intentDefaults` lets you attach configuration to an intent so generators that resolve through it don't have to repeat it at each call site. The most common use is `providerOptions` — Anthropic thinking budgets, OpenAI reasoning effort, prompt caching. Treat these as defaults, not overrides: the call site still wins.

### Shape

```ts
interface IntentDefaults {
  providerOptions?: Record<string, Record<string, unknown>>;
}
```

The shape is intentionally open. Future fields (`reasoning`, caching presets, max-token defaults) will land here without a breaking change.

### Provider filtering

When the resolved candidate's provider doesn't match a key in `providerOptions`, that key is dropped silently. If `intent/plan` ships with `providerOptions: { anthropic: { thinking: {...} } }` and the OpenAI fallback wins, the request goes out without the `anthropic` block — matching the underlying AI SDK's per-provider namespace behavior. Power users who want the silent drop surfaced can wrap the resolved model in their own middleware.

### Precedence

From lowest to highest priority, for a request that resolves through an intent:

1. **Intent default** — `intentDefaults[name].providerOptions[<resolvedProvider>]`.
2. **Generator-level `providerOptions`** — whatever the generator passes at call time. Wins on key collisions; non-conflicting nested keys (intent default sets `thinking.type`, call-site sets `thinking.budgetTokens`) survive together because the merge is deep.
3. **Prompt caching** — applied with set-if-absent semantics, so it never overwrites either of the above.

When an intent has no available candidate and falls through to `defaultModel`, no intent defaults apply: `defaultModel` has no intent context.

### Worked example

```ts
const resolver = createModelResolver({
  defaultModel: "openai/gpt-5.4",
  intents: {
    plan: ["anthropic/claude-opus-4.7", "openai/gpt-5.5"],
    utility: ["openai/gpt-5.4-mini"],
  },
  intentDefaults: {
    plan: {
      providerOptions: {
        anthropic: { thinking: { type: "enabled", budgetTokens: 16000 } },
      },
    },
    utility: {
      providerOptions: {
        openai: { reasoning: { effort: "low" } },
      },
    },
  },
});
```

A generator can still override at the call site:

```ts
generator({
  name: "deep-plan",
  model: "intent/plan",
  providerOptions: { anthropic: { thinking: { budgetTokens: 32000 } } },
  // ...
});
```

The merged Anthropic block is `{ thinking: { type: "enabled", budgetTokens: 32000 } }` — the intent's `type: "enabled"` survives, and the call site's `budgetTokens` wins on the collision.

### Validation

`createModelResolver` throws at construction if an `intentDefaults` key isn't also present in `intents`. Catches typos eagerly rather than at first call.

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
