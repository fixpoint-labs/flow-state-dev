---
title: Environment variables
type: reference
description: "The environment variables Flow State reads, what reads each, its default, and where a value can come from."
---

# Environment variables

Flow State reads a small set of environment variables so that secrets and per-machine settings stay out of your code. Model provider keys, the database connection string, the port a server listens on and the debugging switches all work this way. Set a variable in your shell or in a file, and the framework picks it up. You change no config to point an app at another key or another database.

This page lists the variables you set, with what reads each and its default. Names a platform sets for itself, such as `VERCEL`, are not listed. A **Detail** link points at the Reference page that holds the rules for that variable.

## Where values come from

`fsdev run`, `chat`, `dev`, `serve` and `benchmark` load environment files before they import `fsdev.config.ts`, so a config that builds a provider at import time sees the keys.

```bash title=".env.local"
OPENAI_API_KEY=sk-your-key
FSD_DB_URL="postgres://localhost:5432/research"
```

The first source to set a name wins. Highest first:

1. The shell's own environment. No file overwrites it.
2. Files named with `--dotenv <path>`, in the order given.
3. `.env.local` in the working directory, then in each parent folder up to the filesystem root.

| Rule | Detail |
| --- | --- |
| File name | Only `.env.local` is found by the walk-up. `.env` is not read. |
| Walk-up direction | It climbs only. A `.env.local` in a child folder is not found from a parent. In a monorepo, run `fsdev` from the app folder or pass `--dotenv apps/<app>/.env.local`. The walk-up skips a missing or unreadable `.env.local` without a message. |
| `--dotenv` | Repeatable. Path resolution, the error for a missing file, and the commands that load files (`fsdev block` loads none) are on [CLI](./cli.md). |
| What counts as set | A name the shell sets, even to the empty string, is set. A file value does not replace it. |
| Line forms | `KEY=VALUE`, `KEY="quoted"`, `KEY='quoted'`, `# comment` lines and empty lines. Lines split on the first `=`; a line with no `=` is skipped. Quotes are removed only when the value starts and ends with the same kind. There is no `$VAR` expansion, no escape handling, no multi-line value and no `export` prefix. A `#` after a value is part of the value. |
| When it is read | Once, when the process starts. Changing a variable or file means restarting. Under `fsdev dev --watch`, saving an env file it loaded restarts the child process. |
| Explicit options | A value passed in code wins over its variable: `createModelResolver({ keys })`, a connection string option, and the debug options below. |

Keep `.env.local` out of version control. Secrets your own app invents, such as a token a resolver checks, are yours to read.

## Provider keys

Which variable holds each provider's key:

| Variable | Provider | Package it needs |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI | `@ai-sdk/openai` |
| `ANTHROPIC_API_KEY` | Anthropic | `@ai-sdk/anthropic` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google | `@ai-sdk/google` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | `@ai-sdk/gateway` |
| `OPENROUTER_API_KEY` | OpenRouter | `@openrouter/ai-sdk-provider` |

None has a default. Setting the key is enough: `createModelResolver()` with no options detects providers from these variables, and no model config is required. The provider's package must be installed too.

To use `openai/gpt-6-luna` in one step and an Anthropic model in another, set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

A gateway key (`AI_GATEWAY_API_KEY` or `OPENROUTER_API_KEY`) makes every built-in provider (anthropic, openai, google) reachable through the gateway. With only `AI_GATEWAY_API_KEY` set, `openai/gpt-6-luna` resolves. Where a provider has both a direct key and a gateway key, the direct key wins.

The errors for a missing key or package are on [Models](./models.md).

### Other keys

| Variable | What reads it | Default |
| --- | --- | --- |
| `TAVILY_API_KEY` | the `search` tool, Tavily provider | none |
| `EXA_API_KEY` | the `search` tool, Exa provider | none |
| `PERPLEXITY_API_KEY` | the `search` tool, both `perplexity` and `perplexity-sonar` | none |
| `SERPER_API_KEY` | the `search` tool, Serper provider | none |
| `BRAVE_SEARCH_API_KEY` | the `search` tool, Brave provider | none |
| `PARALLEL_API_KEY` | the `search` tool, Parallel provider | none |
| `FIRECRAWL_API_KEY` | the `fetch` and `crawl` tools, Firecrawl provider | none |
| `JINA_API_KEY` | the `fetch` tool, Jina provider | none |
| `GITHUB_TOKEN` | `operatorGitHubToken()` in `@flow-state-dev/workforce` | the token `gh auth token` prints; none if `gh` has none |

Which provider a tool picks, and the error for a named provider with no key, are on [Tools](./tools.md). `GITHUB_TOKEN` is on [Workforce](./workforce.md). `OpenAIVoiceProvider` reads `OPENAI_API_KEY` when `apiKey` is omitted; see [Voice](./voice.md).

## Model overrides

`createModelResolver` reads these when it is called.

| Variable | What it does | Default |
| --- | --- | --- |
| `FSDEV_INTENT_<NAME>` | Replaces the models for one declared intent. `<NAME>` is the intent name in upper case with `-` turned into `_`: `chat` reads `FSDEV_INTENT_CHAT`, `my-custom` reads `FSDEV_INTENT_MY_CUSTOM`. | unset |
| `FSDEV_DEFAULT_MODEL` | Replaces the default model. | unset |

The value is one model string, `provider/model` or `name:model`. A comma-separated list is not a model string, so `createModelResolver` throws when it is called, with a message that starts `createModelResolver: FSDEV_INTENT_CHAT:`. An override for an intent the resolver does not declare is warned about once and ignored.

An override replaces what `models` or `createModelResolver` declare. A block that sets `model: "openai/gpt-6-luna"` itself never looks up an intent, so an override does not change it. The other construction errors and the warning an applied override logs are on [Models](./models.md).

