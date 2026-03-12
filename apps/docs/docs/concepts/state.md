---
sidebar_position: 4
---

# State Management

State in AI applications is messy. Conversation history, user preferences, shared configuration, intermediate processing data — all at different lifetimes, all needing different isolation guarantees. flow-state.dev gives you four scoped levels with typed operations, resources for structured data, and client data to control exactly what the client can see.

## Scopes

State is organized into four hierarchical scopes:

| Scope | Lifetime | Example |
|-------|----------|---------|
| **Request** | Single action execution | Temporary processing data, intermediate results |
| **Session** | Across requests in a conversation | Chat history, current mode, plan state, counters |
| **User** | Across sessions for a user | Preferences, accumulated knowledge, model choices |
| **Project** | Across users in a project | Shared configuration, global data |

Each scope has its own state, resources, and client data. Most of your state lives at the session level.

## State operations

Every scope provides the same set of atomic operations via the block context:

```ts
execute: async (input, ctx) => {
  // Read state — always available, always typed
  const mode = ctx.session.state.mode;

  // Patch — merge fields into existing state
  await ctx.session.patchState({ mode: "agent" });

  // Replace — overwrite the entire state
  await ctx.session.setState({ mode: "chat", count: 0 });

  // Increment — atomic numeric increment
  await ctx.session.incState({ messageCount: 1 });

  // Push — append to array fields
  await ctx.session.pushState({ history: newEntry });

  // Functional update — read-modify-write with CAS safety
  await ctx.session.updateState((current) => ({
    ...current,
    processedAt: Date.now(),
  }));
}
```

All operations use **CAS (Compare-and-Swap)** semantics — if two blocks try to update the same state concurrently, one will automatically retry. No lost writes.

## Defining state schemas

State schemas are declared at the flow level:

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
        preferredModel: z.string().default("gpt-5-mini"),
      }).default({}),
    }),
  },
});
```

**Partial schemas** are the key pattern: each block declares only the state fields it needs, not the full flow-level schema. A counter block that only touches `messageCount` doesn't need to know about `mode`:

```ts
const counter = handler({
  name: "counter",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    // ctx.session.state is typed as { messageCount: number } — inferred from the schema
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});
```

Note that `ctx.session.state` is fully typed here — the framework infers types directly from your Zod schemas. You write a schema once and the input, output, state, and resources are all strongly typed throughout your `execute` function with no manual type annotations. See [Type System](/docs/concepts/type-system) for more on how this works across blocks, sequencers, and flows.

This keeps blocks reusable and self-documenting about their dependencies.

## State bubbling

Here's the powerful part: you don't have to define every state field at the flow level. When a flow is constructed, block-level state declarations **bubble up** and merge into the flow's combined schema automatically.

Say you have two blocks, each declaring the session state they need:

```ts
const counter = handler({
  name: "counter",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
    return input;
  },
});

const modeSwitch = handler({
  name: "mode-switch",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: "agent" });
    return input;
  },
});
```

When these blocks are composed into a flow, their state declarations are collected and merged. The flow ends up with a combined session state of `{ messageCount: number, mode: "chat" | "agent" }` — without you having to repeat those fields in a flow-level `stateSchema`.

You *can* still define a flow-level schema if you want one clean place to see everything:

```ts
defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
      mode: z.enum(["chat", "agent"]).default("chat"),
    }),
  },
  // ...
});
```

But you don't have to. The flow-level schema only needs to define fields that aren't already declared by blocks — or fields that the flow configuration itself references (like in `clientData` compute functions).

### Why this matters

The point is **blocks shouldn't depend on flows**. A counter block that needs `messageCount` declares it on itself. A mode-switching block declares `mode`. Neither needs to know about the other's state. Neither is coupled to a specific flow definition.

This is what makes blocks truly portable:

```ts
// These blocks work in any flow — they bring their own state requirements
import { counter } from "@shared/blocks";
import { modeSwitch } from "@shared/blocks";

const pipeline = sequencer({ name: "chat" })
  .then(counter)       // bubbles up { messageCount }
  .then(modeSwitch)    // bubbles up { mode }
  .then(agent);
```

### Conflicts

If two blocks declare the same field with incompatible types, the framework catches it as a type error during flow construction. This means schema conflicts surface early — at build time, not at runtime.

For shared blocks used across codebases, the recommended practice is to namespace state fields (e.g., `analytics_eventCount` instead of `count`) to avoid collisions. Within a single codebase, consistent naming conventions are usually enough.

### Resource declarations bubble too

The same bubbling model applies to resources. Blocks can declare resource dependencies with `sessionResources`, `userResources`, and `projectResources` (using `defineResource()` values). Sequencers collect these from child blocks, and `defineFlow` merges them into the flow's scope configs. Flow-level declarations take priority — blocks bring defaults, flows can override. See [Blocks](/docs/concepts/blocks#blocks-declare-their-resources) for examples.

## Resources — hybrid memory and filesystem

Resources are more than key-value stores. Each resource combines **rich text content** with **structured atomic state** — think of them as files that carry metadata. This hybrid model gives your AI a persistent, typed workspace.

Consider an artifacts resource: each artifact has a `content` field (the "file" — a document, code snippet, plan, or any rich text) alongside structured fields like `title`, `tags`, and `updatedAt` (the "metadata"). Both live in the same typed container with the same atomic operations:

```ts
session: {
  resources: {
    artifacts: {
      stateSchema: z.object({
        byId: z.record(z.object({
          title: z.string(),
          content: z.string(),              // The "file" — rich text content
          tags: z.array(z.string()),         // Structured metadata
          updatedAt: z.number(),             // Structured metadata
        })).default({}),
        order: z.array(z.string()).default([]),
      }),
      writable: true,
    },
  },
}
```

Access resources through scope handles — they have the same atomic operations as state:

```ts
const artifacts = ctx.session.resources.get("artifacts");

