---
sidebar_position: 2
---

# State Storage Decision Guide

You have two primary ways to store data in flow-state.dev: **scope state** and **resources**. Both live on the same scopes (session, user, project), both use the same atomic operations, and both are invisible to clients without clientData. But they serve different purposes and choosing the wrong one leads to either namespace collisions or unnecessary complexity.

This guide helps you decide which to use. For the mechanics of state operations, schemas, and clientData, see [State Management](/docs/fundamentals/state-and-scopes).

## Scope state vs resources

**Scope state** is a flat, typed object on each scope. Blocks read and write individual fields directly:

```ts
const modeSwitch = handler({
  name: "mode-switch",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: "agent" });
    return input;
  },
});
```

**Resources** are named, schema-typed containers attached to a scope. They're accessed by name and carry their own state:

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

### When to use scope state

Use scope state for **simple typed fields that blocks read and write directly** — mode flags, counters, configuration values, status indicators:

- `mode: "chat" | "agent"` — the current operating mode
- `messageCount: number` — a running counter
- `currentStep: string` — which step a multi-step process is on
- `temperature: number` — a user-adjustable generation parameter

These are values that are naturally flat, shared across blocks, and don't benefit from their own identity or lifecycle.

### When to use resources

Use resources when data has **its own identity, structure, and lifecycle** — when it's more like a "thing" than a "setting":

- **Artifacts** — documents, code snippets, plans that have a title, content, tags, and timestamps
- **Conversation memories** — accumulated knowledge entries that grow over time
- **File-like objects** — anything that combines content with structured metadata
- **Configuration bundles** — complex settings objects that are managed as a unit

Resource content notes:

- Content is optional (`content` or `contentFile` at definition time).
- `readContent()` returns rendered text (or `null` when no content is defined).
- `readContentRaw()` returns the stored raw body.
- LLM content access is explicit: add `readResourceContentTool()` / `writeResourceContentTool()` to a generator when needed.

The key signal: if the data has **content plus metadata**, or if you'd naturally think of it as a named object rather than a field, it belongs in a resource.

### Quick decision table

| Signal | Scope state | Resource |
|--------|------------|----------|
| Simple scalar or enum | Yes | No |
| Counter or flag | Yes | No |
| Multiple blocks read/write it | Yes | Depends |
| Has content + metadata | No | Yes |
| Needs its own identity/name | No | Yes |
| Benefits from isolation | No | Yes |
| Complex nested structure | Unlikely | Yes |

## Block-private vs shared state

Not all state needs to be shared. Some blocks need scratch space that other blocks should never touch.

### Shared state via scope state

When blocks are designed to interoperate — one block sets a mode, another reads it — use shared session state fields with consistent naming:

```ts
const modeRouter = router({
  name: "mode-router",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  route: (input, ctx) => ctx.session.state.mode === "agent" ? agentPipeline : chatPipeline,
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

Both blocks declare the same `mode` field. The framework merges these declarations via state bubbling and catches type conflicts at build time.

### Block-private state via namespaced resources

When a block needs isolated scratch space — a cache, intermediate results, or working data that shouldn't leak into the shared namespace — use a session resource namespaced to that block:

```ts
session: {
  resources: {
    searchBlock_cache: {
      stateSchema: z.object({
        lastQuery: z.string().default(""),
        results: z.array(z.string()).default([]),
        cachedAt: z.number().default(0),
      }),
      writable: true,
    },
  },
}
```

```ts
const search = handler({
  name: "search",
  execute: async (input, ctx) => {
    const cache = ctx.session.resources.searchBlock_cache;

    // Check if we can reuse cached results
    if (cache.state.lastQuery === input.query && Date.now() - cache.state.cachedAt < 60_000) {
      return { results: cache.state.results };
    }

    const results = await performSearch(input.query);
    await cache.setState({
      lastQuery: input.query,
      results,
      cachedAt: Date.now(),
    });
    return { results };
  },
});
```

Why a resource instead of a `sessionStateSchema` field? Because `sessionStateSchema` fields **bubble up** into the flow's combined state. That means every field name is globally shared within the flow. A field called `lastQuery` from a search block could collide with `lastQuery` from a different block. Resources are accessed by name through the registry, so there's no collision risk.

### Decision checklist

- **Multiple blocks need this data?** → Shared scope state
- **Only one block uses it?** → Namespaced resource
- **The field name is generic** (e.g., `cache`, `results`, `status`)? → Resource, to avoid naming collisions
- **The field name is specific** (e.g., `messageCount`, `currentMode`)? → Scope state is fine

## Resource scoping decisions

Resources live on scopes. Choosing the right scope determines the data's lifetime and visibility.

### Session resources — conversation-local data

Data that belongs to a single conversation and shouldn't outlive it:

- **Artifacts in progress** — a plan being drafted, code being generated
- **Scratch workspace** — intermediate computation results
- **Conversation-specific context** — accumulated notes about the current task

```ts
session: {
  resources: {
    artifacts: {
      stateSchema: z.object({
        byId: z.record(z.object({
          title: z.string(),
          content: z.string(),
          updatedAt: z.number(),
        })).default({}),
      }),
      writable: true,
    },
  },
}
```

### User resources — cross-session persistence

Data that belongs to a user and should carry across conversations:

- **Preferences** — style, model choices, notification settings
- **Accumulated knowledge** — things the AI has learned about this user
- **Personal notes** — user-saved content, bookmarks, snippets

```ts
user: {
  resources: {
    knowledge: {
      stateSchema: z.object({
        facts: z.array(z.object({
          text: z.string(),
          source: z.string(),
          learnedAt: z.number(),
        })).default([]),
      }),
      writable: true,
    },
  },
}
```

### Project resources — shared team data

Data shared across all users in a project:

- **Shared configuration** — project-wide settings, API keys, feature flags
- **Shared knowledge bases** — documentation, FAQs, onboarding material
- **Team state** — shared counters, usage tracking

```ts
project: {
  resources: {
    teamConfig: {
      stateSchema: z.object({
        allowedModels: z.array(z.string()).default(["gpt-5-mini"]),
        maxTokens: z.number().default(4096),
      }),
      writable: true,
    },
  },
}
```

### Quick scoping guide

| Question | Session | User | Project |
|----------|---------|------|---------|
| Does it belong to this conversation? | Yes | | |
| Should it survive across conversations? | | Yes | |
| Is it personal to one user? | | Yes | |
| Is it shared across users? | | | Yes |
| Is it temporary working data? | Yes | | |

## State bubbling implications

When a block declares `sessionStateSchema`, those fields bubble up and merge into the flow's combined schema. This is powerful for portability — blocks bring their own state requirements — but it has a key consequence: **field names are globally shared within a flow**.

```ts
// Block A declares { status: z.string() }
// Block B declares { status: z.number() }
// → Type error at flow construction time
```

Resources don't have this problem. Each resource is accessed by name through the registry, so two resources can each have a `status` field without conflict:

```ts
session: {
  resources: {
    plan: {
      stateSchema: z.object({ status: z.enum(["draft", "active"]).default("draft") }),
      writable: true,
    },
    search: {
      stateSchema: z.object({ status: z.enum(["idle", "searching"]).default("idle") }),
      writable: true,
    },
  },
}
```

**Guidelines for bubbled state fields:**
- Use descriptive, specific names: `searchStatus` not `status`, `messageCount` not `count`
- For shared blocks used across codebases, namespace fields: `analytics_eventCount`
- Within a single codebase, consistent naming conventions are usually enough
- When in doubt, use a resource — it eliminates the collision risk entirely

## clientData as the client boundary

Neither scope state nor resources are directly visible to clients. **clientData is the only way to expose data to the frontend.** This is true regardless of where the underlying data lives.

This means the state-vs-resource decision is independent of client visibility. Both require a clientData entry to reach the client:

```ts
session: {
  clientData: {
    // Deriving from scope state
    currentMode: (ctx) => ctx.state.mode,
    // Deriving from a resource
    planSteps: (ctx) => ctx.resources.plan?.state.steps ?? [],
  },
}
```

The practical implication: choose state vs resources based on the data's nature and lifecycle, not on whether it needs to reach the client. The clientData layer handles client visibility regardless.

## Putting it all together

Here's a realistic flow that uses all the patterns:

```ts
const myFlow = defineFlow({
  kind: "assistant",
  actions: {
    chat: { block: chatPipeline },
  },
  session: {
    // Scope state: simple fields shared across blocks
    stateSchema: z.object({
      mode: z.enum(["chat", "agent"]).default("chat"),
      messageCount: z.number().default(0),
    }),
    // Resources: structured data with identity
    resources: {
      artifacts: {
        stateSchema: z.object({
          byId: z.record(z.object({
            title: z.string(),
            content: z.string(),
          })).default({}),
          order: z.array(z.string()).default([]),
        }),
        writable: true,
      },
    },
    // clientData: the client boundary
    clientData: {
      mode: (ctx) => ctx.state.mode,
      artifactsList: (ctx) => {
        const arts = ctx.resources.artifacts?.state;
        return arts?.order.map(id => ({
          id,
          title: arts.byId[id]?.title ?? "Untitled",
        })) ?? [];
      },
    },
  },
  user: {
    // User-scoped resource: persists across sessions
    resources: {
      preferences: {
        stateSchema: z.object({
          theme: z.enum(["light", "dark"]).default("dark"),
          preferredModel: z.string().default("gpt-5-mini"),
        }),
        writable: true,
      },
    },
    clientData: {
      preferences: (ctx) => ctx.resources.preferences?.state ?? {},
    },
  },
});
```

**What went where and why:**
- `mode` and `messageCount` → **scope state** — simple flags that multiple blocks read/write
- `artifacts` → **session resource** — structured objects with content, identity, and lifecycle
- `preferences` → **user resource** — persists across sessions, managed as a unit
- Everything the client sees → **clientData** — the only client data channel
