---
sidebar_position: 5
---

# State & Scopes

State in AI applications is messy. Conversation history, user preferences, shared configuration, intermediate processing data — all at different lifetimes, all needing different isolation guarantees. flow-state.dev gives you four scoped levels with typed operations.

This page walks through the scopes and the basic patterns you'll use every day. For the full operation reference (CAS semantics, error handling, every helper signature), see [State Operations](/docs/fundamentals/state-operations).

## The four scopes

State is organized into four hierarchical scopes:

| Scope | Question it answers | Lifetime |
|-------|---------------------|----------|
| **Request** | What does this single action execution need right now? | One action execution |
| **Session** | What does this conversation need to remember? | Across requests in a conversation |
| **User** | What does this person need across all their conversations? | Across sessions for a user |
| **Org** | What does the team need to share? | Across sessions in an org |

Most of your state lives at the session level. The other three matter, but they show up after you've shipped your first conversation. Start with session.

## Session: the primary scope

A session is one conversation. When a client sends a request to a flow with a `sessionId`, the framework loads that session's state, runs the action, and persists any changes. The next request with the same `sessionId` picks up where the last one left off.

```ts
const myFlow = defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "agent"]).default("chat"),
      messageCount: z.number().default(0),
    }),
  },
});
```

Inside any block, session state is read and written through `ctx.session`:

```ts
execute: async (input, ctx) => {
  // Read — typed from your schema
  const mode = ctx.session.state.mode;

  // Merge fields into existing state
  await ctx.session.patchState({ mode: "agent" });

  // Atomic numeric increment
  await ctx.session.incState({ messageCount: 1 });
}
```

`ctx.session.state` is fully typed — the framework infers the type from your Zod schema. You write the schema once and reads, writes, and increments are all checked at compile time. See [Type System](/docs/fundamentals/type-system) for how this carries through blocks, sequencers, and flows.

These three operations (`patchState`, `incState`, and the record helpers covered next) cover most of what you'll write. There are more — `setState` for full replacement, `pushState` for arrays, `atomicState` for read-modify-write — but you don't need them on day one.

### Record helpers

Sessions often hold maps of records — chat threads, saved items, anything keyed by ID. `setStateRecord` and `deleteStateRecord` work with those without you having to spread the whole map yourself:

```ts
await ctx.session.setStateRecord("byId", "doc-1", {
  title: "Design Doc",
  updatedAt: Date.now(),
});

await ctx.session.deleteStateRecord("byId", "doc-1");
```

Both go through the same atomic path as `patchState` — concurrent writes don't lose updates.

## Schema bubbling

Here's the part that makes blocks portable: you don't have to declare every state field at the flow level. When a flow is constructed, state declarations on individual blocks **bubble up** and merge into the flow's combined schema.

```ts
const counter = handler({
  name: "counter",
  sessionStateSchema: z.object({ messageCount: z.number().default(0) }),
  execute: async (input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
  },
});

const modeSwitch = handler({
  name: "mode-switch",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ mode: "agent" });
  },
});
```

When these blocks are composed into a flow, their state declarations are collected and merged. The flow ends up with a combined session state of `{ messageCount: number, mode: "chat" | "agent" }` — without you repeating those fields in a flow-level `stateSchema`.

You *can* still define a flow-level schema if you want one place to see everything:

```ts
defineFlow({
  kind: "my-app",
  session: {
    stateSchema: z.object({
      messageCount: z.number().default(0),
      mode: z.enum(["chat", "agent"]).default("chat"),
    }),
  },
});
```

But you don't have to. The flow-level schema only needs to declare fields that aren't already declared by blocks, or fields the flow itself references (like in `clientData` compute functions).

### Why bubbling matters

The point is **blocks shouldn't depend on flows**. A counter block that needs `messageCount` declares it on itself. A mode-switching block declares `mode`. Neither needs to know about the other.

```ts
// These blocks work in any flow — they bring their own state requirements
import { counter } from "@shared/blocks";
import { modeSwitch } from "@shared/blocks";

const pipeline = sequencer({ name: "chat" })
  .then(counter)       // bubbles up { messageCount }
  .then(modeSwitch)    // bubbles up { mode }
  .then(agent);
```

If two blocks declare the same field with incompatible types, the framework catches it as a type error during flow construction. Schema conflicts surface at build time, not runtime.

For shared blocks used across codebases, namespace your fields (e.g., `analytics_eventCount` instead of `count`) to avoid collisions. Within a single codebase, consistent naming is usually enough.

