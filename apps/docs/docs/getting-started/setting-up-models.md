---
sidebar_position: 2
---

# Setting Up Models

Generators need a model to call. The framework ships a model resolver that auto-detects providers from environment variables — for the common case you set one key and you're done.

This page covers the ten-minute path: pick a provider, set a key, run a flow. For deeper configuration (custom resolvers, fallback policy, prompt caching) see [Models](/docs/fundamentals/models) and [Custom Model Resolver](/docs/advanced/custom-model-resolver).

## Choose a provider

Pick whichever you already have an account for. Any one is enough.

| Provider | Environment variable | Install |
|----------|----------------------|---------|
| Anthropic | `ANTHROPIC_API_KEY` | `pnpm add @ai-sdk/anthropic` |
| OpenAI | `OPENAI_API_KEY` | `pnpm add @ai-sdk/openai` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `pnpm add @ai-sdk/google` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `pnpm add @ai-sdk/gateway` |
| OpenRouter | `OPENROUTER_API_KEY` | `pnpm add @openrouter/ai-sdk-provider` |

A gateway key (Vercel, OpenRouter) makes that gateway's whole catalog available — useful if you want to try several providers without managing each key separately. Direct keys take priority over gateways when both exist for the same provider.

## Set the key

Drop it in your shell, a `.env` file, or your hosting provider's secret store:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

If you're using Next.js, the standard `.env.local` works:

```bash title=".env.local"
ANTHROPIC_API_KEY=sk-ant-...
```

That's the whole configuration step for the default setup. The framework will detect the key when it boots.

## Name a model

The quick-start uses `model: "openai/gpt-5.4-mini"`. That's the whole configuration for one model: a provider name, a slash, a model ID.

```ts
const chat = generator({
  name: "chat",
  model: "anthropic/claude-sonnet-4.6",
  prompt: "...",
});
```

The format is `provider/model-id`, or `gateway/provider/model-id` for gateway routing (`"vercel/openai/gpt-5.4"`). Match the provider to the key you set, and the generator will run.

## Route across providers with an intent

A direct string pins you to one provider. If that provider is down, the call fails. An **intent** is a name you point at an ordered list of models instead:

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/engine";
import { createModelResolver } from "@flow-state-dev/core/models";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver({
    defaultModel: "openai/gpt-5.4-mini",
    intents: {
      utility: ["anthropic/claude-haiku-4.5", "openai/gpt-5.4-mini"],
      chat: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.5"],
    },
  }),
});

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

Point a generator at the name:

```ts
const chat = generator({ name: "chat", model: "intent/chat", /* ... */ });
```

The resolver picks the first candidate whose provider has a working key. If that model fails at runtime it retries, then moves to the next one. Your generator code doesn't change.

`defaultModel` is required once you declare any intent, and it has to be a `provider/model` string rather than another intent. Both rules are checked when the resolver is built, so a mistake surfaces at startup. It's what a generator gets when it names an intent you haven't configured, or when every candidate in the list is unreachable.

Intent names are yours to choose. [Models](/docs/fundamentals/models) lists six the framework documents (`utility`, `chat`, `plan`, `synthesize`, `code`, `reason`) and describes what each is for.

## Plug in a custom resolver

If you need to control provider construction yourself — for example, to inject a pre-built Anthropic client with custom HTTP middleware — pass the resolver explicit provider instances:

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createModelResolver } from "@flow-state-dev/core/models";

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // any custom config
});

const modelResolver = createModelResolver({
  providers: { anthropic },
});
```

For full control (custom retry policy, gateway instances, provider preference ordering) see [Custom Model Resolver](/docs/advanced/custom-model-resolver).

## Verify it works

The CLI is the fastest way to confirm your key is wired up:

```bash
fsdev run hello-chat chat -i '{"message": "Say hi."}'
```

You should see streaming text in your terminal. If it fails with a provider error, check that the env var is exported in the shell where you ran the command.

## What to read next

- **[Quick Start](/docs/getting-started/quick-start)** — Wire it into a React UI.
- **[Your First Flow](/docs/getting-started/your-first-flow)** — A walkthrough that explains each piece as you build.
- **[Models](/docs/fundamentals/models)** — Dynamic selection, retry policy, prompt caching, gateway details.
