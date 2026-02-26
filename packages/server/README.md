# @flow-state-dev/server

Server runtime for Flow State Dev.

This package owns:
- action execution orchestration
- in-memory and filesystem store adapters
- request streaming and replay utilities
- flow registry and canonical route adapters
- runtime error normalization

## What This Package Is For

Use `@flow-state-dev/server` inside framework-integrated server environments to:
- register flows
- execute actions
- expose canonical `/api/flows` routes
- persist and query state across request/session/user/project scopes

## Public API Areas

Context/runtime:
- `createExecutionContext`
- `runAction`
- `executeBlock`

Stores:
- `createInMemoryStores`
- `createFilesystemStores`
- scope store factories and CAS/state ops

Streaming:
- `createResponseEmitter`
- `encodeStreamEvent`
- `serializeSSEFrame`
- `replayRequestEvents`

Registry/routes:
- `createFlowRegistry`
- `createFlowApiRouter`
- `parseFlowRoute`

Errors:
- `FlowError` and canonical subclasses
- `normalizeError`

## Quick Start

### Next.js Catch-All Route

```ts
// app/api/flows/[...path]/route.ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import myFlow from "@/flows/my-flow/flow";

const registry = createFlowRegistry();
registry.register(myFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

### Custom Model Resolution

```ts
import { createFlowApiRouter, createAiSdkModelResolver } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  modelResolver: createAiSdkModelResolver((modelId) => myModels.resolve(modelId)),
});
```

### Store Configuration

```ts
import { createFlowApiRouter, createFilesystemStores, createInMemoryStores } from "@flow-state-dev/server";

// Production: filesystem (default)
const router = createFlowApiRouter({ registry });

// Testing: in-memory
const router = createFlowApiRouter({ registry, stores: createInMemoryStores() });
```

## Scripts

- `pnpm --filter @flow-state-dev/server build`
- `pnpm --filter @flow-state-dev/server typecheck`
- `pnpm --filter @flow-state-dev/server test`

## Notes

- Phase 1 requires caller-provided `userId` for action/session routes.
- Request stream replay supports `Last-Event-ID` and `starting_after`.
- User stream remains capability-gated and disabled in current Phase 1 implementation.
- Generator blocks resolve models through `ctx.resolveModel`.
- By default, server runtime uses a built-in Vercel AI Gateway resolver (`AI_GATEWAY_API_KEY` or Vercel OIDC).
- `createAiSdkModelResolver` and `createDefaultModelResolver` are available when you need explicit model routing behavior.

## Architecture Reference

- [Server and Client](../../docs/architecture/server-and-client.md) — routes, transport, React hooks contract
- [Execution and Errors](../../docs/architecture/execution-and-errors.md) — retry, rescue, work queue
- [Streaming](../../docs/architecture/streaming.md) — item/content model, SSE protocol, resume
