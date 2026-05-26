---
sidebar_position: 4
---

# Installation

## Packages

flow-state.dev is distributed as separate packages. Install what you need:

```bash
# Core (required) — block builders, flow definitions, types
pnpm add @flow-state-dev/core zod

# Server — action runtime, stores, SSE streaming
pnpm add @flow-state-dev/server

# Client — HTTP/SSE transport (no React dependency)
pnpm add @flow-state-dev/client

# React — hooks, renderers, context providers
pnpm add @flow-state-dev/react

# Testing — test harnesses for blocks and flows
pnpm add -D @flow-state-dev/testing

# CLI — run flows and blocks from the terminal
pnpm add -D @flow-state-dev/cli
```

### Which packages do I need?

| Use case | Packages |
|----------|----------|
| Define flows only (shared library) | `core` |
| Server-side execution | `core` + `server` |
| Client-side consumption | `core` + `client` |
| Full-stack React app | `core` + `server` + `react` |
| Testing | `core` + `testing` |
| CLI development workflow | `core` + `server` + `cli` |

The `react` package depends on `client` internally — you don't need to install `client` separately when using `react`.

## Peer Dependencies

- **`zod`** `^3.24.1` — Used for schema validation across all packages
- **`react`** `^18.0.0 || ^19.0.0` — Required only by `@flow-state-dev/react`

## TypeScript

flow-state.dev is written in TypeScript and ships type definitions. For best results:

- TypeScript `^5.7`
- Enable `strict` mode in your `tsconfig.json`

## Initialize the server

Describe the runtime once with `createFlowState`. You pass it your flows, a model config, and where to store state. Keep this in its own file so a route handler (and your tests) can import it.

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/server";
import myFlow from "@/flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

`createFlowState` builds synchronously and initializes stores lazily on the first request, so it works in a Next.js Route Handler with no top-level await. See [Server Setup](/docs/server/setup) for stores, profiles, settings, and error handling.

## Mount the route

A platform adapter turns the `flowstate` handle into HTTP route handlers. The framework uses one catch-all route. For Vercel-hosted Next.js:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

For non-Vercel Next.js deployments, use `createNextHandler` from `@flow-state-dev/next`. Any framework that speaks standard `Request`/`Response` can mount `flowstate.getRouter()` directly.
