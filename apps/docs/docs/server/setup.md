---
sidebar_position: 1
title: Engine setup
sidebar_label: Setup
---

# Engine setup

The engine is the runtime that registers your flows, runs actions, persists state, and streams results. The package is `@flow-state-dev/engine`. You describe it once with `createFlowState`.

HTTP is one way to reach it. A [host adapter](/docs/server/host-adapters) mounts the same handle as route handlers. `fsdev run` and `runAction` call the engine in-process, with no web server. See the [CLI](/docs/cli/overview) and [Calling a flow without a transport](/docs/advanced/manual-flow-execution).

## A single config object

`createFlowState` takes one declarative object and returns a handle. Everything the runtime needs lives in that object: which flows to register, how to resolve models, where state is stored, and what to do with errors.

```ts title="lib/flowstate.ts"
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import myFlow from "@/flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: { default: "openai/gpt-5.4-mini" },
  stores: { default: { primary: inMemoryStores() } },
});
```

Keep this file separate from your route handler. The route imports `flowstate` and mounts it. That split lets the same configured runtime be reused by tests, a CLI, or more than one route.

Move this config object to an `fsdev.config.ts` at your project root that default-exports it, and the `fsdev` CLI runs your flows with the same wiring, your models and stores rather than CLI defaults. See [App Configuration](/docs/cli/configuration).

## The createFlowState factory

`createFlowState(options)` builds the runtime synchronously and returns a `FlowState` handle. The handle exposes:

- `getRouter(): Promise<FlowApiRouter>` — resolve the route handlers. The first call triggers store initialization.
- `ready(): Promise<void>` — eager warmup. Idempotent. Useful in tests or an `instrumentation.ts` file.
- `dispose(): Promise<void>` — release pooled resources (database connections) across every declared store.
- `activeProfile: string` — the store profile that resolved at runtime (read-only).
- `settings` — the settings bag you passed in (read-only).
- `meta` — diagnostics: `{ flowKeys, profileKeys, declaredSlots }`.

Construction validates your config up front. An empty `stores` map or a `defaultProfile` that names a profile you didn't declare throws right away, not on the first request.

`flows` and `stores` are the two required fields; everything else has a default. The full field list, with types and defaults, is in [Runtime options](/docs/configuration/runtime).

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { vercelPostgresStores } from "@flow-state-dev/vercel/store";
import { OpenAIVoiceProvider } from "@flow-state-dev/voice-openai";
import myFlow from "@/flows/my-flow/flow";

export const flowstate = createFlowState({
  flows: { myFlow },
  models: {
    default: "openai/gpt-5.4-mini",
    intents: {
      chat: ["vercel/anthropic/claude-sonnet-4.6", "vercel/openai/gpt-5.5"],
    },
  },
  voice: { provider: new OpenAIVoiceProvider({ apiKey: process.env.OPENAI_API_KEY }) },
  stores: {
    prod: { primary: vercelPostgresStores() },
    dev: { primary: inMemoryStores() },
  },
  defaultProfile: "dev",
  settings: { sandbox: { type: "local" } },
  onError: (error, ctx) =>
    console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message),
});
```

## Stores and capability profiles

`stores` is a map of named profiles. A profile maps capability slots to store adapters. A capability slot is a typed container for one category of storage, like primary state or blobs.

The required slot is `primary`. It backs all the core state: sessions, requests, users, orgs, active requests, checkpoints, content, and traces. The `blobs`, `queue`, and `scheduler` slots are declared and accepted in the type, but they're forward-compatible. No backing store ships for them yet, so declaring them is a no-op in Phase 1.

```ts
stores: {
  prod: { primary: vercelPostgresStores() },
  dev: { primary: inMemoryStores() },
}
```

Adapters ship in a few packages:

| Adapter | Import | Notes |
|---------|--------|-------|
| `inMemoryStores()` | `@flow-state-dev/engine` | Ephemeral. Default for local dev and tests. |
| `filesystemStores({ rootDir })` | `@flow-state-dev/engine` | On-disk persistence, local development only. Suitable for single-server dev; persistent across restarts. |
| `postgresStores(options)` | `@flow-state-dev/store-postgres` | Postgres-backed. |
| `sqliteStores(options)` | `@flow-state-dev/store-sqlite` | SQLite-backed. Recommended for durable persistence; what `fsdev dev` uses. |
| `vercelPostgresStores()` | `@flow-state-dev/vercel/store` | Postgres tuned for Vercel/Neon. |

Each adapter declares which slots it can back. The current adapters all back `primary`.

## Persistence cost model

All backed adapters persist items and events incrementally, not by rewriting the full record on every write. SQLite and Postgres write item rows into a child table; the filesystem store appends event lines to an NDJSON file. The filesystem store suits local development on a single machine. For production, reach for SQLite or Postgres, which handle concurrent access and larger logs. See the [SQLite schema-evolution notes](https://github.com/fixpoint-labs/flow-state-dev/blob/main/packages/store-sqlite/README.md) and the [persistence overview](/docs/persistence/overview) for the storage model behind each backend.

## Settings

`settings` is instance-level config that blocks read at runtime through `ctx.settings`. It's typed by declaration-merging into the `FlowStateSettings` interface, the same pattern Vite uses for `ImportMetaEnv`.

Declare your shape once:

```ts
declare module "@flow-state-dev/core" {
  interface FlowStateSettings {
    sandbox: { type: "local" | "vercel" | "memory" };
  }
}
```

Pass it in `createFlowState({ settings })`. Then read it inside any block:

```ts
const s = ctx.settings.sandbox;
```

## Profile selection

Which profile is active is resolved on the first `ready()` or `getRouter()` call. The chain, first match wins:

1. `process.env.FSD_ENV` — if set, must name a declared profile, otherwise it throws.
2. `options.defaultProfile`.
3. The first declared profile.

`NODE_ENV` is intentionally not consulted. An explicit selector is safer here. `NODE_ENV=production` means a production build, which is not the same thing as production infrastructure, and conflating the two is how a local build ends up pointed at a live database.

## Error handling

`onError(error, ctx)` is an HTTP-level sink. `ctx` is `{ method, path }`:

```ts
onError: (error, ctx) =>
  console.error(`[flowstate] ${ctx.method} ${ctx.path}:`, error.message),
