---
sidebar_position: 5
---

# State & Scopes

State in AI applications is messy. Conversation history, user preferences, shared configuration, intermediate processing data — all at different lifetimes, all needing different isolation guarantees. flow-state.dev gives you four scoped levels with typed operations, resources for structured data, and client data to control exactly what the client can see.

## Scopes overview

State is organized into four hierarchical scopes:

| Scope | Question it answers | Lifetime |
|-------|---------------------|----------|
| **Request** | What does this single action execution need right now? | One action execution |
| **Session** | What does this conversation need to remember? | Across requests in a conversation |
| **User** | What does this person need across all their conversations? | Across sessions for a user |
| **Project** | What does the team need to share? | Across users in a project |

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

Note that `ctx.session.state` is fully typed here — the framework infers types directly from your Zod schemas. You write a schema once and the input, output, state, and resources are all strongly typed throughout your `execute` function with no manual type annotations. See [Type System](/docs/fundamentals/type-system) for more on how this works across blocks, sequencers, and flows.

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

The same bubbling model applies to resources. Blocks can declare resource dependencies with `sessionResources`, `userResources`, and `projectResources` (using `defineResource()` values). Sequencers collect these from child blocks, and `defineFlow` merges them into the flow's scope configs. Flow-level declarations take priority — blocks bring defaults, flows can override. See [Blocks](/docs/fundamentals/blocks#blocks-declare-their-resources) for examples.

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

## Why four scopes?

The four scopes map to real isolation needs:

- **Request** exists because blocks need scratch space that doesn't pollute the conversation. Intermediate processing results, temporary flags, retry counters — data that's useful during execution but meaningless afterward.
- **Session** exists because conversations have memory. Chat history, the current operating mode, a plan being assembled step-by-step — data that builds up across multiple request/response cycles but belongs to one conversation.
- **User** exists because people come back. Their preferences, accumulated knowledge, personal resource collections — data that should follow them across sessions, not reset every time they start a new conversation.
- **Project** exists because teams share context. Configuration, knowledge bases, shared settings — data that multiple users need access to, not tied to any individual.

Two scopes would force you to choose between "per-request" and "everything else." Six scopes would create unnecessary ceremony. Four maps cleanly to the real boundaries in AI applications.

## Scope identity

Every scope instance has an identity — a `ScopeIdentity` that uniquely identifies it in the system:

```ts
type ScopeIdentity = {
  type: "request" | "session" | "user" | "project";
  id: string;
  userId?: string;
  projectId?: string;
};
```

- `type` — which level in the hierarchy
- `id` — the actual identifier (a request ID, session ID, user ID, or project ID depending on type)
- `userId` — the owning user (present on all scopes except project, where it records who created it)
- `projectId` — the associated project (present when a project is active)

Access the identity from any scope handle:

```ts
execute: async (input, ctx) => {
  const sessionId = ctx.session.identity.id;
  const userId = ctx.user.identity.id;
  const projectId = ctx.project?.identity.id;
}
```

### How scope IDs are determined

When a flow action is executed, the caller provides identity values:

```ts
// Client-side action call
await client.executeAction("my-flow", "chat", {
  userId: "user_abc",           // Required — who is executing
  sessionId: "sess_123",       // Optional — which conversation
  projectId: "proj_team-a",   // Optional — which project
  input: { message: "Hello" },
});
```

- **`userId`** is always required. Every flow execution is associated with a user.
- **`sessionId`** is optional. If omitted, an ephemeral session is auto-created (more on this below).
- **`projectId`** is optional. If omitted, the project scope is not available (`ctx.project` is `undefined`).

## Sessions in depth

Sessions are the primary conversational boundary — the scope where most of your state lives.

### Creating sessions

There are two ways a session comes into existence:

**Explicit sessions** — you provide a `sessionId` and the framework either loads the existing session or creates a new one:

```ts
// First request creates the session
await client.executeAction("my-flow", "chat", {
  userId: "user_abc",
  sessionId: "sess_onboarding-123",
  input: { message: "Hello" },
});

// Later requests reuse it — same session, same state, same history
await client.executeAction("my-flow", "chat", {
  userId: "user_abc",
  sessionId: "sess_onboarding-123",
  input: { message: "What were we talking about?" },
});
```

