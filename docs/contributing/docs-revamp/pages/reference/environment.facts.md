# Facts for Environment variables (R-15, reference)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, and one example that uses it (`examples/`, `labs/`). No spec, no `docs/internal/`, no `CLAUDE.md`, no PR or commit text. Where a record row of another page was carried here, the row's page is named, and the row was checked against the code. **[source]** marks a fact read from code where no test or exported doc comment pins it. **[test]** marks a fact a test pins. **[doc]** marks a fact the existing user docs state and the code agrees with. Nothing here was run against a deployed project.

Paths are from the repo root. Abbreviations:

- `pd` = `packages/core/src/models/providerDetection.ts`, `cmr` = `packages/core/src/models/createModelResolver.ts`, `ffm` = `packages/core/src/models/fallbackModel.ts`
- `tl` = `packages/core/src/helpers/tracing-level.ts`, `to` = `packages/core/src/helpers/trace-observability.ts`, `dep` = `packages/core/src/helpers/deprecation.ts`, `he` = `packages/core/src/helpers/harness-env.ts`
- `cfs` = `packages/engine/src/flowstate/createFlowState.ts`, `dbg` = `packages/engine/src/routes/debug-routes.ts`, `ll` = `packages/engine/src/streaming/live-tail-liveness.ts`, `ec` = `packages/engine/src/context/createExecutionContext.ts`
- `le` = `packages/fsdev/src/load-env.ts`, `rr` = `packages/fsdev/src/resolve-runtime.ts`, `dev` = `packages/fsdev/src/commands/dev.ts`, `fserve` = `packages/fsdev/src/commands/serve.ts`
- `nserve` = `packages/node/src/serve.ts`, `pg` = `packages/store-postgres/src/registry.ts`, `vst` = `packages/vercel/src/store.ts`, `vsch` = `packages/vercel/src/scheduler.ts`
- `ed` = `apps/docs/docs/configuration/environment.md` (the page today), `cf` = `apps/docs/docs/cli/configuration.md`, `mdoc` = `apps/docs/docs/fundamentals/models.md`
- `ks` = `apps/kitchen-sink`, `tm` = `labs/teammates`, `ccs` = `labs/claude-code-style`

## What the page is

A Reference page: tables and lookups, no narrative, no word budget. The plan names two things it must answer: every variable (what reads it, its default), and "Which variable holds each provider's key?". It carries the rows other pages moved here (section 9).

Page stores nothing, so the four stored-part questions do not apply. The one file involved, `.env.local`, is the user's own, in their project or a parent folder (`le:17,72-92`); the framework only reads it and never writes it.

Scope split for pass 3, which decides the layout. Sections 1 to 7 are variables the framework packages read. Section 8 is variables only the example apps read (`ks`, `tm`, `ccs`). Other pages' rows asked for them, they are true, and they are carried, but they are not framework surface and belong in a separate, clearly labelled table.

## 1. Where values come from

- `fsdev run`, `chat`, `dev` and `serve` load environment files before they import `fsdev.config.*`, so a config that builds providers at import time sees the keys. `rr:106-117` (loading runs, then `beforeConfigLoad`, then the config import at `rr:121`). **[source]** `[doc]` `cf` "Environment files".
- `fsdev benchmark` loads `--dotenv` files and the `.env.local` walk-up too (`packages/fsdev/src/commands/benchmark.ts:187-188`). **[source]**
- `fsdev block` has no `--dotenv` flag and loads no env file (no env reference in `packages/fsdev/src/commands/block.ts`). **[source]** A key it needs must already be in the shell.
- Only the filename `.env.local` is read. `.env` is not (`le:17`). **[source]**
- Precedence, highest first (`le:1-14`, `rr:106-114`): (1) the real shell environment, which no file overwrites; (2) files named with `--dotenv <path>`, in the order given; (3) `.env.local` in the working directory, then each parent up to the filesystem root. The first source to set a key wins. **[test]** `packages/fsdev/test/load-env.test.ts:49,105,113`. `[doc]` `cf`.
- "Set" means `process.env[key] !== undefined` (`le:62`). A key the shell sets to the empty string is set, so a file value does not replace it. **[source]**
- The walk-up only climbs. A `.env.local` in a child folder is not found from a parent (`le:72-92`). `[doc]` `cf`. In a monorepo, run `fsdev` from the app folder or pass `--dotenv apps/<app>/.env.local`.
- `--dotenv` is repeatable, resolved from the working directory, absolute paths allowed. A named file that does not exist stops the command with exit code 3 (`EXIT_CONFIG_ERROR`) and `--dotenv file not found: <absolute path>` (`le:113-129`). The walk-up skips a missing or unreadable `.env.local` silently (`le:72-92`). **[test]** `load-env.test.ts:94`. `[doc]` `cf`.
- The flag is `--dotenv`, not `--env-file`, because Node and tsx consume `--env-file` before the CLI sees it (`le:103-107`). `[doc]` `cf`.
- Accepted line forms (`le:20-51`): `KEY=VALUE`; `KEY="quoted"`; `KEY='quoted'`; `# comment` lines; empty lines. Details a reader can hit: the line and the key and value are trimmed; the line splits on the first `=`; a line with no `=` is skipped; surrounding quotes are removed only when the value starts and ends with the same kind; there is no `$VAR` expansion, no escape handling, no multi-line values and no `export` prefix (`export KEY=1` would define a key named `export KEY`); `#` after a value is part of the value. **[source]** The comments, quotes, empty-line and precedence cases are **[test]** `load-env.test.ts:29-67`.
- Each file is read once at start, and `process.env` is changed in this process only. A change to a variable or file means restarting the process. Under `fsdev dev --watch`, a save to an env file it loaded restarts the child (`dev:283-286` passes the loaded files to `reportWatchFiles`, `packages/fsdev/src/dev-watch.ts:233-237`). **[source]** Other reads are also made once, at the moment their object is built: `createModelResolver` reads keys and `FSDEV_*` overrides when it is called (`cmr:697-721`), and `harnessEnv` reads its source when the block is built, so "a variable set after that is not seen" (`he` doc on `harnessEnv`). **[source]**
- `createFlowState` and the resolver take explicit values that win over the environment: `createModelResolver({ keys })` is checked before `env[envVar]` (`pd:43-48`); `createModelResolver({ env })` replaces `process.env` as the source of `FSDEV_INTENT_*` and `FSDEV_DEFAULT_MODEL` (`cmr:95-100,697`), **[test]** `create-model-resolver-env-overrides.test.ts:255`. A debug option wins over its variable (`dbg:66-79`, section 4). A connection string option wins over `FSD_DB_URL` (`pg:127-131`).
- Secrets the app invents (a bearer token a resolver checks, a database password) are the app's. `[doc]` `ed`. The page does not claim to list every name the packages read: `fetch` and `crawl` read `FIRECRAWL_API_KEY` and `fetch` reads `JINA_API_KEY` (`packages/tools/src/fetch/resolver.ts:9-12`, `crawl/resolver.ts:10`; Jina is the one fetch provider that runs with no key, `fetch/resolver.ts:21`), `createFlowState` reads `VERCEL` to warn (`cfs:1421`), and the local-fs bash adapter passes named names to its commands (`packages/tools/src/bash/adapters/local-fs.ts:100`). The page lists `FIRECRAWL_API_KEY` and `JINA_API_KEY` and says platform-set names such as `VERCEL` are not listed. **[source]**

