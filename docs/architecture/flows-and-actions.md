# Flows and Actions

A **flow** is the top-level unit of composition. It ties together blocks, state schemas, resources, client data, and lifecycle hooks into a registerable, executable unit.

## Defining a Flow

```ts
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";

const chatFlow = defineFlow({
  kind: "hello-chat",
  requireUser: true,
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string().min(1) }),
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },
  session: {
    stateSchema: z.object({ messageCount: z.number().default(0) }),
  },
});
```

### FlowType and FlowInstance

`defineFlow` returns a **FlowType** — a callable that produces **FlowInstance**s:

```ts
const chatFlowType = defineFlow({ kind: "hello-chat", ... });

// Create an instance with overrides
const flow = chatFlowType({ id: "default" });
```

Instances support merge-based overrides for action replacement/extension at creation time.

## Actions

Actions are the **entry points** to a flow. Every request executes through a named action.

```ts
actions: {
  sendMessage: {
    block: chatSequencer,
    onCompleted: updateJournalBlock,
    onErrored: logErrorBlock,
    userMessage: (input) => input.message,
  },
}
```

| Field | Purpose |
|-------|---------|
| `block` | Root block to execute for this action |
| `inputSchema` | Optional override for action-level validation. Defaults to `block.inputSchema`. |
| `userMessage` | Optional function extracting display text → emits a `MessageItem` (role: "user") as the first stream item |
| `onCompleted` | Block executed on terminal success |
| `onErrored` | Block executed on terminal failure |

**Key rules:**
- Actions are flow-level — not nested in session or scope configs
- Action input validation runs before any block execution
- `userMessage` is optional — omit it for system triggers or background tasks

### When to override `inputSchema`

`inputSchema` is optional because every block already carries its own. Override it when the action's public contract should diverge from the block's:

- **MCP exposure.** The action schema is the LLM-facing tool definition. Add richer `.describe()` annotations or stricter ranges than the block needs internally.
- **Boundary narrowing.** Block accepts a generic shape; the action enforces a narrower public contract (`z.string().min(1).max(1000)` over `z.string()`).
- **Documentation surface.** The action schema is the published contract. The block schema is the implementation contract. They can legitimately diverge.
- **Test escape hatches.** `inputSchema: z.unknown()` skips action-level validation while leaving the block's check intact.

Otherwise omit it — the block's schema is the source of truth, and the runtime falls back to it automatically.

## Scope Configuration

Flows configure state and resources across four scopes:

```ts
defineFlow({
  kind: "my-flow",
  requireUser: true,
  actions: { /* ... */ },

  request: {
    stateSchema: z.object({ /* per-request state */ }),
    onStarted: requestStartedBlock,
    onCompleted: requestCompletedBlock,
    onErrored: requestErroredBlock,
    onFinished: requestFinishedBlock,
    onStepErrored: stepErrorBlock,
  },

  session: {
    stateSchema: z.object({ mode: z.enum(["plan", "edit"]).default("plan") }),
    resources: { /* concrete persisted resources */ },
    clientData: { /* derived views for the client */ },
  },

  user: {
    stateSchema: z.object({ /* per-user state */ }),
    resources: { /* ... */ },
    clientData: { /* ... */ },
  },

  project: {
    stateSchema: z.object({ /* project-wide state */ }),
    resources: { /* ... */ },
    clientData: { /* ... */ },
  },

  work: {
    onStarted: workStartedBlock,
    onCompleted: workCompletedBlock,
    onErrored: workErroredBlock,
    onFinished: workFinishedBlock,
  },
});
```

## Lifecycle Hooks

Observational hooks fire at specific points in the request lifecycle:

| Hook | Fires When |
|------|------------|
| `onStarted` | Request begins (after session/context resolution) |
| `onCompleted` | Terminal success only |
| `onErrored` | Terminal failure only |
| `onFinished` | Always (success or failure) |
| `onStepErrored` | Non-terminal step/work failure (for visibility) |

Hooks use **past tense** naming — this is canonical. Present-tense names are reserved for future pre-execution hooks (not Phase 1).

Hooks can be plain callbacks or blocks. If you pass a block, its `inputSchema` must accept the lifecycle event shape.

## Request Execution Pipeline

When an action is invoked, the framework executes this sequence:

1. Resolve flow instance and action
2. Validate action input against `inputSchema`
3. Resolve or create session (ephemeral if no `sessionId`)
4. Require user context (Phase 1 policy)
5. Create request scope and state
6. Emit user message item (if `userMessage` defined)
7. Fire `request.onStarted`
8. Execute action root block via `block.run(input, ctx)`
9. Fire action + request completion/error hooks
10. Fire `request.onFinished`
11. Persist state and emit terminal stream status

## Resources and Client Data

Resources are **concrete persisted data** attached to a scope. Client data entries are **derived views** computed from state and resources — the mechanism for exposing data to clients.

```ts
session: {
  stateSchema: sessionStateSchema,
  resources: {
    plan: {
      stateSchema: z.object({ steps: z.array(z.string()).default([]) }),
      writable: true,
    },
  },
  clientData: {
    activePlan: async (ctx) => (ctx.resources.plan?.state)?.steps ?? [],
    messageCount: (ctx) => ctx.state.messageCount ?? 0,
  },
},
```

**Key rules:**
- Client-facing values are exposed through `clientData` entries — every entry is client-visible
- Generator context should use `contextFn()` for typed scope access
- Use `defineResource()` for portable resource reuse
- Each `clientData` compute function receives only its own scope's state and resources

### Automatic Resource Collection

Blocks can declare resource dependencies directly via `sessionResources`, `userResources`, and `projectResources` (using `defineResource()` values). When `defineFlow` is called, it collects `declaredResources` from all action blocks and merges them into the flow's scope configs. Flow-level resource declarations take priority — blocks bring defaults, and the flow can override them:

```ts
// Block declares its resource dependency
const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => { /* ... */ },
});

// defineFlow merges block-declared resources into session.resources
const flow = defineFlow({
  kind: "my-app",
  actions: { manage: { block: planManager } },
  // session.resources will automatically include { plan: planResource }
  // even without declaring it here
});
```

See [Resources and Client Data](./resources-and-client-data.md) for the full collection and merge model.

## Flow Discovery

Convention: `src/flows/**/flow.ts`

Each flow module exports one flow instance (or array of instances):

```ts
// src/flows/hello-chat/flow.ts
export default helloChatFlow({ id: "default" });
```

## Route Shape

Server routes follow a canonical pattern:

```
POST /api/flows/:flowKind/actions/:action
POST /api/flows/:flowKind/:sessionId/actions/:action
GET  /api/flows/:flowKind/requests/:requestId/stream
```

Typically mounted via a Next.js catch-all: `app/api/flows/[...path]/route.ts`

## Tools Configuration

Flow-level tool defaults and lifecycle observers:

```ts
defineFlow({
  // ...
  tools: {
    defaults: {
      timeoutMs: 30000,
      concurrency: "parallel",
      retry: { maxAttempts: 2 },
    },
    onToolStarted: (event, ctx) => { /* ... */ },
    onToolCompleted: (event, ctx) => { /* ... */ },
    onToolErrored: (event, ctx) => { /* ... */ },
  },
});
```

Generators still explicitly choose which tools are exposed per call — flow-level `tools` provides defaults and observability.

## Canonical Authority

This document is authoritative for flow and action contracts. For full type signatures, refer to the published types in `@flow-state-dev/core`.


### Token controls

- Flow-level: `tokenCounter` and `costEstimator` can be provided in `defineFlow`.
- Action-level: `tokenBudget` can be configured per action for request budget enforcement policies.