This is the standard pattern for multi-turn conversations. The client generates or tracks session IDs and passes them through.

**Ephemeral sessions** — you omit `sessionId` and the framework auto-creates one:

```ts
// No sessionId → ephemeral session auto-created
await client.executeAction("my-flow", "summarize", {
  userId: "user_abc",
  input: { text: "..." },
});
```

Ephemeral sessions get an auto-generated ID like `ephemeral_1709312400000_a3f2b1`. They're fully functional sessions — same state, same resources, same persistence — but since no one holds a reference to their ID, they're effectively one-shot. Use ephemeral sessions for stateless operations where you need session machinery (items, journal) but don't need to come back to the same conversation.

### Session capabilities

Sessions are the richest scope. Beyond state operations (which all scopes share), sessions provide:

**Items** — the accumulated output of all requests in the conversation, with audience-specific views:

```ts
// Everything in the session
const allItems = ctx.session.items.all();

// Items for the client UI (messages, status, errors — not internal block outputs)
const clientItems = ctx.session.items.client();

// Messages formatted for LLM context (async, supports token limiting)
const llmMessages = await ctx.session.items.llm({ limit: { tokens: 20_000 } });
```

**Journal** — an append-only log for session-level notes and events:

```ts
await ctx.session.appendJournal({
  text: "User switched to agent mode",
  source: "mode-router",
  tags: ["mode-change"],
});

const recentEntries = await ctx.session.getJournal({ limit: 10 });
```

**Resources** — named typed containers for structured data and rich content:

```ts
const artifacts = ctx.session.resources.get("artifacts");
const doc = artifacts.state.byId["design-doc"];
```

### Multiple sessions per user

A single user can have many active sessions. This is the expected pattern — one session per conversation thread, per workflow instance, or per task. A coding assistant might have separate sessions for different projects. A support agent might have one session per ticket.

The user scope (covered below) is what ties them together — preferences and accumulated knowledge that follow the user across all their sessions.

## Request scope

Request scope is the most constrained: it exists for exactly one action execution, then it's done.

```ts
const processor = handler({
  name: "processor",
  requestStateSchema: z.object({
    retryCount: z.number().default(0),
    intermediateResult: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    // Scratch space for this execution only
    await ctx.request.patchState({ intermediateResult: "step-1-done" });

    // This state won't exist in the next request
    return { result: ctx.request.state.intermediateResult };
  },
});
```

### When to use request state vs session state

Use **request state** for:
- Intermediate processing results between blocks in a sequencer
- Retry counters and execution metadata
- Temporary flags that control block behavior within a single action
- Data you explicitly don't want to accumulate in the session

Use **session state** for:
- Anything the next request might need
- Conversation mode, counters, accumulated context
- Data that represents the conversation's current state

The rule of thumb: if it matters after the action completes, it belongs in session state. If it's scratch work, use request state.

## User scope

User scope persists across sessions — it's everything that follows a person from conversation to conversation.

### Providing user identity

The `userId` is provided by the caller on every action execution. In Phase 1, user context is **required** — you cannot execute a flow without a `userId`.

```ts
await client.executeAction("my-flow", "chat", {
  userId: "user_abc",   // Required — execution fails without this
  sessionId: "sess_1",
  input: { message: "Hello" },
});
```

The framework creates a user record on first encounter and loads it on subsequent requests. The same user record is shared across all of that user's sessions.

### Real patterns for user scope

**Preferences that follow across conversations:**

```ts
const myFlow = defineFlow({
  kind: "assistant",
  user: {
    stateSchema: z.object({
      preferences: z.object({
        responseStyle: z.enum(["concise", "detailed", "technical"]).default("detailed"),
        preferredModel: z.string().default("gpt-5-mini"),
        codeStyle: z.object({
          language: z.string().default("typescript"),
          framework: z.string().optional(),
        }).default({}),
      }).default({}),
    }),
  },
});

// In a block — reads preferences regardless of which session:
execute: async (input, ctx) => {
  const style = ctx.user.state.preferences.responseStyle;
  // Use this to configure model behavior, response formatting, etc.
}
```

