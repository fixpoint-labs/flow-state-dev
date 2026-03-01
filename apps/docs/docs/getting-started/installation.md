---
sidebar_position: 2
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
```

### Which packages do I need?

| Use case | Packages |
|----------|----------|
| Define flows only (shared library) | `core` |
| Server-side execution | `core` + `server` |
| Client-side consumption | `core` + `client` |
| Full-stack React app | `core` + `server` + `react` |
| Testing | `core` + `testing` |

The `react` package depends on `client` internally — you don't need to install `client` separately when using `react`.

## Peer Dependencies

- **`zod`** `^3.24.1` — Used for schema validation across all packages
- **`react`** `^18.0.0 || ^19.0.0` — Required only by `@flow-state-dev/react`

## TypeScript

flow-state.dev is written in TypeScript and ships type definitions. For best results:

- TypeScript `^5.7`
- Enable `strict` mode in your `tsconfig.json`

## Server Framework Compatibility

The server package exposes standard request handlers. The `createFlowApiRouter` returns handlers compatible with:

- **Next.js** App Router (catch-all route)
- Any framework supporting standard `Request`/`Response` objects

```ts title="Next.js App Router"
// app/api/flows/[...path]/route.ts
const router = createFlowApiRouter({ registry });
export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```
