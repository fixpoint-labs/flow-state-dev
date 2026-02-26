---
sidebar_position: 4
---

# State Management

Flow State Dev provides structured state management across four scope levels with typed operations, resources, and projections.

## Scopes

State is organized into four hierarchical scopes:

| Scope | Lifetime | Use For |
|-------|----------|---------|
| **Request** | Single action execution | Temporary processing data |
| **Session** | Across requests in a conversation | Chat history, current mode, plan state |
| **User** | Across sessions for a user | Preferences, accumulated knowledge |
| **Project** | Across users in a project | Shared configuration, global data |

Each scope has its own state, resources, and projections.

## State Operations

State is managed through scope handles in `BlockContext`:

```ts
execute: async (input, ctx) => {
  // Read state
  const mode = ctx.session.state.mode;

  // Patch state (merge fields)
  await ctx.session.patchState({ mode: "agent" });

  // Replace state entirely
  await ctx.session.setState({ mode: "chat", count: 0 });

  // Increment numeric fields
  await ctx.session.incState({ messageCount: 1 });

  // Push to array fields
  await ctx.session.pushState({ history: newEntry });

  // Functional update
  await ctx.session.updateState((current) => ({
    ...current,
    processedAt: Date.now(),
  }));
}
```

All state operations use **CAS (Compare-and-Swap)** semantics — concurrent updates are retried automatically to prevent lost writes.

## Defining State Schemas

State schemas are declared in the flow definition:

```ts
const myFlow = defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "agent"]).default("chat"),
      messageCount: z.number().default(0),
    }),
  },
  user: {
    stateSchema: z.object({
      preferences: z.object({
        theme: z.enum(["light", "dark"]).default("dark"),
      }).default({}),
    }),
  },
});
```

## Resources

Resources are named, schema-typed data containers attached to a scope. They're ideal for structured data that needs independent lifecycle from the main state:

```ts
session: {
  resources: {
    plan: {
      stateSchema: z.object({
        steps: z.array(z.string()).default([]),
        status: z.enum(["draft", "active", "complete"]).default("draft"),
      }),
      writable: true,
    },
  },
}
```

Access resources through scope handles:

```ts
const plan = ctx.session.resources.plan;
const steps = plan.state.steps;

await plan.patchState({ status: "active" });
```

## Projections

Projections are derived views computed from state and resources. They're the **only way** to expose values to the client:

```ts
session: {
  projections: {
    activePlan: {
      client: true,  // Visible to the client
      compute: (ctx) => ctx.session.resources.plan?.state ?? null,
    },
    messageCount: (ctx) => ctx.session.state.messageCount ?? 0,
  },
}
```

On the client side, read projections via `useProjections`:

```tsx
const projections = useProjections(session, {
  session: ["activePlan", "messageCount"],
});
// projections.session.activePlan → { steps: [...], status: "active" }
```

## Client Visibility

The client reads state through projections, not raw state. The state snapshot endpoint returns projections grouped by scope:

```json
{
  "projections": {
    "session": { "activePlan": [...], "messageCount": 5 },
    "user": { "preferences": { "theme": "dark" } }
  }
}
```

During streaming, `state_change` and `resource_change` events signal that projections may be stale — the client refetches on `request.completed`.