Resource declarations bubble too — see [Blocks](/docs/fundamentals/blocks#blocks-declare-their-resources).

## Sessions in depth

Sessions are the richest scope. Beyond state operations (which all scopes share), sessions provide:

**Items** — the accumulated output of all requests in the conversation, with audience-specific views:

```ts
const allItems = ctx.session.items.all();
const clientItems = ctx.session.items.client();
const llmMessages = await ctx.session.items.history({ limit: { tokens: 20_000 } });
```

**Metadata** — first-class `title`, `description`, and `tags` fields that live outside workflow state:

```ts
const { title, description, tags } = ctx.session.metadata;

await ctx.session.setMetadata({
  title: "Sprint planning",
  description: "Q2 kickoff",
  tags: ["planning"],
});
```

**Journal** — an append-only log for session-level notes and events:

```ts
await ctx.session.appendJournal({
  text: "User switched to agent mode",
  source: "mode-router",
});

const recent = await ctx.session.getJournal({ limit: 10 });
```

**Resources** — named typed containers for structured data and rich content. See [Resources](/docs/resources/overview).

### Ephemeral sessions

If the caller omits `sessionId`, the framework auto-creates one with an ID like `ephemeral_1709312400000_a3f2b1`. Ephemeral sessions are fully functional but one-shot — nobody holds a reference to come back to them. Use them for stateless operations where you need session machinery (items, journal) but don't need to resume.

## clientData: exposing state safely

Raw state never reaches the client. Clients see derived `clientData` entries that you compute server-side:

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

On the client, read these via `useClientData`:

```tsx
const data = useClientData(session, {
  session: ["artifactsList", "messageCount"],
  user: ["preferences"],
});
```

Internal state — intermediate processing, raw resource contents, block-private fields — stays on the server. You decide exactly what the client sees by writing `clientData` compute functions. Security by architecture, not by convention.

During streaming, `state_change` and `resource_change` events signal that clientData may be stale. The client refetches the authoritative snapshot on `request.completed`.

## The other three scopes

You'll reach for these less often than session, but each has a specific job.

**Request** is scratch space for one execution. Intermediate processing results between blocks, retry counters, temporary flags. It vanishes when the action completes.

```ts
requestStateSchema: z.object({ retryCount: z.number().default(0) })
```

Use request state when you explicitly *don't* want data to accumulate in the session. The rule of thumb: if the next request might care, use session.

**User** persists across sessions. Preferences, accumulated knowledge, personal collections — anything that should follow a user from conversation to conversation.

```ts
user: {
  stateSchema: z.object({
    preferences: z.object({
      responseStyle: z.enum(["concise", "detailed"]).default("detailed"),
    }).default({}),
  }),
}
```

User scope is shared across flows on the same server by default. See [Flow Isolation](/docs/advanced/flow-isolation) if you need to keep flows' user state separate.

**Org** is the team-level boundary. Shared configuration, knowledge bases, settings that an admin controls for everyone. Available when the caller passes an `orgId`; `ctx.org` is `undefined` otherwise.

```ts
execute: async (input, ctx) => {
  const budget = ctx.org?.state.config.maxTokenBudget ?? 100_000;
}
```

For the full operation reference and CAS semantics that apply to all four scopes, see [State Operations](/docs/fundamentals/state-operations). For how `userId` and `orgId` flow into a request, see [Authentication](/docs/server/authentication).

## Why four scopes?

Two scopes would force you to choose between "per-request" and "everything else." Six would create unnecessary ceremony. Four maps cleanly to the real boundaries:

- **Request** — scratch space that doesn't pollute the conversation.
- **Session** — the conversational memory.
- **User** — what follows a person across conversations.
- **Org** — what a team shares.

## Putting it together

A flow that uses all four scopes:

```ts
const teamAssistant = defineFlow({
  kind: "team-assistant",
  request: {
    stateSchema: z.object({ processingStage: z.string().optional() }),
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
    }),
  },
  org: {
    stateSchema: z.object({
      config: z.object({
        systemPrompt: z.string().default("You are a helpful assistant."),
      }).default({}),
    }),
  },
  actions: {
    chat: { steps: chatPipeline },
  },
});
```

Each scope carries data appropriate for its lifetime: request for scratch, session for the conversation, user for personal preferences, org for team-wide configuration.

## Where to next

- **[State Operations](/docs/fundamentals/state-operations)** — full operation reference: every helper, CAS semantics, version handling, `ConcurrentModificationError`.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state via `targetStateSchemas` and `ctx.getTarget()`.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to a sequencer's execution rather than identity, with a different durability boundary.
- **[Resources](/docs/resources/overview)** — typed containers for structured data and rich content, with the same atomic operations as state.
- **[Authentication](/docs/server/authentication)** — how `userId` and `orgId` reach a flow execution.
