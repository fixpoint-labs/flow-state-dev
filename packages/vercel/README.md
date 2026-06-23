# @flow-state-dev/vercel

Vercel deployment adapter for flow-state-dev. Wraps a flow-state-dev router into Next.js App Router handlers with Vercel-specific SSE shaping and runtime configuration.

> SSE heartbeats are now provided by `@flow-state-dev/engine` for every live and GET-attach stream. Configure them via `createFlowApiRouter({ defaultSseHeartbeatMs })` or per-flow `defineFlow({ request: { sseHeartbeatMs } })`. The `heartbeatMs` option on the Vercel handler is deprecated and ignored.

## Quick Start

```bash
pnpm add @flow-state-dev/vercel
```

Two files to deploy an FSD app to Vercel.

**1. FlowState** (`lib/flowstate.ts`) — the runtime config:

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import myFlow from "@/flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: {
    prod: { primary: vercelPostgresStores() },
    dev: { primary: inMemoryStores() },
  },
  defaultProfile: "dev",
});
```

**2. Catch-all route** (`app/api/flows/[...path]/route.ts`):

```ts
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);

// Next.js reads these statically — must be literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

SSE streams get the right headers, heartbeats prevent proxy timeouts, and `maxDuration` is set to 300 seconds. `createVercelNextHandler` resolves the router lazily on the first request, so async store init works with no top-level await.

For background work that must survive the function freezing after the response (scheduled dispatches, post-202 execution), wire Vercel's `after` at construction with `createFlowState({ onBackgroundWork: (p) => after(() => p) })` from `next/server`. It's a `createFlowState` option, not a handler option, because the router is built inside `createFlowState`.

## `@flow-state-dev/vercel/store`

`vercelPostgresStores()` returns a `StoreAdapter` for the `primary` capability slot, Postgres tuned for Vercel and Neon. It bakes in the Vercel pool defaults (`vercelPgPoolOptions`), swaps in Neon's WebSocket `Client` for `.neon.tech` URLs, skips schema init (migrations run out-of-band at build), and uses the polling tail fallback. No `process.env.VERCEL` checks or URL sniffing in your code — declare it as a profile slot.

```ts
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";

createFlowState({
  flows: { myFlow },
  stores: { prod: { primary: vercelPostgresStores() } },
});
```

The connection string defaults to `FSD_DB_URL` then `DATABASE_URL`. Pass `{ connectionString }` to override.

## `@flow-state-dev/vercel/next`

`createVercelNextHandler(flowstate)` mounts a `FlowState` onto a catch-all route with Vercel's SSE header shaping. Pass the `FlowState` handle, not `flowstate.getRouter()` — the handler resolves the router lazily itself.

```ts
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
```

Requires Next.js 15+. For non-Vercel Next deployments, use `createNextHandler` from `@flow-state-dev/next` instead.

## What it does

- **Handles Next.js 15 async params** — unwraps `Promise<{ path }>` so you don't have to.
- **SSE response shaping** — adds `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` to prevent Vercel's edge layer from buffering streamed tokens.
- **Heartbeat keep-alive** — injects periodic `: ping` SSE comments (default every 15s) to defeat intermediate proxy idle timeouts.
- **AbortSignal wiring** — request cancellation propagates into flow execution.

## Lazy router initialization

If your store setup is async (e.g. Postgres connection pool), pass a factory function instead of a pre-built router:

```ts
// [... path]/route.ts
import { createVercelHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

// getRouter returns Promise<FlowApiRouter> — called once, cached internally.
export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);
// ...runtime config...
```

```ts
// route.ts (bare)
import { createVercelBareHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

export const { GET, POST } = createVercelBareHandler(getRouter);
```

## Configuration

```ts
createVercelHandler(router, {
  heartbeatMs: 15_000,           // Heartbeat interval (default: 15s)
  onAbort: (req) => { ... },     // Client disconnect callback
  waitUntil: (p) => { ... },     // Keep function alive for background work
});
```

### Route config values

