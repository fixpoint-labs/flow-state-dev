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
export { runtime, maxDuration, dynamic } from "@flow-state-dev/vercel/config";
```

That's it. SSE streams get the right headers, heartbeats prevent proxy timeouts, and `maxDuration` is set to 300 seconds.

## What it does

- **Handles Next.js 15 async params** — unwraps `Promise<{ path }>` so you don't have to.
- **SSE response shaping** — adds `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` to prevent Vercel's edge layer from buffering streamed tokens.
- **Heartbeat keep-alive** — injects periodic `: ping` SSE comments (default every 15s) to defeat intermediate proxy idle timeouts.
- **AbortSignal wiring** — request cancellation propagates into flow execution.
- **Runtime config** — re-exports `runtime`, `maxDuration`, and `dynamic` from `@flow-state-dev/vercel/config` as a single source of truth.

## Lazy router initialization

If your store setup is async (e.g. Postgres connection pool), pass a factory function:

```ts
import { createVercelHandler } from "@flow-state-dev/vercel";
import { getRouter } from "@/lib/server";

// getRouter returns Promise<FlowApiRouter> — called once, cached internally.
export const { GET, POST, PATCH, DELETE } = createVercelHandler(getRouter);
export { runtime, maxDuration, dynamic } from "@flow-state-dev/vercel/config";
```

## Configuration

```ts
createVercelHandler(router, {
  heartbeatMs: 15_000,           // Heartbeat interval (default: 15s)
  onAbort: (req) => { ... },     // Client disconnect callback
  waitUntil: (p) => { ... },     // Keep function alive for background work
});
```

### Config exports

`@flow-state-dev/vercel/config` exports these values. Override them if needed:

| Export | Default | Purpose |
|--------|---------|---------|
| `runtime` | `"nodejs"` | Vercel runtime (use `"edge"` only with edge-safe stores) |
| `maxDuration` | `300` | Max function execution time in seconds |
| `dynamic` | `"force-dynamic"` | Prevents Next.js from caching SSE routes |

To override `maxDuration`, re-export your own value from the route file instead of importing from the config module:

```ts
export const { GET, POST, PATCH, DELETE } = createVercelHandler(router);
export { runtime, dynamic } from "@flow-state-dev/vercel/config";
export const maxDuration = 60; // Override: 60 seconds
```

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