## 2. Provider keys (answers "Which variable holds each provider's key?")

The table, from `pd:8-18` and `cmr:126-133`:

| Variable | Provider | Package it needs | Cite |
|---|---|---|---|
| `OPENAI_API_KEY` | OpenAI | `@ai-sdk/openai` | `pd:11`, `cmr:127` |
| `ANTHROPIC_API_KEY` | Anthropic | `@ai-sdk/anthropic` | `pd:10`, `cmr:126` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google | `@ai-sdk/google` | `pd:12`, `cmr:128` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway | `@ai-sdk/gateway` | `pd:16`, `cmr:132` |
| `OPENROUTER_API_KEY` | OpenRouter | `@openrouter/ai-sdk-provider` | `pd:17`, `cmr:133` |

`[doc]` `ed` "Provider keys" and `mdoc:405-420` give the same five rows. Behavior a reader can depend on:

- Setting the key in the environment is enough. `createModelResolver()` with no options detects providers from the variables (`pd:34-50,106-123`, `mdoc:405-425`); no model config is required. **[test]** `create-model-resolver-loading.test.ts` builds resolvers from `keys` alone. `examples/hello-chat/README.md:22-25` sets only `OPENAI_API_KEY` for `openai/gpt-6-luna`.
- The provider's package must also be installed. A key with no installed package, and no gateway to fall through to, throws `No provider available for "<provider>". Tried: direct package (not installed), gateways (none configured for this provider). Install the provider package, set its API key, or configure a gateway (e.g. AI_GATEWAY_API_KEY).` (`cmr:1224-1231`). **[test]** `create-model-resolver-loading.test.ts:46-53`, `create-model-resolver-intents.test.ts:278-286`. A package that is installed but failed to load reads `direct package (failed to load)` in the same message (`cmr:1225`).
- That error is thrown when the model string is resolved, `resolver("openai/…")`, not when `createModelResolver` is called. **[test]** `create-model-resolver-intents.test.ts:278-286` builds the resolver without error and expects the throw from the call. A generator whose model has no key therefore fails on the call that resolves it, not at process start. **[source]** `cmr:1119,1353`.
- A gateway key makes every built-in provider (`anthropic`, `openai`, `google`) available through that gateway (`pd:62-123`; `providerNames` at `packages/core/src/models/types.ts:5`). Gateways are the two types `vercel` and `openrouter` (`types.ts:12`). `[doc]` `ed`, `mdoc:405-420`.
- A direct key wins over a gateway for the same provider (`pd:6-8,41-50`: phase 1 sets `source: "key"` and later phases only fill providers not yet available). `[doc]` `ed`, `mdoc:405-420`.
- A bare `provider/model` string whose direct package is missing falls through to a gateway when one has a key (`cmr:735-760,860-905`). `[doc]` `mdoc` "Direct-then-gateway fallback". A `name:model` string never falls back to a gateway (`cmr:975-988`).
- A model group with no usable model names the gateway keys: `Configure API keys for at least one provider in the group, or set AI_GATEWAY_API_KEY / OPENROUTER_API_KEY for gateway access.` (`ffm:313-318`). **[source]**
- Evaluation models are routed through the AI Gateway only: a `typesafe-ai/...` string always resolves through a gateway, so it needs `AI_GATEWAY_API_KEY` (`cmr:1215-1221`, `mdoc:485`). Out of scope for this page beyond one row, if the page wants it.
- Voice. `OpenAIVoiceProvider` reads `OPENAI_API_KEY` when `apiKey` is omitted, through the OpenAI SDK's default (`packages/voice-openai/src/openai-voice-provider.ts:26-31`). No default. `[doc]` `apps/docs/docs/advanced/voice.md` passes `apiKey: process.env.OPENAI_API_KEY` explicitly and `ELEVENLABS_API_KEY` for ElevenLabs, which that page's own example reads (not a framework read).
- Search keys. The `search` tool in `@flow-state-dev/tools` reads one key per provider (`packages/tools/src/search/resolver.ts:20-26`, read through `detectApiKey`, `packages/tools/src/_internal/env.ts`): `TAVILY_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY` (used for both `perplexity` and `perplexity-sonar`), `SERPER_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PARALLEL_API_KEY`. With no `provider` named, it picks the first keyed provider in the order parallel, tavily, exa, perplexity, serper, brave, perplexity-sonar that supports the requested tier (`resolver.ts:9-17,46-60`). A named `provider` with no key throws `Search provider "<name>" requested but no API key found. Set <VAR> or pass it via config.keys.<name>` (`resolver.ts:31-38`). With no key set the tool throws when it runs. **[test]** `[doc]` `apps/docs/docs/tools/search.md:25-45`. No default.
- The `tm` README names `BRAVE_API_KEY` for Brave (`labs/teammates/README.md:223`). The code reads `BRAVE_SEARCH_API_KEY`. The code wins. See "Contradictions found".

## 3. Model intent overrides

`createModelResolver` scans its environment source for these on construction (`cmr:543-544,580-632`):

| Variable | What it does | Cite |
|---|---|---|
| `FSDEV_INTENT_<NAME>` | Replaces the candidate list for the declared intent whose canonical name is `<NAME>`. | `cmr:543,621-632` |
| `FSDEV_DEFAULT_MODEL` | Replaces `defaultModel` / `models.default`. | `cmr:544,611-615` |