**Accumulated knowledge and memories:**

```ts
user: {
  stateSchema: z.object({
    facts: z.array(z.object({
      text: z.string(),
      source: z.string(),
      addedAt: z.number(),
    })).default([]),
    expertise: z.array(z.string()).default([]),
  }),
}

// In a block — accumulate facts across conversations:
execute: async (input, ctx) => {
  if (learnedSomethingNew) {
    await ctx.user.pushState("facts", {
      text: "User prefers functional patterns over OOP",
      source: ctx.session.identity.id,
      addedAt: Date.now(),
    });
  }

  // In any future session, these facts are available:
  const knownFacts = ctx.user.state.facts;
}
```

**Personal resource collections:**

```ts
user: {
  resources: {
    snippets: {
      stateSchema: z.object({
        byId: z.record(z.object({
          title: z.string(),
          code: z.string(),
          language: z.string(),
          savedAt: z.number(),
        })).default({}),
      }),
      writable: true,
    },
  },
}

// User saves a snippet in one session, uses it in another:
const snippets = ctx.user.resources.get("snippets");
await snippets.patchState({
  byId: {
    ...snippets.state.byId,
    "auth-helper": {
      title: "JWT Auth Middleware",
      code: "export function authMiddleware...",
      language: "typescript",
      savedAt: Date.now(),
    },
  },
});
```

## Project scope

Project scope is shared across users — the team-level boundary for configuration, knowledge, and shared resources.

### Providing project identity

The `projectId` is optional. When provided, the framework creates or loads the project record and makes `ctx.project` available:

```ts
await client.executeAction("my-flow", "chat", {
  userId: "user_abc",
  projectId: "proj_team-a",   // Optional — enables project scope
  input: { message: "Hello" },
});
```

When `projectId` is omitted, `ctx.project` is `undefined`. Blocks that depend on project state should handle this:

```ts
execute: async (input, ctx) => {
  const teamConfig = ctx.project?.state.config;
  if (!teamConfig) {
    // Fall back to user-level or default configuration
  }
}
```

### Real patterns for project scope

**Shared configuration:**

```ts
const myFlow = defineFlow({
  kind: "team-assistant",
  project: {
    stateSchema: z.object({
      config: z.object({
        allowedModels: z.array(z.string()).default(["gpt-5-mini"]),
        maxTokenBudget: z.number().default(100_000),
        customInstructions: z.string().default(""),
        features: z.object({
          codeExecution: z.boolean().default(false),
          webSearch: z.boolean().default(true),
        }).default({}),
      }).default({}),
    }),
  },
});

// Any user in the project sees the same configuration:
execute: async (input, ctx) => {
  const budget = ctx.project?.state.config.maxTokenBudget ?? 100_000;
  const instructions = ctx.project?.state.config.customInstructions ?? "";
}
```

**Team knowledge base:**

```ts
project: {
  resources: {
    knowledgeBase: {
      stateSchema: z.object({
        articles: z.record(z.object({
          title: z.string(),
          content: z.string(),
          author: z.string(),
          updatedAt: z.number(),
          tags: z.array(z.string()),
        })).default({}),
        index: z.array(z.string()).default([]),
      }),
      writable: true,
    },
  },
}

// Any team member can contribute to and read from the knowledge base:
const kb = ctx.project?.resources?.get("knowledgeBase");
if (kb) {
  await kb.patchState({
    articles: {
      ...kb.state.articles,
      "api-conventions": {
        title: "API Naming Conventions",
        content: "All endpoints follow REST conventions...",
        author: ctx.user.identity.id,
        updatedAt: Date.now(),
        tags: ["api", "conventions"],
      },
    },
    index: [...kb.state.index, "api-conventions"],
  });
}
```

**Project-wide settings that override user defaults:**

