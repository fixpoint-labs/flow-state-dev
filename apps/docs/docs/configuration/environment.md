---
title: Environment variables
sidebar_position: 5
description: Provider keys, store profile, intent overrides, and debug flags.
---

# Environment variables

These are the variables the framework reads. App secrets you invent (`DATABASE_URL`, a bearer token your resolver checks) are yours; list them next to the code that reads them.

The CLI loads `.env.local` before it imports `fsdev.config.ts`, so keys are present when providers construct. See [App configuration](/docs/cli/configuration) for the load order and `--dotenv`.

## Provider keys

Set one key (and install that provider's SDK) to run a generator. A gateway key unlocks that gateway's catalog.

| Variable | Provider | Install |
|----------|----------|---------|
| `OPENAI_API_KEY` | OpenAI | `@ai-sdk/openai` |
| `ANTHROPIC_API_KEY` | Anthropic | `@ai-sdk/anthropic` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google | `@ai-sdk/google` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | `@ai-sdk/gateway` |
| `OPENROUTER_API_KEY` | OpenRouter | `@openrouter/ai-sdk-provider` |

Direct keys win over a gateway when both exist for the same provider. `createFlowState({ models: { keys } })` overrides the environment. Getting started: [Setting up models](/docs/getting-started/setting-up-models).

## Runtime

| Variable | What it does |
|----------|----------------|
| `FSD_ENV` | Store profile name. Wins over `defaultProfile`. Unknown names throw when the profile resolves. `NODE_ENV` is not read for this. |
| `FSD_QUIET_WARNINGS` | Set to `1` to suppress the construction-time logs that report applied intent overrides. `NODE_ENV=production` also suppresses them. |
| `FSD_DB_URL` | Default connection string for `vercelPostgresStores()`. Falls back to `DATABASE_URL`. |

## Model intents

These override `createModelResolver` / `models` at construction. They do not change a hardcoded `model: "openai/…"`.

| Variable | What it does |
|----------|----------------|
| `FSDEV_INTENT_<NAME>` | Replaces the candidate list for intent `<name>`. `<NAME>` is the intent uppercased with hyphens turned into underscores (`chat` → `FSDEV_INTENT_CHAT`, `my-custom` → `FSDEV_INTENT_MY_CUSTOM`). Comma-separated model ids. |
| `FSDEV_DEFAULT_MODEL` | Replaces `models.default` / `defaultModel`. |

Construction throws when two declared intents normalize to the same env name (`my-custom` and `my_custom`). An `FSDEV_INTENT_*` for an intent this resolver does not declare is warned and ignored. A typo in a declared intent's override is warned and the resolver falls back to `default`.

`FSDEV_DEFAULT_MODEL` with no declared intents is a configuration error: the override would have nothing to apply to.

```bash title=".env.local"
FSDEV_INTENT_CHAT=openai/gpt-5.4-mini
FSDEV_DEFAULT_MODEL=openai/gpt-5.4-mini
```

Full rules: [Models → Environment overrides](/docs/fundamentals/models).

## CLI and DevTool

`fsdev dev` sets the first two if you have not set them.

| Variable | What it does |
|----------|----------------|
| `FSDEV_DEBUG_ENDPOINTS` | `1` enables privileged debug routes (same as `debugEndpointsEnabled: true`). |
| `FSDEV_TRACING_LEVEL` | Observability verbosity for the CLI/dev router. `fsdev dev` defaults this to `verbose`. |
| `FSDEV_TRACE_OBSERVABILITY` | `true` / `false` toggles `block_trace` capture. Overrides the older `FSDEV_DEBUG_ITEMS` when both are set. |

`createFlowState({ devtool: { userId, bearerToken } })` is not an env var. Put secrets you want DevTool to send in that object, reading them from the environment yourself.

## See also

- [Runtime](./runtime) — `FSD_ENV` and `models`
- [Setting up models](/docs/getting-started/setting-up-models)
- [App configuration](/docs/cli/configuration) — `.env.local` walk-up and `--dotenv`