- `<NAME>` is the intent name uppercased with `-` turned into `_`: `chat` gives `FSDEV_INTENT_CHAT`, `my-custom` gives `FSDEV_INTENT_MY_CUSTOM` (`pd:161-163`). **[test]** `create-model-resolver-env-overrides.test.ts:243`. `[doc]` `ed`.
- The value is one `provider/model` or `name:model` string. A value that is empty or whitespace, an `intent/...` string, or unparseable throws at construction, with the message prefixed `createModelResolver: <VARIABLE>:` (`cmr:553-577`). **[test]** `create-model-resolver-env-overrides.test.ts:82-125`. The existing page says "comma-separated lists are not supported"; a list is not one valid model string, so it is rejected by the same parse. **[source]**
- Two declared intents that canonicalise to the same name (`my-custom`, `my_custom`) throw at construction: `intent names "…" and "…" both map to environment variable FSDEV_INTENT_<NAME>, which is ambiguous. Rename one to avoid collisions for env-var overrides.` (`cmr:505-514`). **[test]** `:56`.
- An `FSDEV_INTENT_<NAME>` for an intent this resolver does not declare is warned once and ignored, not an error, so one environment can serve several apps (`cmr:613-632`). **[test]** `:136,349`. The same holds when no intents are declared (`:153`).
- `FSDEV_DEFAULT_MODEL` applies whether or not intents are declared. A malformed value still throws (`:172`); a valid one with no intents does not (`:163`). A host that resolves no model never reads it. `cmr:585-590`.
- Overrides replace what `models` / `createModelResolver` declare. They do not change a hardcoded `model: "openai/..."` string on a block (`[doc]` `ed`). **[source]** A literal model string never goes through intent lookup.
- An applied override logs one warning per variable at construction. The warning is suppressed by `NODE_ENV=production` or `FSD_QUIET_WARNINGS=1`, and the override still applies (**[test]** `create-model-resolver-env-overrides.test.ts:329,369,401,415`). Warnings are once per process (`:386`).
- `FSDEV_DEFAULT_MODEL` is also named in the error for an intent that cannot be resolved: `... or set the FSDEV_DEFAULT_MODEL environment variable.` (`packages/core/src/errors/unresolved-intent-error.ts:28`).
- Env source: `createModelResolver({ env })` replaces `process.env` for these two variables only (provider keys still come from `keys` or `process.env`: `pd:34-50` takes its own `env` argument, and `cmr:883-892,958` read `process.env`). `cmr:95-100,697`. **[source]** Pass 3 should not claim `env` redirects provider keys.

## 4. Runtime and store variables

| Variable | What reads it | Default | Cite |
|---|---|---|---|
| `FSD_ENV` | `createFlowState`, to pick the stores profile | unset | `cfs:975-990` |
| `FSD_DB_URL` | `postgresStores()`, `vercelPostgresStores()` | unset | `pg:127-131`, `vst:73-77` |
| `DATABASE_URL` | the same two, when `FSD_DB_URL` is unset | unset | `pg:127-131`, `vst:73-77` |
| `FSD_QUIET_WARNINGS` | the once-per-process warnings from `warnOnce` and `warnOnceDev`; not boot diagnostics guarded by `firstInProcess` | unset | `dep:19-40`, `packages/core/src/helpers/once-per-process.ts:25-27` |
| `NODE_ENV` | several, see below | unset | below |
| `CRON_SECRET` | schedule dispatch, `vercelScheduler` | unset | `cfs:1345-1356`, `vsch:55` |
| `FSD_PUSH_SECRET` | `serve()` from `@flow-state-dev/node` | a random key per process | `nserve:117,362-364` |
| `PORT` | `fsdev serve`, `serve()` | `3000` | below |
| `HOST` | `fsdev serve` | `0.0.0.0` | `fserve:100-102` |
| `LIVE_TAIL_LIVENESS_MS` | live-tail stream and retention | `30000` | `ll:9-17` |
| `LIVE_TAIL_POOL_MAX` | Postgres live-tail pool | `10` | `pg:28-34,189-200` |

`FSD_ENV`
- Names the stores profile. It wins over `defaultProfile`, which wins over the first declared profile (`cfs:975-1000`; `packages/engine/src/flowstate/types.ts:209-216`). **[test]** `createFlowState.test.ts:101,114`.
- A name that is not a declared profile throws `FlowStateConfigError`: `FSD_ENV="<name>" but no profile "<name>" is declared. Declared profiles: a, b` (`cfs:978-986`; `types.ts:580`). It throws when the runtime is built, at `ready()`, not at import. **[test]** `createFlowState.test.ts:139-145`. A single-profile `stores` also refuses an `FSD_ENV` naming another profile (`stores-shorthand.test.ts:157`).
- An empty `FSD_ENV` counts as unset (`cfs:977`). `NODE_ENV` is not read to choose a profile (`types.ts:215-216`). `[doc]` `ed`.

`FSD_DB_URL` and `DATABASE_URL` (carried from persistence and Vercel deploy rows)
- Both stores take `options.connectionString` first, then `FSD_DB_URL`, then `DATABASE_URL` (`pg:127-131`, `vst:73-77`). The order is fixed. The default is none. `[doc]` `packages/vercel/README.md:66`, `packages/store-postgres/README.md:49`. The existing page names only `vercelPostgresStores()`; `postgresStores()` reads them too.
- With none and no `poolOptions.host`, `postgresStores` throws `createPostgresStores: no connection string provided. Pass { connectionString } or set FSD_DB_URL / DATABASE_URL.` (`pg:147-152`). `vercelPostgresStores` throws `vercelPostgresStores: no connection string. Set FSD_DB_URL / DATABASE_URL or pass { connectionString }.` for an unset or empty string (`vst:77-82`). Both throw when the pool is built (first use), not when the function is called. **[source]** `vst:70-83` is inside `build()`.
- The live-tail pool: `postgresStores` opens a second pool from the same connection string for change notifications. Its size is `LIVE_TAIL_POOL_MAX` (default 10); an unset, empty, non-numeric or non-positive value gives 10 (`pg:28-34,189-200`). **[source]**
- `examples/knowledge-base/fsdev.config.ts:22` uses `FSD_DB_URL ?? DATABASE_URL` set as the test for choosing the `prod` profile: an example, not a framework read.

`FSD_QUIET_WARNINGS`
- `1` silences the warnings printed through `warnOnceDev` and `warnOnce` (`dep:19-40`). Boot diagnostics guarded by `firstInProcess` do not honour it (`once-per-process.ts:25-27`). **[test]** `packages/core/test/deprecation.test.ts`. Any other value, including `true`, does nothing.
- `NODE_ENV=production` silences `warnOnceDev` warnings only. `warnOnce` warnings still print in production unless `FSD_QUIET_WARNINGS=1`, for example the one printed when `createFlowState` has no `stores` and `NODE_ENV=production` (`dep:26-32`; `cfs:1035-1042`) and the local cron on in-memory stores (`cfs:1410-1420`) and on Vercel (`cfs:1421-1426`). **[source]** The existing page says `FSD_QUIET_WARNINGS` suppresses the logs that report applied intent overrides, which is one case of the above.

