---
sidebar_position: 2
---

# Flows

A **flow** is the top-level unit in Flow State Dev. It declares what actions are available, what state is managed, and how blocks execute.

## Defining a Flow

```ts
import { defineFlow, sequencer, generator } from "@flow-state-dev/core";
import { z } from "zod";

const chatFlow = defineFlow({
  kind: "my-chat",               // Unique identifier
  requireUser: true,              // Require userId on requests

  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: chatPipeline,
      userMessage: (input) => input.message,
    },
  },

  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),
  },
});

export default chatFlow({ id: "default" });
```

## Flow Type vs Flow Instance

`defineFlow()` returns a **FlowType** — a factory function. Calling it with `{ id }` creates a **FlowInstance**:

```ts
// FlowType — the factory
const chatFlow = defineFlow({ kind: "my-chat", ... });

// FlowInstance — what you register with the server
export default chatFlow({ id: "default" });
```

This separation lets you create multiple instances of the same flow type with different configurations.

## Actions

Actions are the entry points into a flow. Each action defines its input schema, the block to execute, and optional lifecycle hooks.

```ts
actions: {
  chat: {
    inputSchema: z.object({ message: z.string() }),
    block: chatPipeline,
    userMessage: (input) => input.message,

    // Lifecycle hooks
    onCompleted: async (result, ctx) => { /* ... */ },
    onErrored: async (error, ctx) => { /* ... */ },
  },

  reset: {
    inputSchema: z.object({}),
    block: resetHandler,
  },
},
```

When an action is executed:
1. Input is validated against `inputSchema`
2. Session is resolved or created
3. `userMessage` is emitted as a user message item (if defined)
4. The block executes asynchronously
5. Lifecycle hooks fire on completion or error

## Session Configuration

Flows declare session-level state, resources, and projections:

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

  projections: {
    activePlan: {
      client: true,
      compute: (ctx) => ctx.session.resources.plan?.state ?? null,
    },
  },
},
```

See [State](/docs/concepts/state) for details on scopes, resources, and projections.

## Lifecycle Hooks

Both actions and requests support lifecycle hooks:

```ts
// Action-level hooks
actions: {
  chat: {
    onCompleted: async (result, ctx) => { /* action succeeded */ },
    onErrored: async (error, ctx) => { /* action failed */ },
  },
},

// Request-level hooks
request: {
  onStarted: async (ctx) => { /* request began */ },
  onCompleted: async (ctx) => { /* request succeeded */ },
  onErrored: async (error, ctx) => { /* request failed */ },
  onFinished: async (ctx) => { /* always fires */ },
  onStepErrored: async (error, ctx) => { /* non-terminal step failure */ },
},
```

## Flow Registration

Flows are registered with a server registry to be served via HTTP:

```ts
import { createFlowRegistry, createFlowApiRouter } from "@flow-state-dev/server";

const registry = createFlowRegistry();
registry.register(chatFlow);
registry.register(agentFlow);

const router = createFlowApiRouter({ registry });
```

The registry discovers flows by `kind` and routes requests to the right flow instance.