## Runtime and store variables

| Variable | What reads it | Default | Detail |
| --- | --- | --- | --- |
| `FSD_ENV` | `createFlowState`, to pick the stores profile. A name no profile declares throws `FlowStateConfigError` at `ready()`. | unset | [Runtime](./runtime.md) |
| `FSD_DB_URL` | `postgresStores()` and `vercelPostgresStores()`. Order: the `connectionString` option, then `FSD_DB_URL`, then `DATABASE_URL`. | unset | [Stores](./stores.md) |
| `DATABASE_URL` | the same two, when `FSD_DB_URL` is unset. A platform's `DATABASE_URL` loses to a `FSD_DB_URL` you set. | unset | [Stores](./stores.md) |
| `FSD_QUIET_WARNINGS` | the once-per-process framework warnings that check it; boot diagnostics ignore it. Only the value `1` counts | unset | [Runtime](./runtime.md) |
| `NODE_ENV` | several, see below | unset | |
| `CRON_SECRET` | schedule dispatch, `vercelScheduler` | unset | [Schedules](./schedules.md) |
| `FSD_PUSH_SECRET` | `serve()` from `@flow-state-dev/node` | a random key per process | [HTTP API](./http-api.md) |
| `PORT` | `fsdev serve` and `serve()` | `3000` | [CLI](./cli.md) |
| `HOST` | `fsdev serve` | `0.0.0.0` | [CLI](./cli.md) |
| `LIVE_TAIL_LIVENESS_MS` | live-tail streams and session retention | `30000` | [Items](./items.md) |
| `LIVE_TAIL_POOL_MAX` | the Postgres live-tail pool | `10` | [Stores](./stores.md) |

With none of the three, both functions throw, for example `createPostgresStores: no connection string provided. Pass { connectionString } or set FSD_DB_URL / DATABASE_URL.` The throw happens when the pool is first built, not when you call the function.

**`NODE_ENV`.** `NODE_ENV` never picks a stores profile; `FSD_ENV` does. The framework sets no value of its own, and `fsdev dev` and `fsdev serve` do not assign one. The value `production` changes:

- Tracing: with `FSDEV_TRACE_OBSERVABILITY` unset, tracing is on unless `NODE_ENV` is `production`.
- State-change items: they are not persisted unless the flow sets `persistStateChanges`.
- Warnings: the development-only ones are silenced. Two print only under `production`: `createFlowState` with no `stores`, and the local cron on in-memory or filesystem stores.

The value `development` selects the 1000-request window of the in-memory and SQLite trace stores, against 50 otherwise. Defaults and rules are on [Items](./items.md) and [Runtime](./runtime.md).

## Debugging and tracing variables

| Variable | Accepted values | Default | What reads it |
| --- | --- | --- | --- |
| `FSDEV_DEBUG_ENDPOINTS` | `1` | off | the debug routes |
| `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` | `1` | off | the debug routes |
| `FSDEV_TRACING_LEVEL` | `verbose`, `normal`, `minimal` | follows `FSDEV_TRACE_OBSERVABILITY` | state snapshots in sequencers |
| `FSDEV_TRACE_OBSERVABILITY` | `true`, `1`, `false`, `0` | on unless `NODE_ENV=production` | block traces, state snapshots, resource-load records |
| `FSDEV_DEBUG_TOOLS` | `1` | off | tool calls |
| `FSDEV_DEBUG_EVENTS_RATE_MS` | a positive number of milliseconds | off | the request runner |

What the two debug switches allow, and the options that override them, are on [HTTP API](./http-api.md). What `fsdev dev` sets for them on a loopback or non-loopback bind is on [CLI](./cli.md). What each tracing level records and the precedence between the option and the variable are on [Items](./items.md).

**`FSDEV_TRACE_OBSERVABILITY`** accepts `true` or `1` (on) and `false` or `0` (off). Anything else, including `TRUE`, `yes` and the empty string, is ignored and the default applies. Set it before the process starts. What a completed block's `block_trace` item holds with it on and off is on [Items](./items.md). Whether turning it off changes what runs again after a restart or suspension is on [Durable execution](./durable-execution.md).

**`FSDEV_DEBUG_TOOLS=1`** writes `[fsd-tool] start <name>` and matching end lines to stderr for every tool call. **`FSDEV_DEBUG_EVENTS_RATE_MS=<ms>`** writes a periodic stderr summary of events per second, by type.

## Coding harness variables

A coding harness (Claude Code, Codex or Cursor) starts its agent as a child process. With `env` unset on the block, that child gets the server's whole `process.env`. Set `env: harnessEnv({ pass: CLAUDE_CODE_PASS })` (or `CODEX_PASS`, `CURSOR_PASS`) to hand it only the names on the list. The harness values the packages export apply their list for you. The base list is `PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR` and the proxy names `HTTPS_PROXY`, `https_proxy`, `HTTP_PROXY`, `http_proxy`, `ALL_PROXY`, `all_proxy`, `NO_PROXY` and `no_proxy`. How a run uses `harnessEnv({ pass })` is on [Harness runs](./harness-runs.md). Each exported list adds these names to the base:

| Harness | Names added to the base |
| --- | --- |
| Claude Code, `@flow-state-dev/claude-code` | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `NODE_EXTRA_CA_CERTS` |
| Codex, `@flow-state-dev/codex` | `CODEX_HOME`, `CODEX_API_KEY`, `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE` |
| Cursor, `@flow-state-dev/cursor` | `CURSOR_API_KEY`, `NODE_EXTRA_CA_CERTS` |

The model a worker talks with is a separate credential. Set a provider or gateway key from [Provider keys](#provider-keys) as well.