`NODE_ENV`. The framework reads it in several places; the reader-visible effects:
- `fsdev` and the framework never read it to choose a stores profile (see `FSD_ENV`).
- `FSDEV_TRACE_OBSERVABILITY` unset: tracing is on unless `NODE_ENV === "production"` (`to:14-19`). **[test]** `block-trace-lifecycle.test.ts`, `resume-replay-traces-off.test.ts`.
- Trace store window when no `maxRequests` is passed: 1000 requests with `NODE_ENV=development`, 50 otherwise, for the engine's in-memory and SQLite trace stores (`packages/engine/src/stores/index.ts:181-185`, `packages/store-sqlite/src/registry.ts:30-32`). **[source]**
- State-change items are persisted by default unless `NODE_ENV=production`, in which case a flow must set `persistStateChanges` (`packages/engine/src/context/scope-emit.ts:17-28`). **[source]** The page states it in the `NODE_ENV` list.
- Under `production` only: the `createFlowState` no-`stores` warning (`cfs:1035`) and the local-cron unelected-lease warning (`cfs:1410-1420`). The dev-only warnings in `cache-tool-call` (`ttl: 0`, `packages/core/src/blocks/internal/cache-tool-call.ts:208`) and `resource-template` (inert keys, role-tagged sections, `resource-template.ts:163-179`) are silenced under `production`. **[source]**
- Production warnings: see `FSD_QUIET_WARNINGS`.
- `NODE_ENV` has no default the framework sets. `fsdev dev` and `fsdev serve` do not assign it (no assignment in `dev`, `fserve`). **[source]**

`CRON_SECRET`
- The bearer secret for the schedule dispatch endpoint. `vercelScheduler`'s `route` requires `Authorization: Bearer <secret>`, with `secret` from `options.secret`, else `CRON_SECRET`, read on every request (`vsch:23-27,55-56`). An empty or unset secret rejects every call with 401 (`vsch:75-80`). **[source]**
- When the app ticks its own schedules, the dispatch request carries `secretOverride`, else `CRON_SECRET`, as its bearer (`cfs:1345-1356`; `packages/engine/src/flowstate/types.ts:126-134`). **[source]** `[doc]` the Vercel deploy page's own fact sheet is the place for the Vercel Cron wiring.

`FSD_PUSH_SECRET`
- The key push tickets are signed with. `serve()` uses `pushSecret` if given, else a non-empty `FSD_PUSH_SECRET`, else a random key for this process (`nserve:117-118,362-364`). Set the same value on every process behind one address, or a ticket minted on one is rejected by another. `[doc]` `packages/node/README.md:68,179`.

`PORT` and `HOST`
- `@flow-state-dev/node` `serve()`: `options.port`, else `PORT`, else `3000`. A non-empty non-numeric `PORT` falls through to `3000` (`nserve:51,167-175`). **[source]**
- `fsdev serve`: `--port`, else `PORT`, else `3000`. Unlike `serve()`, a `PORT` or `--port` that is not all digits in 0 to 65535 stops the command: `Invalid port: <value>`, exit code 3 (`fserve:70-79`). An empty `PORT` counts as unset. **[source]**
- `fsdev serve` host: `--host`, else `HOST`, else `0.0.0.0`; an empty `HOST` counts as unset (`fserve:42,100-103`). `serve()` from `node` reads no `HOST`: `options.host`, else `0.0.0.0` (`nserve:145,192`). **[source]**
- A port already in use fails the listen at start. `fsdev serve` reports `Failed to start server on <host>:<port>: <reason>` with exit code 3 (`fserve:113-122`). **[source]**
- `fsdev dev` reads neither: its host and port come from `--host` (default loopback) and `--port` (`dev:121-140`). **[source]**
- Next.js and other hosts read `PORT` themselves; the framework does not. A hand-written server file that calls `serve()` gets the variable through `serve()`'s own read, so "PORT is read by the server file, not the framework" is untrue (see section 9).

`LIVE_TAIL_LIVENESS_MS`
- How long a live-tail stream waits in silence before it gives up on a request, in milliseconds. Default `30000`. An unset, empty, non-numeric or non-positive value gives the default (`ll:9-17`). Session retention waits twice this value before it evicts a finished request (`packages/engine/src/execution/retention.ts:66`). **[source]**

## 5. Debugging and tracing variables

| Variable | Accepted values | Default | What reads it | Cite |
|---|---|---|---|---|
| `FSDEV_DEBUG_ENDPOINTS` | `1` | off | the debug routes | `dbg:68-71` |
| `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` | `1` | off | the debug routes | `dbg:75-78` |
| `FSDEV_TRACING_LEVEL` | `verbose`, `normal`, `minimal` | from `FSDEV_TRACE_OBSERVABILITY` | state snapshots in sequencers | `tl:17-39` |
| `FSDEV_TRACE_OBSERVABILITY` | `true`, `1`, `false`, `0` | on unless `NODE_ENV=production` | block traces, state snapshots, resource-load records | `to:7-19` |
| `FSDEV_DEBUG_TOOLS` | `1` | off | tool calls | `packages/core/src/blocks/internal/tool-executor.ts:121-128` |
| `FSDEV_DEBUG_EVENTS_RATE_MS` | a positive number of ms | off | the request runner | `packages/engine/src/execution/runAction.ts:1222-1229` |

`FSDEV_DEBUG_ENDPOINTS` and `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL`
- Read when `createFlowApiRouter` / `createFlowState` builds its debug config: the variable counts only when it is exactly `1`. `true`, `yes` or anything else is off (`dbg:66-79`). `[doc]` `ed`.
- An explicit option wins over the variable, including `false`: `debugEndpointsEnabled`, `debugAllowAnonymousLocal` (`dbg:66-79`). **[source]** `[doc]` `ed`.
- `FSDEV_DEBUG_ENDPOINTS=1` turns on the privileged debug routes. `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL=1` lets those routes accept requests with no `Origin` header (curl, a script, a same-origin browser GET); without it they get 403. Only set it for a server bound to loopback. `[doc]` `ed`; the rule of the gate is `dbg:84-` (`assertDebugAllowed`).
- Defaults by host:
  - Engine with neither set, and `fsdev serve`: both off. `fsdev serve` sets nothing (no assignment in `fserve`). **[source]** `[doc]` `ed`.
  - `fsdev dev` on a loopback bind with a config loaded: sets `FSDEV_DEBUG_ENDPOINTS` to `1`, `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` to `1` and `FSDEV_TRACING_LEVEL` to `verbose`, each only if the shell or an env file has not already set it (`??=`) (`dev:295-303`). **[test]** `packages/fsdev/test/dev-command.test.ts:43-48`.
  - `fsdev dev` with `--no-config` on a loopback bind: sets none of them (the `else if (options.config !== false)` branch, `dev:295`). **[source]** Corrected: with `--no-config` on a non-loopback `--host`, the first two are still forced to `0` (`dev:290-294` is not gated by the config flag). The page no longer carries this table; it points to the CLI page.
  - `fsdev dev` on a non-loopback `--host`: forces `FSDEV_DEBUG_ENDPOINTS` and `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` to `0`, overriding a shell or file value, and leaves `FSDEV_TRACING_LEVEL` alone (`dev:288-294`). **[source]** The existing page's "`fsdev dev` sets the first three if you have not set them" omits both limits.

