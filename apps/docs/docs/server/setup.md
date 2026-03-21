---
sidebar_position: 1
---

# Server Setup

How to configure the flow-state.dev server runtime in your application.

## Basic Setup

The server package provides three main exports: a flow registry, an API router, and store adapters.

```ts
import {
  createFlowRegistry,
  createFlowApiRouter,
} from "@flow-state-dev/server";
import chatFlow from "./flows/hello-chat/flow";
import agentFlow from "./flows/agent/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);
registry.register(agentFlow);

const router = createFlowApiRouter({ registry });
```

## Next.js App Router Integration

Create a catch-all route:

```ts title="app/api/flows/[...path]/route.ts"
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";
import chatFlow from "@/flows/hello-chat/flow";

const registry = createFlowRegistry();
registry.register(chatFlow);

const router = createFlowApiRouter({ registry });

export const GET = router.GET;
export const POST = router.POST;
export const DELETE = router.DELETE;
```

This exposes all framework endpoints under `/api/flows/`.

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
| POST | `/api/flows/:kind/sessions` | Create session |
| DELETE | `/api/flows/sessions/:sessionId` | Delete session |

## Store Configuration

### Filesystem Store (Default)

```ts
const router = createFlowApiRouter({ registry });
// Uses filesystem stores by default
```

### In-Memory Store (Testing)

```ts
import { createInMemoryStores } from "@flow-state-dev/server";

const router = createFlowApiRouter({
  registry,
  stores: createInMemoryStores(),
});
```

## Model Resolution

Generators need models resolved at runtime. The framework provides a unified model resolver.

### Zero-Config Resolver

Auto-detects providers from environment variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.):

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver(),
});
```

### Resolver with Options

```ts
import { createModelResolver } from "@flow-state-dev/core/models";

const router = createFlowApiRouter({
  registry,
  modelResolver: createModelResolver({
    keys: { openai: process.env.MY_OPENAI_KEY },
    presets: { fast: { models: ["openai/gpt-5.4-mini"] } },
  }),
});
```

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