Next.js reads `runtime`, `maxDuration`, and `dynamic` via static analysis. They must be **literal `export const` declarations** in your route file — re-exports from another module won't work.

| Field | Recommended value | Purpose |
|--------|---------|---------|
| `runtime` | `"nodejs"` | Vercel runtime (use `"edge"` only with edge-safe stores) |
| `maxDuration` | `300` | Max function execution time in seconds |
| `dynamic` | `"force-dynamic"` | Prevents Next.js from caching SSE routes |

The `@flow-state-dev/vercel/config` module exports these same values for programmatic access (tests, non-Next.js adapters), but they cannot be re-exported into a Next.js route file.

## API

### `createVercelHandler(app, options?)`

Creates Next.js App Router `GET`, `POST`, `PATCH`, `DELETE` handlers for `[...path]` catch-all routes.

**`app`**: Either a `FlowApiRouter` (from `createFlowApiRouter`) or a `() => FlowApiRouter | Promise<FlowApiRouter>` factory. The factory is called at most once and cached.

**Returns**: `{ GET, POST, PATCH, DELETE }` — export these directly from your route file.

### `createVercelBareHandler(app, options?)`

Creates handlers for the bare `/api/flows` route (no path segments). Same `app` input as above.

**Returns**: `{ GET, POST }` — export from the sibling `route.ts`.

## Postgres on Vercel

Vercel keeps Node function instances warm across requests. Auto-suspending databases (Neon, Supabase direct-connect, RDS with auto-pause) drop TCP sockets after ~5 minutes idle. A default `pg.Pool` caches those dead sockets and emits "Connection terminated unexpectedly" on the next cold request.

`@flow-state-dev/vercel/pg` exports `vercelPgPoolOptions`, a `pg.PoolConfig` that closes that race (short idle timeout, longer connection timeout, `max: 1`, `allowExitOnIdle`). Feed it through `@flow-state-dev/store-postgres`' `poolOptions` passthrough, gated on `process.env.VERCEL` so local dev is unaffected:

```ts
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import { vercelPgPoolOptions } from "@flow-state-dev/vercel/pg";

export const stores = await createPostgresStores({
  connectionString: process.env.DATABASE_URL,
  poolOptions: process.env.VERCEL ? vercelPgPoolOptions : undefined
});
```

The subpath is zero-runtime — it uses `import type` for `pg`, so importing it doesn't add `pg` to your bundle if you aren't using the Postgres adapter.

For first-request cold-start latency (typical 1–3s after wake-up), swap in Neon's WebSocket `Client` using `pg.PoolConfig.Client`. See the `@flow-state-dev/store-postgres` README for the recipe.

## Scheduled actions

`@flow-state-dev/vercel/schedules` ships two helpers for wiring Vercel Cron to the scheduled-actions transport.

`createGetToPostCronShim` turns the GET hit Vercel Cron sends into the POST the framework dispatch endpoint expects:

```ts title="app/api/cron/billing/monthly-invoices/route.ts"
import { createGetToPostCronShim } from "@flow-state-dev/vercel/schedules";

export const GET = createGetToPostCronShim({
  flowKind: "billing",
  scheduleId: "monthly-invoices"
});
```

`createScheduleTickHandler` runs once per cron beat, claims due rows from a `ScheduleIndex`, and dispatches each with bounded concurrency:

```ts title="app/api/cron/schedule-tick/route.ts"
import { createScheduleTickHandler } from "@flow-state-dev/vercel/schedules";
import { scheduleIndex } from "@/lib/schedule-index";

export const GET = createScheduleTickHandler({
  flowKind: "reminders",
  index: scheduleIndex
});
```

Both helpers authenticate inbound requests via constant-time bearer compare against `CRON_SECRET` and forward the same bearer to the dispatch endpoint. Runtime deps stay zero — only `@flow-state-dev/scheduled` type imports cross the boundary.

See [Scheduled actions on Vercel Cron](https://flowstate.dev/guides/scheduled-vercel-cron) for the full setup.

## Scripts

```bash
pnpm build       # Build the package
pnpm typecheck   # Type-check
pnpm test        # Run tests
```