`FSDEV_TRACING_LEVEL`
- `verbose`: every state snapshot, including each step. `normal`: only block-boundary snapshots (sequencer start and end). `minimal`: no observability snapshots. Durable checkpoints are written at every level (`tl:1-12`; `packages/core/src/blocks/sequencer.ts:307-316`). **[test]** `packages/engine/test/sequencer-tracing-level.test.ts:82-100`.
- Order of precedence: a level passed in code (`createFlowApiRouter({ tracingLevel })`, `tl:26-33`), then this variable, then a default: `verbose` when `FSDEV_TRACE_OBSERVABILITY` resolves to on, `minimal` when off (`tl:35-39`). An unrecognised value is ignored and the default applies (`tl:17-24`). **[source]**
- `fsdev dev` sets it to `verbose` when a config is loaded on loopback (above).

`FSDEV_TRACE_OBSERVABILITY` (carried from the items, durable-execution and debug-a-run rows)
- Accepted: `true` or `1` (on), `false` or `0` (off). Anything else, including `TRUE`, `yes` and the empty string, is ignored and the default applies (`to:7-19`). The existing page lists only `true` / `false`. **[source]** **[test]** the engine tests set `"true"` and `"false"`.
- Default: on unless `NODE_ENV === "production"`. The framework sets no `NODE_ENV` itself, so a process with `NODE_ENV` unset has it on (`to:14-19`). **[source]**
- Read on every check, not once at start (`to:14-19` is a function called at each use; the tests toggle it between runs, `resume-replay-traces-off.test.ts:135-141`). Pass 3 should still say "restart after changing it" because a running process's variable cannot change from outside.
- Effect on: with it on, each block's `block_trace` item opens with the block's input, then gains its generator details, resource loads and declared resources, and ends with the output; resource-load recording and per-read recording run (`ec:1287-1330,3835-3850`; `packages/engine/src/context/resource-registry.ts:1536,2024`). **[source]**
- With it off, each completed block still writes one lean `block_trace` record: its identity, its output, `rescued`, its model usage (`modelUsage`), `harnessSpend`, `completedAt`, `duration` and `lean: true` (`ec:3938-3954`). Corrected: the record carries spend and timing, so spend survives a continuation after the process died. A lean record has no `input`, `generator`, `resourceLoads` or `declaredResources`. A failed, suspended or transient block gets no record (`ec:3835-3850`). **[test]** `resume-replay-traces-off.test.ts:151-175`.
- Because the lean record is what resume reads, a block that finished is not run again after a restart or a suspension, with traces off: a loop that stops twice runs each pass once, and a generator's model is not called again. **[test]** `resume-replay-traces-off.test.ts:134-180,181-243`. For crash recovery through `/continue`, the same holds when a durability provider is configured; with traces off and no durability provider, a block that finished before the crash runs again. **[test]** `resume-replay-traces-off.test.ts:244-300` (the `provider: false, ran: "false"` cases expect 2 runs). The `durable-execution` page owns this row; here it is a pointer.
- The state-snapshot level is separate (`FSDEV_TRACING_LEVEL`), but with `FSDEV_TRACING_LEVEL` unset, off gives `minimal` (above).

`FSDEV_DEBUG_TOOLS`, `FSDEV_DEBUG_EVENTS_RATE_MS`. Developer diagnostics, not mentioned on any page or record. `FSDEV_DEBUG_TOOLS=1` writes `[fsd-tool] start <name>` lines (and matching end lines) to stderr for every tool call. `FSDEV_DEBUG_EVENTS_RATE_MS=<ms>` writes a periodic stderr summary of events per second by type. **[source]** Left for pass 3 to include as one-line rows or drop; neither has a test or doc.

## 6. Coding harness variables

A coding harness (Claude Code, Codex, Cursor) starts its agent as a child process. With `env` unset on the block, that child gets the server's whole `process.env` (`packages/claude-code/src/sdk/agent.ts:358-362`; `codex/src/env-pass.ts:5-8`; `cursor/src/env-pass.ts:5-9`). The pass-list applies only through `env: harnessEnv({ pass: CLAUDE_CODE_PASS })` (or `CODEX_PASS`, `CURSOR_PASS`); the exported harness values in the three packages set it themselves (`kit.ts:44`, `codex/src/harness.ts:29`, `cursor/src/harness.ts:26`). (`he` header; `packages/claude-code/src/sdk/env-pass.ts:1-24`.)

- Every pass-list starts from `HARNESS_BASE_PASS`: `PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, and `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` each in upper and lower case (`he:22-36`). No credential is in it. A name that is unset is left out, not passed empty (`harnessEnv` doc). **[source]**

| Harness | Pass-list | Names added to the base | Sign-in it needs | Cite |
|---|---|---|---|---|
| Claude Code | `CLAUDE_CODE_PASS` | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `NODE_EXTRA_CA_CERTS` | `claude` signed in, or `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | `claude-code/src/sdk/env-pass.ts:24`, `account-probe.ts:97-111` |
| Codex | `CODEX_PASS` | `CODEX_HOME`, `CODEX_API_KEY`, `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE` | `codex login`, or `CODEX_API_KEY` | `codex/src/env-pass.ts:22`, `account-probe.ts:30,65` |
| Cursor | `CURSOR_PASS` | `CURSOR_API_KEY`, `NODE_EXTRA_CA_CERTS` | a stored Cursor sign-in, or `CURSOR_API_KEY` | `cursor/src/env-pass.ts:22`, `sign-in.ts:20-32` |

- The pass-list is applied by each package's harness value: `claudeCodeHarness` (`packages/claude-code/src/sdk/kit.ts:43-64`), the Codex harness (`packages/codex/src/harness.ts:29,47`), the Cursor harness (`packages/cursor/src/harness.ts:26,46`). A host that builds its own harness passes `harnessEnv({ pass: [...] })` itself; it filters what a run starts with and is not a security boundary (the doc comment on each `*_PASS`, since a command run as the server's OS user can still read the server's environment). **[source]**
- `CLAUDE_CODE_PASS` is read from `process.env` when the harness block is built (`he`). The credential check runs over the same filtered environment, so a key outside the pass-list does not count toward the sign-in. **[source]** `kit.ts:58-59`, `codex/src/harness.ts:45`.
- Claude Code sign-in: `CLAUDE_CODE_SIGN_IN_REMEDY` is "Sign in with `claude`, or set ANTHROPIC_API_KEY" (`account-probe.ts:111`); the probe reports an account when it finds an API-key source, a token source (which covers `CLAUDE_CODE_OAUTH_TOKEN`), an email or a subscription (`account-probe.ts:97-108`). **[source]** Both variables are on the pass-list.
- Codex: a non-empty `CODEX_API_KEY` is an account without asking the CLI (`account-probe.ts:65`); otherwise it asks `codex login status`. `CODEX_HOME` is where its sign-in and threads live, so a thread resumes only under the same home (`env-pass.ts` doc).
- Cursor: a non-empty `CURSOR_API_KEY` counts as a key; otherwise a stored login counts. Neither gives `no CURSOR_API_KEY in the run's environment and no stored login` (`sign-in.ts:20-32`). The remedy reads "Set CURSOR_API_KEY, or sign in to Cursor" (`sign-in.ts:36`). `HOME` is where Cursor keeps its agents and its stored login (`env-pass.ts` doc).
- The model the workers talk with is a separate credential: a provider or gateway key from section 2. `ccs` runs its model through the AI Gateway (`labs/claude-code-style/README.md:86`), and `tm` says its model needs `AI_GATEWAY_API_KEY` (`labs/teammates/README.md:220`). Whether a lab uses the gateway is the lab's choice; it is not framework behavior.
- Other names the harness packages read: `MOAT_RUNTIME` is read and set for sandbox commands by the bash tool's Moat adapter (`packages/tools/src/bash/adapters/moat.ts:625-642`); `GITHUB_TOKEN` is read by `operatorGitHubToken(env = process.env)` in `@flow-state-dev/workforce`: trimmed, ignored if empty, then the output of `gh auth token` (10 s timeout); `undefined` only if neither yields a token, so the default is the signed-in `gh` token (`packages/workforce/src/service-flows/github/operator.ts:20-33`). **[source]** `GITHUB_TOKEN` is also in the `tm` and `ccs` tables below.

