---
sidebar_position: 5
---

# Scopes

State in AI applications lives at different lifetimes and different isolation boundaries. A single request's scratch data shouldn't pollute a long-running conversation. A user's preferences shouldn't leak to other users. Shared project configuration shouldn't be tied to one session.

Scopes solve this by giving you four distinct levels — **request**, **session**, **user**, and **project** — each with its own lifetime, persistence behavior, and sharing boundary. The [State Management](/docs/concepts/state) page covers the operations API. This page is about *why* scopes exist, how they relate to each other, and how to work with them in practice.

## Why four scopes?

Each scope answers a different question:

| Scope | Question it answers | Lifetime |
|-------|---------------------|----------|
| **Request** | What does this single action execution need right now? | One action execution |
| **Session** | What does this conversation need to remember? | Across requests in a conversation |
| **User** | What does this person need across all their conversations? | Across sessions for a user |
| **Project** | What does the team need to share? | Across users in a project |

These aren't arbitrary layers. They map to real isolation needs:

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

Sequencer scope enables another pattern: blocks finding and reading state from specific siblings or ancestors by name. The `ctx.getTarget(name)` method returns a `TargetHandle` for the named block:

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

A `TargetHandle` provides the same state operations as other scopes (`patchState`, `setState`, `incState`, `pushState`, etc.), but only if the target block has a `stateSchema`. Calling state operations on a target without state throws an error.

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
  ctx.sequencer  // Optional — TargetHandle | undefined (when inside a sequencer with stateSchema)

  ctx.getTarget("block-name")  // Find sibling/ancestor by name — TargetHandle | undefined
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

For state operations, CAS concurrency, resources, projections, and schema bubbling, see [State Management](/docs/concepts/state).
