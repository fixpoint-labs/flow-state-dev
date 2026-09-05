---
"@flow-state-dev/engine": minor
"@flow-state-dev/next": minor
"@flow-state-dev/vercel": minor
"@flow-state-dev/core": minor
"@flow-state-dev/store-postgres": minor
"@flow-state-dev/store-sqlite": minor
"@flow-state-dev/testing": minor
---

Add `createFlowState`, a single factory that assembles a flow-state runtime from declarative config (flows, model intents, voice, named store profiles, settings, and an error hook) and returns a `FlowState` handle with lazy router init, eager `ready()`, and `dispose()`. Stores are now configured as named profiles of capability slots (`primary`, plus forward-compatible `blobs`/`queue`/`scheduler`), selected at runtime via `FSD_ENV` → `defaultProfile` → first profile. Adds the `inMemoryStores()` and `filesystemStores()` store adapters and exposes instance settings to blocks via `ctx.settings`.

Add `@flow-state-dev/next`: `createNextHandler(flowstate)` mounts a `FlowState` onto a Next.js App Router catch-all with no platform-specific behavior (works on Next-on-Cloudflare and other non-Vercel hosts; requires Next.js 15+).

Add `@flow-state-dev/vercel/store` (`vercelPostgresStores()`, a Vercel/Neon-tuned Postgres store adapter) and `@flow-state-dev/vercel/next` (`createVercelNextHandler(flowstate)`, which adds Vercel SSE shaping).

Add `ctx.settings` to the block context, typed by declaration-merging the `FlowStateSettings` interface.

Add the `postgresStores()` store adapter to `@flow-state-dev/store-postgres` and `sqliteStores()` to `@flow-state-dev/store-sqlite` for use with `createFlowState`.

`testFlow` gains a `settings` option so tests can exercise `ctx.settings`-dependent behavior.
