# @flow-state-dev/vercel

Vercel deployment adapter for flow-state-dev. Wraps a flow-state-dev router into Next.js App Router handlers with Vercel-specific SSE shaping, heartbeats, and runtime configuration.

## Quick Start

```bash
pnpm add @flow-state-dev/vercel
```

Two files to deploy any FSD app to Vercel:

**1. Server setup** (`lib/server.ts`) — same as local dev:

```ts
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/server";
import myFlow from "@/flows/my-flow/flow";

const registry = createFlowRegistry();
registry.register(myFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
});
```

**2. Route file** (`app/api/flows/[[...path]]/route.ts`):

```ts
import { createVercelHandler } from "@flow-state-dev/vercel";
import { router } from "@/lib/server";

export const { GET, POST, PATCH, DELETE } = createVercelHandler(router);

// Next.js reads these statically — must be literal declarations, not re-exports.
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

That's it. SSE streams get the right headers, heartbeats prevent proxy timeouts, and `maxDuration` is set to 300 seconds.

## What it does

- **Handles Next.js 15 async params** — unwraps `Promise<{ path }>` so you don't have to.
- **SSE response shaping** — adds `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` to prevent Vercel's edge layer from buffering streamed tokens.
- **Heartbeat keep-alive** — injects periodic `: ping` SSE comments (default every 15s) to defeat intermediate proxy idle timeouts.
- **AbortSignal wiring** — request cancellation propagates into flow execution.

## Lazy router initialization

If your store setup is async (e.g. Postgres connection pool), pass a factory function:

```ts
import { createVercelHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

// getRouter returns Promise<FlowApiRouter> — called once, cached internally.
export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
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

Creates Next.js App Router `GET`, `POST`, `PATCH`, `DELETE` handlers.

**`app`**: Either a `FlowApiRouter` (from `createFlowApiRouter`) or a `() => FlowApiRouter | Promise<FlowApiRouter>` factory. The factory is called at most once and cached.

**Returns**: `{ GET, POST, PATCH, DELETE }` — export these directly from your route file.

## Scripts

```bash
pnpm build       # Build the package
pnpm typecheck   # Type-check
pnpm test        # Run tests
```
