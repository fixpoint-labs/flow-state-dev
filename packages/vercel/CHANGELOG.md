# @flow-state-dev/vercel

## Pre-1.0 history

Captured from the project's pre-Changesets development log (root `changelog.md`,
deleted on FIX-653). Entries are listed newest-first.

### 2026-05-17 — Bash tool: working bash on Vercel without operator setup (FIX-587)

The Vercel sandbox adapter's `enrichVercelError` now recognizes `VercelOidcContextError` and `LocalOidcContextError` (thrown before any HTTP call when no OIDC token is available) and wraps every adapter method, not just `Sandbox.create()` / `get()`. Default `destination` is now `/vercel/sandbox/workspace` (the only writable home under the Vercel Sandbox runtime user). New "Using the bash tool on Vercel" deployment guide.

### 2026-05-11 — Scheduled actions: schedule index (FIX-581)

`@flow-state-dev/vercel/schedules` ships `createGetToPostCronShim` and `createScheduleTickHandler`. Vercel hosts no longer need to hand-roll the GET-to-POST adapter or the polling tick; both helpers authenticate with constant-time bearer comparison and forward the same secret to the dispatch endpoint.

### 2026-05-10 — Scheduled actions: declarative cron (FIX-440)

Vercel Cron integration guide ships alongside the new `@flow-state-dev/scheduled` package and the framework's `defineFlow({ schedules })` block.

### 2026-05-07 — Live tail on Vercel + Neon

The Vercel deployment example explicitly passes `liveTailPool: null` to force the polling fallback. Polling is correct for serverless deployments where listener sessions don't survive function recycles, and the ~250ms tail latency is invisible behind model generation. Local-with-Postgres deployments keep LISTEN/NOTIFY.

### 2026-04-30 — Connection resilience (FIX-476)

Vercel adapter no longer injects heartbeats itself — the core handles it. `VercelHandlerOptions.heartbeatMs` is now a deprecated no-op; configure via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })` instead.