```ts
execute: async (input, ctx) => {
  // Project config takes precedence over user preferences
  const model = ctx.project?.state.config.allowedModels?.[0]
    ?? ctx.user.state.preferences.preferredModel
    ?? "gpt-5-mini";
}
```

### When to use project scope vs user scope

Use **project scope** when multiple users need to read or write the same data — configuration that applies to the whole team, shared knowledge that anyone can contribute to, settings that an admin controls for everyone.

Use **user scope** when the data belongs to one person — their preferences, their saved items, their accumulated context. Even if it *looks* shared (like "preferred model"), if each user should have their own value, it's user scope.

## Sequencer scope

The four persistence scopes above (request, session, user, project) are tied to identity — who's calling, which conversation, which project. Sequencer scope is different: it's tied to **execution structure**. When blocks run inside a sequencer, they can share state scoped to that sequencer instance.

### Why sequencer scope exists

Consider a multi-step pipeline: a planner block produces a plan, then a series of executor blocks carry it out. The plan isn't session state — it doesn't need to persist after the pipeline finishes. It isn't request state — it needs to be shared across the blocks in the sequence. Sequencer scope gives you a shared workspace for blocks that are designed to run together.

### Declaring sequencer state

A sequencer declares its instance state with `stateSchema`:

```ts
const pipeline = sequencer({
  name: "research-pipeline",
  inputSchema: z.string(),
  stateSchema: z.object({
    plan: z.array(z.string()).default([]),
    currentStep: z.number().default(0),
    findings: z.record(z.string()).default({}),
  }),
});
```

Each time this sequencer executes, it gets a fresh state container initialized from the schema defaults. The state lives for the duration of that sequencer's execution — it's not persisted to any store.

### Accessing sequencer state from blocks

Blocks inside the sequencer access it via `ctx.sequencer`:

```ts
const planner = handler({
  name: "planner",
  sequencerStateSchema: z.object({
    plan: z.array(z.string()),
    currentStep: z.number(),
  }),
  execute: async (input, ctx) => {
    // Write the plan into sequencer state for downstream blocks
    await ctx.sequencer!.patchState({
      plan: ["search", "analyze", "summarize"],
      currentStep: 0,
    });
    return input;
  },
});

const executor = handler({
  name: "executor",
  sequencerStateSchema: z.object({
    currentStep: z.number(),
    findings: z.record(z.string()),
  }),
  execute: async (input, ctx) => {
    const step = ctx.sequencer!.state.currentStep;

    // Do work, then record findings and advance
    await ctx.sequencer!.patchState({
      findings: { [`step-${step}`]: "result..." },
    });
    await ctx.sequencer!.incState({ currentStep: 1 });
    return input;
  },
});

const researchPipeline = pipeline
  .then(planner)
  .then(executor)
  .then(executor);
```

The `sequencerStateSchema` on each block declares what state shape it expects from its enclosing sequencer. Like session/user/project state schemas, these bubble up and merge — the framework catches conflicts at build time.

`ctx.sequencer` resolves to the **nearest enclosing sequencer** that declares a `stateSchema`. If the block isn't inside a sequencer (or the sequencer has no state schema), `ctx.sequencer` is `undefined`.

### Finding blocks with `getTarget`

Sequencer scope enables another pattern: blocks finding and reading state from specific siblings or ancestors by name. The `ctx.getTarget(name)` method returns a `TargetRef` for the named block:

```ts
execute: async (input, ctx) => {
  // Find a previously-executed sibling or ancestor by name
  const plannerResult = ctx.getTarget<{ plan: string[] }>("planner");

  if (plannerResult) {
    const plan = plannerResult.state.plan;
    // Can also mutate the target's state
    await plannerResult.patchState({ plan: [...plan, "extra-step"] });
  }
}
```

`getTarget` resolves nearest-first in two passes:

1. **Siblings first** — already-dispatched blocks at the current execution level, most-recent dispatch wins. This is how a later block in a sequencer finds an earlier one.
2. **Ancestors second** — walks up the parent execution chain. This is how a deeply nested block finds an enclosing sequencer or a block from an outer sequence.