// Read content and metadata together
const doc = artifacts.state.byId["design-doc"];
console.log(doc.content);  // The full document text
console.log(doc.tags);     // ["architecture", "v2"]

// Write with atomic state operations
await artifacts.patchState({
  byId: {
    "design-doc": {
      title: "Design Doc v2",
      content: "# Architecture\n\nThe system is composed of...",
      tags: ["architecture", "v2"],
      updatedAt: Date.now(),
    },
  },
  order: [...artifacts.state.order, "design-doc"],
});
```

Resources are scoped — session-level resources persist across requests in a conversation, user-level resources persist across sessions, project-level resources are shared across users. This gives you a natural hierarchy: scratch artifacts in a session, personal notes per user, shared knowledge bases per project.

## Client Data

Client data entries are derived values computed from state and resources. They're the mechanism for exposing data to clients:

```ts
session: {
  clientData: {
    artifactsList: (ctx) => {
      const artifacts = ctx.resources.artifacts?.state;
      return artifacts?.order.map(id => ({
        id,
        title: artifacts.byId[id]?.title ?? "Untitled",
      })) ?? [];
    },
    messageCount: (ctx) => ctx.state.messageCount ?? 0,
  },
}
```

On the client, read client data via `useClientData`:

```tsx
const data = useClientData(session, {
  session: ["artifactsList", "messageCount"],
  user: ["preferences"],
});
// data.session?.artifactsList → [{ id: "doc-1", title: "Design Doc" }]
```

## Why clientData matters

Raw state never reaches the client. The state snapshot endpoint returns clientData grouped by scope:

```json
{
  "clientData": {
    "session": { "artifactsList": [...], "messageCount": 5 },
    "user": { "preferences": { "theme": "dark" } }
  }
}
```

This is a deliberate architectural choice. Internal state — intermediate processing data, raw resource contents, block-specific fields — stays on the server. You decide exactly what the client sees by writing `clientData` compute functions. Security by architecture, not by convention.

During streaming, `state_change` and `resource_change` events signal that clientData may be stale — the client refetches the authoritative snapshot on `request.completed`.

## Target state

Targets give a block typed access to the state of **named ancestor blocks** in the execution tree. A block running inside a sequencer can reach up and read or write the sequencer's state — without knowing exactly where in the flow it lives.

### Declaring targets

Add `targetStateSchemas` to any `handler`, `generator`, or `router` config:

```ts
const progressReporter = handler({
  name: "progress-reporter",
  inputSchema: z.object({ step: z.number() }),
  outputSchema: z.number(),
  targetStateSchemas: {
    research: z.object({ progress: z.number() }),
  },
  execute: async (input, ctx) => {
    // ctx.targets.research is StateRef<{ progress: number }> | undefined
    await ctx.targets.research?.patchState({ progress: input.step });
    return input.step;
  },
});
```

Each entry in `targetStateSchemas` declares:
- The **name** of the ancestor block (as registered by its `name` config field)
- The **partial state schema** this block expects to read or write on that ancestor

### Using targets

Targets are accessed via `ctx.targets.<name>`, which returns a fully-typed `StateRef | undefined`:

```ts
// Read state from a named ancestor
const progress = ctx.targets.research?.state.progress ?? 0;

// Write state to a named ancestor
await ctx.targets.research?.patchState({ progress: 75 });
await ctx.targets.research?.incState({ progress: 1 });
```

All target handles are `| undefined` — if the block runs outside the expected topology (e.g. in a test or a different flow), the ancestor may not exist. Guard all target access with `?.`.

### Targets vs `ctx.sequencer`

| | `ctx.sequencer` | `ctx.targets.name` |
|---|---|---|
| **What it points to** | Nearest enclosing sequencer | Specific named ancestor |
| **Typing** | Inferred from sequencer's `sessionStateSchema` | Inferred from `targetStateSchemas` entry |
| **Use case** | Access the direct parent pipeline | Cross-sequencer coordination |

Use `ctx.targets` when a block needs to communicate with a *specific* ancestor — for example, a leaf handler updating progress on an outer research sequencer that wraps a whole pipeline.

### Dynamic / untyped access

When you don't know the target name at compile time, use `ctx.getTarget`:

```ts
// getTarget is a complementary escape hatch — not deprecated
const dynamic = ctx.getTarget<{ progress: number }>("some-block");
await dynamic?.patchState({ progress: 50 });
```

`getTarget` accepts an optional type parameter for ergonomic casting. For well-known relationships, prefer `targetStateSchemas` for the typed inference and self-documentation it provides.