```

For routing runtime block failures (tool errors, generator failures, handler exceptions) to an external observability service, use the block-aware `errorCapture` hook instead. It receives the failing block's identity plus the flow, request, session, and user IDs. See [Error capture](/docs/advanced/error-capture).

## Adapters

`createFlowState` produces a platform-agnostic handle. A platform adapter turns it into route handlers.

For Vercel-hosted Next.js, use `createVercelNextHandler` from `@flow-state-dev/vercel/next`. It adds Vercel's SSE header shaping:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createVercelNextHandler } from "@flow-state-dev/vercel/next";

export const { GET, POST, PATCH, DELETE } = createVercelNextHandler(flowstate);
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
```

For non-Vercel Next.js deployments (for example Next-on-Cloudflare), use `createNextHandler` from `@flow-state-dev/next`. It mounts the same runtime with no Vercel-specific behavior:

```ts title="app/api/flows/[...path]/route.ts"
import { flowstate } from "@/lib/flowstate";
import { createNextHandler } from "@flow-state-dev/next";

export const { GET, POST, PATCH, DELETE } = createNextHandler(flowstate);
```

`@flow-state-dev/next` requires Next.js 15+.

On serverless platforms that freeze the function after the response, fire-and-forget work (scheduled dispatches, post-202 action execution) can be killed mid-flight. Wire the platform's keep-alive primitive at construction time, not in the handler. On Vercel that's `after` from `next/server`:

```ts
import { after } from "next/server";

export const flowstate = createFlowState({
  // ...
  onBackgroundWork: (p) => after(() => p),
});
```

This is a `createFlowState` option rather than a handler option because the router is built inside `createFlowState`. A handler wrapping an already-built router can't inject it.

For a custom transport (a non-Next host), call `flowstate.getRouter()` yourself and mount the returned `{ GET, POST, PATCH, DELETE }` handlers however your framework expects.

## Async initialization

Construction is synchronous. The router and stores initialize lazily, memoized on the first `getRouter()` or `ready()`. Database adapters open their pools then, not at import time. There's no top-level await, so the same `flowstate` instance works in a Next.js Route Handler.

If you want to warm the runtime ahead of the first request (or surface a bad connection string early), call `ready()` in an `instrumentation.ts` file or at the start of a test.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/flows` | List registered flows |
| GET | `/api/flows/capabilities` | Feature flags |
| POST | `/api/flows/:kind/actions/:action` | Execute action (new session) |
| POST | `/api/flows/:kind/:sessionId/actions/:action` | Execute action (existing session) |
| GET | `/api/flows/:kind/requests/:requestId/stream` | SSE request stream |
| GET | `/api/flows/sessions` | List sessions |
| GET | `/api/flows/sessions/:sessionId` | Session detail |
| GET | `/api/flows/sessions/:sessionId/state` | State snapshot (clientData) |
| GET | `/api/flows/sessions/:sessionId/workstreams` | [Background jobs](./background-work.md) started by this session |
| POST | `/api/flows/:kind/sessions` | Create session |
| DELETE | `/api/flows/sessions/:sessionId` | Delete session |

## Request Lifecycle

When an action is invoked:

1. The server validates the input against the action's `inputSchema`
2. Resolves or creates a session
3. Creates a request scope and stream
4. Returns `202 Accepted` with a `requestId`
5. Executes the block asynchronously
6. Streams events (items, deltas, status) via SSE
7. Persists state on completion

The client connects to the SSE stream using the `requestId` to receive real-time results.

## Lower-level APIs

`createFlowState` wraps two lower-level functions, `createFlowRegistry` and `createFlowApiRouter`. They still exist for custom transports and advanced wiring. Most users want `createFlowState`. See the [Server API](/docs/api/server) reference if you need the lower-level surface.

Default-exporting the `createFlowState` handle from an `fsdev.config.ts` at your project root lets `fsdev run` and `fsdev dev` reuse this exact wiring from the terminal. See [App Configuration](/docs/cli/configuration).