## 7. Other framework variables

- `WATCH_REPORT_DEPENDENCIES` and `FSDEV_DEV_WATCH_CHILD` (`packages/fsdev/src/dev-watch.ts:33,173,235,244`): set by `fsdev dev --watch` on the child it spawns. Not for users to set. Dropped (section 9).

## 8. Variables only the example apps read

Carried because other pages' rows asked for them. Each is read by an app's own config file, not by a package, and each default is the app's. The page should keep them in a table of its own with the app's name on each row.

**Teammates (`labs/teammates`)**, read by `tm/fsdev.config.mts:19-35`, defaults from the same lines and `labs/teammates/README.md:205-216`:

| Variable | What it sets | Default | Cite |
|---|---|---|---|
| `TEAMMATES_MODEL` | the model all three workers answer on | `openai/gpt-6-luna` | `fsdev.config.mts:24` |
| `TEAMMATES_WORKDIR` | the working folder, a git checkout | the root of this repository | `fsdev.config.mts:26`, `host.mts:42-50` |
| `TEAMMATES_HARNESS` | the harness a coding worker whose file names none runs on: `claude-code`, `codex` or `cursor` | `cursor` | `fsdev.config.mts:33`, README `:210` |
| `TEAMMATES_STORE` | the SQLite file | `.fsdev/teammates.sqlite` here | `fsdev.config.mts:19` |
| `TEAMMATES_USER` | who the page acts as | `you` | `fsdev.config.mts:25` |
| `TEAMMATES_TREE` | the workers' tree | `workforce/` here | `fsdev.config.mts:32` |
| `TEAMMATES_RUNS` | the folder each coding run's worktree goes in | `teammates-runs/` beside the store | `fsdev.config.mts:27` |
| `TEAMMATES_RUN_TIMEOUT_MS` | wall-clock budget for one coding run | `1200000` (20 minutes) per the README | `fsdev.config.mts:28`, `host.mts:51-52` |
| `TEAMMATES_SETUP` | one command each fresh worktree runs first, no shell | none | `fsdev.config.mts:29`, `host.mts:53-54` |
| `TEAMMATES_CHECKS` | `;`-separated commands a coding run's worktree must pass, no shell | none | `fsdev.config.mts:30`, `host.mts:55-56` |
| `GITHUB_TOKEN` | the token GitHub routines read with, for the lab's one user | what `gh auth token` answers | `fsdev.config.mts:31` via `operatorGitHubToken` |
| `TAVILY_API_KEY` | researcher's web search, one of the search keys in section 2 | none | README `:223`, `packages/tools/src/search/resolver.ts:20` |

- `TEAMMATES_WORKDIR`: the code accepts any path and resolves it against the current directory (`host.mts:44-48` calls `resolve`), though the README says "absolute". With the variable unset the config passes the repository root (`fsdev.config.mts:16-17,26`). An empty or blank value, a path that is not a folder, or a folder without `.git` stops the lab at start: `teammates: TEAMMATES_WORKDIR is not set…` / `names <path>, which is not a folder on this machine.` / `which is not a git checkout.` (`host.mts:42-50`), and it never falls back to the current directory. **[source]** README `:225-229`.
- `TEAMMATES_USER`: the lab has one user, so it takes every request as that user whatever user the request names (README `:191`). **[doc]**
- `TEAMMATES_RUN_TIMEOUT_MS` must be a positive integer, checked at start (`host.mts:51-52`, `assertPositiveInt`). An unset or blank value is `undefined`; the README's `1200000` default comes from the host, not this file. **[source]** Pass 3 should cite the README for the number.
- A shell operator in `TEAMMATES_SETUP` or `TEAMMATES_CHECKS` stops the lab at start (`host.mts:53-56`, README `:218`). **[doc]**
- `TEAMMATES_TREE` and `TEAMMATES_HARNESS` are passed only when set (`fsdev.config.mts:32-33`).
- `GOAL_HARNESS`, `GOAL_HARNESS_STEP_MS` and `GOAL_STALE_THRESHOLD_MS` (`fsdev.config.mts:34-36`) are a goal check's controls; dropped.

**Claude Code Style (`labs/claude-code-style`)**, read by `ccs/fsdev.config.mts:10-26`; defaults from the same lines and `labs/claude-code-style/README.md:116-127`. Eleven `CLAUDE_CODE_STYLE_*` variables, not five:

| Variable | What it sets | Default | Cite |
|---|---|---|---|
| `CLAUDE_CODE_STYLE_MODEL` | the model every worker answers with | `openai/gpt-5.4` | `fsdev.config.mts:19` |
| `CLAUDE_CODE_STYLE_UTILITY_MODEL` | the smaller model for background work | `openai/gpt-6-luna` | `fsdev.config.mts:20` |
| `CLAUDE_CODE_STYLE_DATA` | the SQLite file and each coding run's worktree under `runs/` | `.fsdev/claude-code-style` | `fsdev.config.mts:10` |
| `CLAUDE_CODE_STYLE_REPOSITORIES` | repositories coding runs work in a worktree of, separated by `:` (the platform path delimiter) | the repository the lab starts in | `fsdev.config.mts:23` |
| `CLAUDE_CODE_STYLE_USER` | who the pages are served for | `u_lab` | `fsdev.config.mts:18` |
| `CLAUDE_CODE_STYLE_ANSWER_AGAIN` | `off` leaves `answerAgain` off the main worker | on | `fsdev.config.mts:21` |
| `CLAUDE_CODE_STYLE_SETUP` | one command each fresh worktree runs first, no shell | none | `fsdev.config.mts:14` |
| `CLAUDE_CODE_STYLE_CHECKS` | `;`-separated commands a changed run must pass, no shell | none | `fsdev.config.mts:25`, `host.mts:41` |
| `CLAUDE_CODE_STYLE_HARNESS` | `stub` runs every coding task on a scripted coder with no model | the harness each coder names | `fsdev.config.mts:22` |
| `CLAUDE_CODE_STYLE_HARNESS_STEP_MS` | with `stub`, the pause before each of five scripted steps | `2000` | `fsdev.config.mts:22` |
| `CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS` | with `stub`, how long a silent request waits before it is taken as interrupted | one minute | `fsdev.config.mts:26`, README `:125` |

