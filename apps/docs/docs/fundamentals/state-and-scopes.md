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

A block declares the session-state fields it touches with `sessionStateSchema`. Inside `execute`, `ctx.session` is the read/write handle:

```ts
const tracker = handler({
  name: "tracker",
  sessionStateSchema: z.object({
    mode: z.enum(["chat", "agent"]).default("chat"),
    messageCount: z.number().default(0),
  }),
  execute: async (_input, ctx) => {
    // Read — typed from the schema
    const mode = ctx.session.state.mode;

    // Merge fields into existing state
    await ctx.session.patchState({ mode: "agent" });

    // Atomic numeric increment
    await ctx.session.incState({ messageCount: 1 });
  },
});
```

`ctx.session.state` is fully typed — the framework infers the type from your Zod schema. Reads, writes, and increments are all checked at compile time. See [Type System](/docs/fundamentals/type-system) for how this carries through blocks, sequencers, and flows.

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
  execute: async (_input, ctx) => {
    await ctx.session.incState({ messageCount: 1 });
  },
});

const modeSwitch = handler({
  name: "mode-switch",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  execute: async (_input, ctx) => {
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

But you don't have to. The flow-level schema only needs to declare fields that aren't already declared by blocks, or fields the flow itself references (like in a `client.expose` list or a `client.derived` compute function).

### Why bubbling matters

The point is **blocks shouldn't depend on flows**. A counter block that needs `messageCount` declares it on itself. A mode-switching block declares `mode`. Neither needs to know about the other.

```ts
// These blocks work in any flow — they bring their own state requirements
import { counter } from "@shared/blocks";
import { modeSwitch } from "@shared/blocks";

const pipeline = sequencer({ name: "chat" })
  .tap(counter)        // bubbles up { messageCount }
  .tap(modeSwitch)     // bubbles up { mode }
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

### Creating sessions

A new session typically starts via `sessions.createSession({...})` on the client, which returns a stable `sess_<id>` you reuse on every subsequent action call. See [Client Overview](/docs/client/overview).

If you call an action without a `sessionId`, the framework generates a fallback ID (prefix `ephemeral_<ts>_<rand>`) and persists the session record like any other. The action route doesn't return that generated ID to the client, so the session is effectively orphaned — useful for one-shot internal callers and tests, but not a way to start "real" conversations. For production conversational flows, always create the session first and pass the ID through.

## The `client` block: exposing state safely

Raw state never reaches the client. Each scope's `client` block declares the slice of state that crosses to the browser. Anything not in `client` stays on the server.

The block has two halves:

- `expose` — top-level field names that pass through verbatim. Use it for primitives that are already client-shaped.
- `derived` — named projections computed from `{ state, resources }`. Use it when the client wants a different shape (e.g. mapping a structured resource into an ID + title list).

```ts
session: {
  stateSchema: z.object({
    messageCount: z.number().default(0),
  }),
  client: {
    expose: ["messageCount"],
    derived: {
      artifactsList: (ctx) => {
        const artifacts = ctx.resources.artifacts?.state;
        return artifacts?.order.map(id => ({
          id,
          title: artifacts.byId[id]?.title ?? "Untitled",
        })) ?? [];
      },
    },
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

Internal state — intermediate processing, raw resource contents, block-private fields — stays on the server. The privacy contract is the default: a scope without a `client` block exposes nothing. Adding a new state field doesn't silently leak to the browser; you have to add it to `expose` or `derived` first.

During streaming, `state_change` and `resource_change` events signal that the client view may be stale. The client refetches the authoritative snapshot on `request.completed`.

This mirrors how resources work: a resource without a `client` config is invisible to clients (see [Resources: client access](/docs/resources/client-access)). One mental model — `client` everywhere — instead of two.

### Migrating from `clientData`

The previous shape was a flat `clientData: { name: fn }` map. It still works, with a one-time deprecation warning per scope per process; removal lands in a future minor.

```ts
// Before
session: {
  clientData: {
    messageCount: (ctx) => ctx.state.messageCount,
  },
}

// After
session: {
  client: {
    expose: ["messageCount"],
  },
}
```

Compute functions move under `client.derived`. Pure passthroughs become `expose` entries — no function needed.

Two errors `defineFlow` will reject up front:

- Setting both `client` and `clientData` on the same scope. Pick one.
- A name appearing in both `expose` and `derived`. They share a namespace.

The on-the-wire shape is unchanged: clients still read `snapshot.clientData.<scope>.<name>`. Only the input syntax changed.

## The other three scopes

You'll reach for these less often than session, but each has a specific job.

**Request** is scratch space for one execution. Intermediate processing results between blocks, retry counters, temporary flags. It vanishes when the action completes.

```ts
requestStateSchema: z.object({ retryCount: z.number().default(0) })
```

Use request state when you explicitly *don't* want data to accumulate in the session. The rule of thumb: if the next request might care, use session.

**User** persists across sessions. Preferences, accumulated knowledge, personal collections — anything that should follow a user from conversation to conversation.

```ts
userStateSchema: z.object({
  preferences: z.object({
    responseStyle: z.enum(["concise", "detailed"]).default("detailed"),
  }).default({}),
})
```

User scope is shared across flows on the same server by default — every flow's user state schema is structurally compared at startup, and incompatible declarations throw `CrossFlowSchemaConflictError` from `FlowRegistry.register` before any data can be corrupted. See [Authentication](/docs/server/authentication) for the trust model and [Flow Isolation](/docs/advanced/flow-isolation) if you need to keep a flow's user state separate.

**Org** is the team-level boundary. Shared configuration, knowledge bases, settings that an admin controls for everyone. Available when the caller passes an `orgId`; `ctx.org` is `undefined` otherwise.

```ts
orgStateSchema: z.object({
  config: z.object({
    maxTokenBudget: z.number().default(100_000),
  }).default({}),
})
```

Org scope is also shared across flows by default with the same registry-time schema check as user scope. Read it inside a block with `ctx.org?.state.config` — and remember the optional chain, since `ctx.org` is `undefined` when no `orgId` was passed. Once a session is bound to an `orgId`, requests claiming a different `orgId` against that session throw `OrgBindingMismatchError` at runtime.

For the full operation reference and CAS semantics that apply to all four scopes, see [State Operations](/docs/fundamentals/state-operations). For how `userId` and `orgId` flow into a request — including who's responsible for verifying them — see [Authentication](/docs/server/authentication).

## Why four scopes?

Two scopes would force you to choose between "per-request" and "everything else." Six would create unnecessary ceremony. Four maps cleanly to the real boundaries:

- **Request** — scratch space that doesn't pollute the conversation.
- **Session** — the conversational memory.
- **User** — what follows a person across conversations.
- **Org** — what a team shares.

## When to declare state at the flow level

In practice, most state declarations live on blocks, not flows. A counter block declares `messageCount`, a mode-switcher declares `mode`, and the flow picks them up by bubbling. You don't need to repeat them on `defineFlow`.

Reach for flow-level `session.stateSchema` (or `user`, `org`) when:

- You write a `client.derived` compute function that reads the field — the compute function lives on the flow config, so the field has to be visible there.
- You want one place to see the canonical schema for code review or onboarding.
- A field doesn't belong to any one block (rare).

A typical flow ends up looking closer to this:

```ts
const myFlow = defineFlow({
  kind: "team-assistant",
  session: {
    // Declared at the flow level so the client block below sees it typed.
    stateSchema: z.object({
      messageCount: z.number().default(0),
    }),
    client: {
      expose: ["messageCount"],
    },
  },
  actions: {
    chat: {
      inputSchema: z.object({ message: z.string() }),
      block: chatPipeline,   // other state fields (mode, etc.) bubble up from blocks
    },
  },
});
```

`messageCount` is declared at the flow level because the flow itself reads it (in the `client.expose` list). Other fields — a `mode` flag a router uses, a `lastModelUsed` field a generator writes — stay declared on their blocks and merge in via bubbling. The rule of thumb: declare state at the flow level only when something on the flow config actually reads it.

## Where to next

- **[State Operations](/docs/fundamentals/state-operations)** — full operation reference: every helper, CAS semantics, version handling, `ConcurrentModificationError`.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state via `targetStateSchemas` and `ctx.getTarget()`.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to a sequencer's execution rather than identity, with a different durability boundary.
- **[Resources](/docs/resources/overview)** — typed containers for structured data and rich content, with the same atomic operations as state.
- **[Authentication](/docs/server/authentication)** — how `userId` and `orgId` reach a flow execution.
