---
sidebar_position: 3
---

# Flows

A flow is the top-level unit — the thing you register with the server and clients connect to. It ties together your blocks, actions, state, resources, and client data into a single, deployable definition.

Think of a flow as the complete specification of an AI-powered feature: what actions users can trigger, what state is tracked, and what data is exposed to the frontend.

## Defining a flow

```ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";

const chatFlow = defineFlow({
  kind: "my-chat",               // Unique identifier — becomes the URL path
  requireUser: true,              // Require userId on every request

  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
    reset: {
      inputSchema: z.object({}),
      block: resetHandler,
    },
  },

  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),
    resources: {
      artifacts: { stateSchema: artifactSchema, writable: true },
    },
    client: {
      expose: ["messageCount"],
    },
  },

  user: {
    stateSchema: z.object({
      preferences: z.object({ theme: z.string().default("light") }).default({}),
    }),
  },
});

export default chatFlow({ id: "default" });
```

## FlowType vs FlowInstance

`defineFlow()` returns a **FlowType** — a factory. Calling it with `{ id }` creates a **FlowInstance** — the thing you actually register with the server:

```ts
// FlowType — the blueprint
const chatFlow = defineFlow({ kind: "my-chat", ... });

// FlowInstance — what you register and deploy
export default chatFlow({ id: "default" });
```

This separation lets you run several instances of one flow type, each with its own session, resource, or tool configuration.

**Instances that clients address need distinct `kind`s, not just distinct `id`s.** Every external entry point — HTTP action routes, chat, webhooks, schedules, MCP — resolves a flow by `kind` alone, and none of them carry an instance id. When two instances share a `kind`, those paths reach the one whose `id` matches the `kind`, or else the first registered, and the other instance's configuration is never used. `id` distinguishes instances for in-process code holding the registry, which can look up a specific one; it is not an addressing surface over the wire.

### What the definition owns

Inbound transports belong to the flow type. Declare `chat`, `webhooks`, `schedules`, and `mcp` on `defineFlow()`:

```ts
const supportFlow = defineFlow({
  kind: "support",
  chat: { /* ... */ },
  webhooks: { /* ... */ },
  actions: { /* ... */ },
});

export default supportFlow({ id: "default" });
```

Every instance of a type serves the same transports. Pass one of the four to the instance call and TypeScript rejects it; a plain-JavaScript caller gets a thrown error naming the option.

Everything else is settable per instance: `id`, `kind`, `actions`, `session`, `request`, `user`, `org`, `resources`, `tools`, `voice`, `authentication`, `requireUser`, `tokenCounter`, `costEstimator`, `isolateUserState`, and `isolateOrgState`.

`voice` sits on both sides. Unlike the four transports above, you can set it on `defineFlow()` as the default for every instance of the type, then override it on any single instance.

## Actions — the flow's public API

Each action is an entry point that maps a name to an input schema and a root block. Clients call actions by name — that's the only way to trigger execution.

```ts
actions: {
  chat: {
    inputSchema: z.object({ message: z.string() }),
    block: chatPipeline,
    userMessage: (input) => input.message,

    // Lifecycle hooks — observe, don't control
    onCompleted: async (result, ctx) => { /* succeeded */ },
    onErrored: async (error, ctx) => { /* failed */ },
  },
  reset: {
    inputSchema: z.object({}),
    block: resetHandler,
  },
},
```

When an action executes:
1. Input is validated against `inputSchema`
2. Session is resolved or created
3. `userMessage(input)` emits a user message item (if defined)
4. The root block executes asynchronously
5. Lifecycle hooks fire on completion or error

See [Actions](/docs/fundamentals/actions) for the full picture.

## Session configuration

Sessions carry state, resources, and a `client` block that persist across requests in a conversation:

```ts
session: {
  stateSchema: z.object({
    mode: z.enum(["chat", "agent"]).default("chat"),
    messageCount: z.number().default(0),
  }),

  resources: {
    plan: {
      stateSchema: z.object({
        steps: z.array(z.string()).default([]),
        status: z.enum(["draft", "active", "complete"]).default("draft"),
      }),
      writable: true,
    },
  },

  client: {
    derived: {
      activePlan: (ctx) => ctx.resources.plan?.state ?? null,
    },
  },
},
```

### History windowing

`session.historyWindow` bounds how much cross-turn history each request loads:

```ts
session: {
  historyWindow: { turns: 50 },
},
```

`turns` (default 50) caps the number of recent completed turns the execution context loads per request, so per-turn cost stays flat as a conversation grows. A generator's `history` slot and `ctx.session.items.history()` see at most this many turns; a per-call `history({ limit })` narrows within the window but cannot widen it. The full session remains retrievable through the state endpoint. See [Flow-level history bounds](../advanced/generator-context.md#flow-level-history-bounds).

### Automatic resource collection

Blocks can declare resource dependencies directly (via `sessionResources`, `userResources`, `orgResources` using `defineResource()` values). When `defineFlow` is called, it collects declared resources from all action blocks and merges them into the session/user/org scope configs automatically:

```ts
const planManager = handler({
  name: "plan-manager",
  sessionResources: { plan: planResource },
  execute: async (input, ctx) => { /* uses ctx.session.resources.plan */ },
});

const myFlow = defineFlow({
  kind: "my-app",
  actions: { manage: { block: planManager } },
  // session.resources automatically includes { plan: planResource }
  // from the block — no need to declare it again here
});
```

Flow-level resource declarations take priority. If both a block and the flow declare a resource with the same name, the flow's version wins.

See [State](/docs/fundamentals/state-and-scopes) for details on scopes, resources, and the `client` block.

## Lifecycle hooks

Observe execution at both the action and request level:

```ts
// Action-level
actions: {
  chat: {
    onCompleted: async (result, ctx) => { /* action succeeded */ },
    onErrored: async (error, ctx) => { /* action failed */ },
  },
},

// Request-level
request: {
  onStarted: async (ctx) => { /* request began */ },
  onCompleted: async (ctx) => { /* request succeeded */ },
  onErrored: async (error, ctx) => { /* request failed */ },
  onFinished: async (ctx) => { /* always fires, success or failure */ },
  onStepErrored: async (error, ctx) => { /* non-terminal step failure */ },
},
```

Hooks are **observational** — they run after the fact and can't modify the result. The past-tense naming (`onCompleted`, not `onComplete`) makes this intent clear.

`request.concurrency` sets a flow-wide default concurrency policy that every action inherits unless it declares its own. See [Concurrency policies](../advanced/concurrency-policies.md).

### Block-level completion (`onCompleted`)

Individual blocks can also declare an `onCompleted` callback on their config. This is distinct from the action-level and request-level hooks shown above, which are lifecycle observers run by the request executor. A block-level `onCompleted` fires immediately after the block's `execute` succeeds:

```ts
generator({
  name: "my-gen",
  model: "intent/chat",
  prompt: "...",
  onCompleted: async (output, ctx, meta) => {
    // meta.model carries the resolved ModelIdentity (generators only)
  },
});
```

For generators, `meta` is a `GeneratorCompletedMeta` carrying `{ model: ModelIdentity }` — the concrete model that produced the output. Other block kinds receive only `(output, ctx)` with no `meta` argument. See [models — reading the resolved model at completion time](./models.md#reading-the-resolved-model-at-completion-time) for a worked example projecting the model into session state.

## Registration

Flows are registered with a server registry to be served via HTTP:

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/engine";

const registry = createFlowRegistry();
registry.register(chatFlow);
registry.register(agentFlow);

const router = createFlowApiRouter({ registry });
```

The registry discovers flows by `kind` and routes requests automatically. Multiple flows can coexist in the same server.