- Both `ccs` and `tm` read `GITHUB_TOKEN` via `operatorGitHubToken` (`ccs` README `:127`).
- `GOAL_CONTROL` and `GOAL_FLOWS` (`ccs/fsdev.config.mts:28-31`) are a goal check's controls; dropped.

**Kitchen sink (`apps/kitchen-sink`)**, read by `ks/fsdev.config.ts:78-97,231-235` (the rows were carried from the background-jobs recipe):

| Variable | What reads it | Effect | Default | Cite |
|---|---|---|---|---|
| `REDIS_URL` | the app's config | When set, builds the BullMQ job queue so the queue board can mount it. Local dev only. | unset: no queue | `ks/fsdev.config.ts:81,94-97`, README `:353` |
| `FSD_BULLMQ_DISPATCH` | the app's config | Exactly `1` installs that queue as the `jobQueue`, so every action dispatch goes through BullMQ instead of running in process. Needs `REDIS_URL`. | off | `ks/fsdev.config.ts:82,231-235`, README `:354` |

- `@flow-state-dev/bullmq` reads neither variable. Its README builds its connection from `process.env.REDIS_URL` in its own examples (`packages/bullmq/README.md:30,126`), which is the example's code.
- The same table in the kitchen-sink README also has `AI_GATEWAY_API_KEY` (every model goes through the gateway; `ks/lib/harness-gate.ts:84,117`), `OPENAI_API_KEY` (voice only), `PORT` (default `3000`), `STORE_TYPE`, `FSD_DB_URL` / `DATABASE_URL`, and `KITCHEN_SINK_*` and `BASH_PROVIDER` / `VERCEL_*` settings. Those app-specific ones outside the carried rows (`STORE_TYPE`, `KITCHEN_SINK_*`, `BASH_PROVIDER`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `KH_MCP_SECRET` in `labs/knowledge-hub`, `FSD_CODING_*` in `labs/fsd-coding-skill/src/config-env.ts`) are dropped, see section 9.

## 9. Other pages' rows

All 19 rows from `grep -rhE --include=*.record.md -e '→ R-15( \(corrected by pass 5\))?$'` were checked.

| Source page | Row | Verdict |
|---|---|---|
| claude-code-style | Which variable each provider and coder needs | **Carried**: sections 2 and 6. One point is lab-specific: that its model needs `AI_GATEWAY_API_KEY` is the lab's README (`:86`), not framework behavior. "A run is handed only the variables its harness's pass-list names" holds for the three harness kits (`kit.ts:43-64`, `codex/src/harness.ts:29`, `cursor/src/harness.ts:26`). |
| claude-code-style | "The five CLAUDE_CODE_STYLE_* variables" | **Carried, corrected**: the code reads eleven (section 8). The count "five" is not true. |
| teammates | `TEAMMATES_WORKDIR`, `TAVILY_API_KEY`, `TEAMMATES_USER` | **Carried**: section 8 (and `TAVILY_API_KEY` in section 2). |
| voice | `OPENAI_API_KEY` read by `OpenAIVoiceProvider`, no default | **Carried**: section 2. |
| add-to-an-existing-app | OpenAI, Anthropic, Google keys, the package each needs; no model config required | **Carried**: section 2. |
| run-a-starter | where the key is read from, which source wins, `AI_GATEWAY_API_KEY` as the alternative to `OPENAI_API_KEY` | **Carried**: sections 1 and 2. The "git-ignored file" part is a property of the user's own `.gitignore` and the starter, not of the framework: the repo's root `.gitignore:6` ignores `.env.local`, and `examples/hello-chat` ships `.env.local.example`. The page can say `.env.local` should stay out of version control; the sheet states no framework behavior for it. |
| run-a-starter | read once at startup, a change needs a restart | **Carried**: section 1, with the exact limits. |
| build-with-your-coding-agent | the CLI reads provider keys from `.env.local`; a generator needs its provider's key | **Carried**: sections 1 and 2. True for `run`, `chat`, `dev`, `serve`, `benchmark`; not for `block`. |
| persistence | `postgresStores` `connectionString` fallback `FSD_DB_URL` then `DATABASE_URL`, and the error | **Carried**: section 4, both error texts. |
| cli | environment loading: precedence, `--dotenv`, `.env.local` walk-up, accepted line forms | **Carried**: section 1. |
| cli | `FSDEV_DEBUG_ENDPOINTS`, `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL`, `FSDEV_TRACING_LEVEL` with defaults by host | **Carried**: section 5, with two limits the existing page omits (loopback only, config loaded). |
| durable-execution | block finished when its item log holds a completed `block_trace`; `FSDEV_TRACE_OBSERVABILITY=0` also gets a row | **Carried** as a pointer: section 5. The durable-execution page owns the behavior. `0` is accepted (`to:7-12`). |
| items | `FSDEV_TRACE_OBSERVABILITY` accepted values, default, effect | **Carried**: section 5. |
| vercel | `FSD_DB_URL`: what reads it, precedence over `DATABASE_URL`, default none | **Carried**: section 4. |
| railway | `OPENAI_API_KEY` read by the model resolver; `PORT` is read by the server file, not the framework | **Half carried**. `OPENAI_API_KEY` carried (section 2). The `PORT` half is **dropped as untrue**: `fsdev serve` and `serve()` both read `PORT` (`fserve:70-79`, `nserve:167-175`). It is true only of Next.js or a hand-written listener. |
| docker | model call with no key fails when resolved, not at startup, with `No provider available for "<provider>"`; `PORT` in use fails the listen; flows absent from the built output fail at startup | **Carried** for the first two: sections 2 and 4. The third is **dropped**: it is not an environment variable; it belongs on the Docker page's own failure list. |
| docker | table: `OPENAI_API_KEY`, `PORT` (default 3000), `NODE_ENV`, what reads each | **Carried**: sections 2 and 4. `NODE_ENV` is carried with its real effects, and with the fact that no `fsdev` command sets it. |
| debug-a-run | `FSDEV_TRACE_OBSERVABILITY` default, `false` disables, what is omitted from block rows when off | **Carried**: section 5. |
| background-jobs-bullmq | `REDIS_URL` and `FSD_BULLMQ_DISPATCH` | **Carried** in section 8 as kitchen-sink rows. Neither is read by a package. |