Returns `undefined` if no block with that name is found. Throws `AmbiguousBlockNameError` if multiple ancestors share the same name — this forces you to be explicit about which block you mean.

A `TargetRef` provides the same state operations as other scopes (`patchState`, `setState`, `incState`, `pushState`, etc.), but only if the target block has a `stateSchema`. Calling state operations on a target without state throws an error.

## Scope hierarchy and resolution

The persistence scopes form a hierarchy based on lifetime and sharing:

```
request → session → user → project
  (narrowest)                (broadest)
```

"Higher" means broader lifetime and wider sharing. Request is the narrowest — one execution, one user, gone when done. Project is the broadest — persists indefinitely, shared across users.

Sequencer scope is orthogonal to this hierarchy — it's scoped to execution structure rather than identity, and exists only for the duration of a sequencer's execution.

### How blocks access scopes

Every block receives all available scopes through its context:

```ts
execute: async (input, ctx) => {
  ctx.request    // Always available — RequestScopeHandle
  ctx.session    // Always available — SessionScopeHandle
  ctx.user       // Always available — UserScopeHandle
  ctx.project    // Optional — ProjectScopeHandle | undefined
  ctx.sequencer  // Optional — TargetRef | undefined (when inside a sequencer with stateSchema)

  ctx.getTarget("block-name")  // Find sibling/ancestor by name — TargetRef | undefined
}
```

Request, session, and user are always present (userId is required, sessions auto-create). Project is present only when a `projectId` was provided. Sequencer is present only when the block is executing inside a sequencer that declares state.

### Scope capability differences

Not all scopes are equal in what they offer:

| Capability | Request | Session | User | Project | Sequencer |
|-----------|---------|---------|------|---------|-----------|
| State (read/write) | Yes | Yes | Yes | Yes | Yes |
| Resources | — | Yes | Yes | Optional | — |
| Items (conversation history) | — | Yes | — | — | — |
| Journal (append-only log) | — | Yes | — | — | — |
| Identity | Yes | Yes | Yes | Yes | — |
| Persisted | Yes | Yes | Yes | Yes | No |

Session is the richest scope because it's the conversational boundary — it accumulates items and provides audience-specific views for both the client and the LLM. Sequencer scope is the lightest — just state, no persistence, no identity.

### Resolution pattern

A common pattern is resolving values by walking up the scope hierarchy — check the narrowest scope first, fall back to broader scopes:

```ts
execute: async (input, ctx) => {
  // Request override → session setting → user preference → project default
  const model =
    ctx.request.state.modelOverride ??
    ctx.session.state.currentModel ??
    ctx.user.state.preferences.preferredModel ??
    ctx.project?.state.config.defaultModel ??
    "gpt-5-mini";
}
```

This lets you set sensible defaults at the project level, let users override with their preferences, let sessions customize further, and let individual requests override everything.

## Putting it together

Here's a flow that uses all four scopes with clear purpose for each:

```ts
const teamAssistant = defineFlow({
  kind: "team-assistant",
  request: {
    stateSchema: z.object({
      processingStage: z.string().optional(),
    }),
  },
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "agent", "review"]).default("chat"),
      messageCount: z.number().default(0),
    }),
  },
  user: {
    stateSchema: z.object({
      preferences: z.object({
        responseStyle: z.enum(["concise", "detailed"]).default("detailed"),
      }).default({}),
      recentTopics: z.array(z.string()).default([]),
    }),
  },
  project: {
    stateSchema: z.object({
      config: z.object({
        systemPrompt: z.string().default("You are a helpful assistant."),
        maxTokens: z.number().default(4096),
      }).default({}),
    }),
  },
  actions: {
    chat: {
      steps: chatPipeline,   // sequencer that uses all four scopes
    },
  },
});
```

Each scope carries exactly the data appropriate for its lifetime:

- **Request**: `processingStage` — scratch data for this execution, gone when it completes
- **Session**: `mode`, `messageCount` — conversational state that persists across turns
- **User**: `preferences`, `recentTopics` — personal data that follows the user to new sessions
- **Project**: `config` — team settings shared by everyone
