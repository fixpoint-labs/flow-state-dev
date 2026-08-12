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

## Declare your intents

Blocks don't have to name a model. An **intent** is a role — `chat`, `utility`, `plan` — that you point at an ordered list of models once, in your runtime config. Blocks ask for the role; the config decides what fills it.

Declare the map on `createFlowState`, alongside your flows and stores:

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import chatFlow from "@/flows/hello-chat/flow";

export const flowstate = createFlowState({
  flows: { chatFlow },
  models: {
    default: "openai/gpt-5.4-mini",
    intents: {
      utility: ["anthropic/claude-haiku-4-5", "openai/gpt-5.4-mini"],
      chat: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.5"],
    },
  },
  stores: { default: { primary: inMemoryStores() } },
});
```

Then point a generator at the name:

```ts
const chat = generator({ name: "chat", model: "intent/chat", /* ... */ });
```

### How a candidate gets picked

The framework walks the list in order and takes the first candidate you can actually serve — one whose provider has a working key *and* an installed SDK package. Everything else is skipped. With only `ANTHROPIC_API_KEY` set, `intent/chat` above resolves to `claude-sonnet-4-6`; with only `OPENAI_API_KEY`, the Anthropic entry is skipped and it resolves to `gpt-5.5`. If a model fails at runtime, it retries, then moves to the next candidate. Your block code doesn't change in any of these cases.

`default` is what an intent falls back to when none of its candidates are reachable, and what a generator gets if it names an intent you never declared. Declaring any intent makes `default` required, and it has to name a model directly rather than another intent. Both rules are checked when the runtime is built, so a mistake surfaces at startup rather than mid-request.

### Why roles instead of model names

Two reasons, and the second is the one that compounds:

- **One place to change.** Moving your chat traffic to a new model is an edit to this map, not a search across every block that calls an LLM.
- **Role names outlive model names.** `intent/chat` reads the same in a year. A specific model ID is a moving target — it gets superseded, renamed, or retired, and every copy of it in your code and docs quietly goes stale.

Intent names are yours to choose. [Models](/docs/fundamentals/models) lists six the framework documents (`utility`, `chat`, `plan`, `synthesize`, `code`, `reason`) and describes what each is for.

## Name a model directly

You can also skip the indirection and name a model on the block:

```ts
const chat = generator({
  name: "chat",
  model: "anthropic/claude-sonnet-4-6",
  prompt: "...",
});
```

The format is `provider/model-id`, or `gateway/provider/model-id` for gateway routing (`"vercel/openai/gpt-5.4"`). Match the provider to the key you set, and the generator will run.

This is the right call when a block genuinely needs one specific model — an eval pinned to a known baseline, or a block that depends on a quirk of a particular model. It pins that block to one provider, so it fails if that provider is unreachable, and it's a string you'll have to revisit when the model is superseded.

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