Rows dropped from the other sources considered while searching, with the reason:

- `KITCHEN_SINK_*`, `BASH_PROVIDER`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `STORE_TYPE`: the kitchen-sink's own settings, no page asked for them.
- `KH_MCP_SECRET` (`labs/knowledge-hub`), `FSD_CODING_HARNESS`, `FSD_CODING_CWD`, `FSD_CODING_MODEL`, `FSD_CODING_NETWORK_ACCESS`, `FSD_CODING_ADD_DIR` (`labs/fsd-coding-skill/src/config-env.ts`): a lab's and a skill's own settings, no page asked for them.
- `WATCH_REPORT_DEPENDENCIES`, `FSDEV_DEV_WATCH_CHILD`: set by `fsdev dev --watch` for its own child process, not set by a reader.
- `FSD_DEMO_TOKEN`: appears only in the text `fsdev` prints for a starter (`packages/fsdev/src/next-steps.ts:167`); nothing reads it.
- `ELEVENLABS_API_KEY`: read by the user's own code in the voice page's example, not by a package. `VERCEL`: read by the engine only to warn and to mark the disk ephemeral (`cfs:1421`, `packages/vercel/src/handler.ts:43`); set by Vercel, never by the reader.
- `GOAL_*`: a goal check's controls.

## Contradictions found

- The existing page says `fsdev dev` sets `FSDEV_DEBUG_ENDPOINTS`, `FSDEV_DEBUG_ALLOW_ANONYMOUS_LOCAL` and `FSDEV_TRACING_LEVEL` when unset. The code does so only on a loopback bind with a config loaded, and forces the first two to `0` on any other bind (`dev:288-303`). Code wins.
- The existing page says `FSDEV_TRACE_OBSERVABILITY` takes `true` / `false`. The code also accepts `1` / `0` (`to:7-12`). Code wins.
- The existing page says `FSD_DB_URL` is the default for `vercelPostgresStores()`. `postgresStores()` reads it and `DATABASE_URL` the same way (`pg:127-131`). Code wins.
- The existing page says `FSD_QUIET_WARNINGS` suppresses the intent-override logs. It suppresses the `warnOnce` and `warnOnceDev` warnings, including `warnOnce` ones `NODE_ENV=production` does not (`dep:19-40`); boot diagnostics ignore it. Code wins.
- `labs/teammates/README.md:223` names `BRAVE_API_KEY`. The tools package reads `BRAVE_SEARCH_API_KEY` (`packages/tools/src/search/resolver.ts:24`; `packages/tools/README.md:37`; `apps/docs/docs/tools/search.md:38`). Code wins.
- The railway record says `PORT` is not read by the framework. It is read by `fsdev serve` and `serve()` (sections 4 and 9). Code wins.
- The claude-code-style record says five `CLAUDE_CODE_STYLE_*` variables. The code reads eleven.
- `packages/core/src/blocks/internal/tool-executor.ts:121` and `runAction.ts:1225` read `FSDEV_DEBUG_TOOLS` and `FSDEV_DEBUG_EVENTS_RATE_MS`, which the existing page omits. Added in section 5.

## Not stated, and why

- Nothing about `NODE_ENV` choosing a stores profile: it does not.
- The program's `--version` string and other CLI flags: the CLI page owns them (`cli.facts.md`).
- Whether the tracing variables are safe in production: the code gives defaults, not a recommendation, and no source here makes one.
- No fact is run against a deployed project, a Vercel Cron call, or a live gateway key.

## Revise round 1

Changes after the fact check, the depth pass and the editor.

- Corrected: the `--no-config` and lean-record facts above; the `NODE_ENV` list now has all its effects; the intro and front matter no longer say the page lists every name. Added rows for `FIRECRAWL_API_KEY` and `JINA_API_KEY`.
- Checked: `openai/gpt-5.4` is the real default of `CLAUDE_CODE_STYLE_MODEL` (`ccs/fsdev.config.mts:19`), and the `CLAUDE_CODE_STYLE_REPOSITORIES` list splits on `node:path`'s `delimiter`, so it is `;` on Windows (`:23`). Both rows left the page with the example-app tables (below), so neither is stated.
- Left the page, with the sections of this sheet that still back them, each now a link:
  - Section 1 `--dotenv` rows (resolution, missing-file exit 3, `fsdev block` loads none): R-35 `./cli.md`. The `--env-file` sentence is cut, not moved.
  - Section 2 resolution rules, the `env` option and the gateway rules: R-21 `./models.md`. Search provider order and error text: R-42 `./tools.md`. `GITHUB_TOKEN` reader: R-25 `./workforce.md`. Voice fallback: R-43 `./voice.md`.
  - Section 3 intent override rows: R-21.
  - Section 4: `FSD_ENV` and the warnings row (R-12 `./runtime.md`); `FSD_DB_URL`, `DATABASE_URL` and `LIVE_TAIL_POOL_MAX` (R-16 `./stores.md`); `CRON_SECRET` (R-33 `./schedules.md`); `FSD_PUSH_SECRET` (R-13 `./http-api.md`); `PORT` and `HOST` listen rows (R-35); `LIVE_TAIL_LIVENESS_MS` and the trace store window (R-06 `./items.md`).
  - Section 5: debug route rows (R-13); the `fsdev dev` table (R-35); tracing level rows (R-06); `block_trace` contents and the replay sentence (R-17 `./durable-execution.md`, `./items.md`).
  - Section 6 base pass-list, sign-in checks and `harnessEnv`: R-27 `./harness-runs.md`. The page keeps the three added-names rows.
  - Section 8 (Teammates, Claude Code Style and Kitchen sink tables, and the bullmq sentence): cut, not moved. They are example-app configuration, in the labs' own READMEs.
- Neighbours edited: the claude-code-style and teammates starter pages no longer say this page lists their variables with defaults; `items.md` points at its own `lean` row.

## Revise round 2

Pass 9 questions the page did not answer, now stated on the page from sections 2, 3 and 4 above:

- Provider keys: which variable per provider, that a gateway key makes `openai/gpt-6-luna` resolve, direct key wins over a gateway key (`pd:6-8,41-50`).
- Intent overrides: a comma-separated list is not one model string and throws at construction with the `createModelResolver: FSDEV_INTENT_CHAT:` prefix; `my-custom` reads `FSDEV_INTENT_MY_CUSTOM`; an undeclared intent is warned once and ignored; a hardcoded block model string is unchanged (`cmr:553-577,613-632`).
- Database URL: order `connectionString`, `FSD_DB_URL`, `DATABASE_URL`; default none; throw on first pool build; `FSD_ENV` picks the profile and `NODE_ENV` never does (`pg:127-131,147-152`, `vst:73-82`, `cfs:975-990`).
