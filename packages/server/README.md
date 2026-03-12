# @flow-state-dev/server

**The runtime. Register flows, execute actions, stream results — three lines to a complete API.**

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import myFlow from "./flows/my-flow";

const registry = createFlowRegistry();
registry.register(myFlow);
const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

That's a full API with action execution, session management, SSE streaming with resume, and state snapshots. Drop it into a Next.js catch-all route and you're done.

## What this package does

- **Action execution** — Validates input, resolves sessions, runs block pipelines, emits items
- **SSE streaming** — Items stream live as blocks execute, with sequence-number cursors for resume
- **State persistence** — In-memory and filesystem store adapters with CAS-guarded atomic writes
- **Flow registry** — Register multiple flows, routes are derived automatically
- **Error normalization** — All errors become typed `FlowError` instances with codes, retry signals, and scope context
- **Structured logging** — Every action execution logs flow/action/block IDs, attempt numbers, timing, and summarized payloads
- **Template utility** — `renderTemplate(content, state)` for opt-in Handlebars-style resource rendering

## Store configuration

```ts
import { createFilesystemStores, createInMemoryStores } from "@flow-state-dev/server";

// Default: filesystem persistence
const router = createFlowApiRouter({ registry });

// Testing: in-memory (fast, no cleanup)
const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });

// Runtime safety guards (optional)
const guardedRouter = createFlowApiRouter({
  registry,
  maxResponseBufferSize: 10_000,
  maxConcurrentStreams: 1_000,
  staleStreamTtlMs: 300_000,
});
```

## Custom model resolution

```ts
import { createFlowApiRouter, createAiSdkModelResolver } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  modelResolver: createAiSdkModelResolver((modelId) => myModels.resolve(modelId)),
});
```

## Custom logging

`runAction` and `executeBlock` emit structured logs by default — flow/action/block IDs, attempt numbers, summarized payloads, retries, and terminal errors.

```ts
await runAction({
  flow,
  actionName: "chat",
  input,
  userId: "user_123",
  stores,
  logger: {
    info: (msg, ctx) => appLogger.info({ ...ctx }, msg),
    warn: (msg, ctx) => appLogger.warn({ ...ctx }, msg),
    error: (msg, ctx) => appLogger.error({ ...ctx }, msg),
  },
});
```

Use `summarizeForLog(value)` for the same bounded payload summaries in custom middleware.

## Public API

**Runtime:**
- `renderTemplate` — Handlebars-style template rendering utility for resource content
- `createExecutionContext` — Build a block execution context
- `runAction` — Execute a flow action end-to-end
- `executeBlock` — Execute a single block with context

**Stores:**
- `createInMemoryStores` — Fast, ephemeral stores for testing
- `createFilesystemStores` — Persistent stores for development and production
- Scope store factories and CAS/state ops

**Streaming:**
- `createResponseEmitter` — Create an SSE emitter for a request
- `encodeStreamEvent` / `serializeSSEFrame` — Low-level SSE encoding
- `replayRequestEvents` — Replay events from a sequence cursor

**Registry/routes:**
- `createFlowRegistry` — Register flow instances
- `createFlowApiRouter` — Generate HTTP route handlers from a registry
- `parseFlowRoute` — Parse incoming request paths

**Errors:**
- `FlowError` and canonical subclasses
- `normalizeError` — Wrap any thrown value into a typed FlowError

## Notes

- Phase 1 requires caller-provided `userId` for all action/session routes
- Stream resume supports both `Last-Event-ID` header and `starting_after` query param
- `GET /sessions/:id/state` supports `offset` + `limit` pagination for `items`
- Generator blocks resolve models through `ctx.resolveModel` — default uses Vercel AI Gateway
- `createAiSdkModelResolver` and `createDefaultModelResolver` available for explicit model routing

## Scripts

```bash
pnpm --filter @flow-state-dev/server build
pnpm --filter @flow-state-dev/server typecheck
pnpm --filter @flow-state-dev/server test
```

## Architecture reference

- [Server and Client](../../docs/architecture/server-and-client.md) — Routes, transport, React hooks contract
- [Execution and Errors](../../docs/architecture/execution-and-errors.md) — Retry, rescue, work queue
- [Streaming](../../docs/architecture/streaming.md) — Item/content model, SSE protocol, resume semantics
