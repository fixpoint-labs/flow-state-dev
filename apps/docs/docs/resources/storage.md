---
sidebar_position: 2
---

# State vs Resources

You have two ways to store data in flow-state.dev: **scope state** and **resources**. Both live on the same scopes (session, user, org), both use atomic operations, and both are invisible to clients without `clientData`. They serve different purposes.

## Scope state

A flat, typed object on each scope. Blocks read and write fields directly:

```ts
const modeSwitch = handler({
  name: "mode-switch",
  sessionStateSchema: z.object({ mode: z.enum(["chat", "agent"]).default("chat") }),
  execute: async (_input, ctx) => {
    await ctx.session.patchState({ mode: "agent" });
  },
});
```

Good for: mode flags, counters, configuration values, status indicators. Values that are flat, shared across blocks, and don't need their own identity.

## Resources

Named, schema-typed containers attached to a scope. Each carries its own state and optionally content:

```ts
import { defineFlow, defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const planResource = defineResource({
  scope: "session",
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
  }),
  writable: true,
});

defineFlow({
  kind: "planner",
  resources: { plan: planResource },
  session: {
    stateSchema: z.object({
      mode: z.enum(["chat", "agent"]).default("chat"),
    }),
  },
  actions: { /* ... */ },
});
```

Good for: artifacts, documents, knowledge entries, configuration bundles. Data that has its own identity, structure, and lifecycle. If you'd naturally think of it as a named object rather than a field, it's a resource.

For dynamic collections where the instance count isn't known ahead of time, see [Resource Collections](/docs/resources/collections).

## Decision table

| Signal | Scope state | Resource |
|--------|------------|----------|
| Simple scalar or enum | Yes | |
| Counter or flag | Yes | |
| Has content + metadata | | Yes |
| Needs its own identity/name | | Yes |
| Complex nested structure | | Yes |
| Dynamic collection (unknown count) | | [Collection](/docs/resources/collections) |

## Shared vs block-private

State schema fields **bubble up** into the flow's combined state. Every field name is globally shared within a flow. Two blocks declaring `{ status: z.string() }` and `{ status: z.number() }` will conflict at build time.

Resources don't have this problem. Each is accessed by name through the registry, so two resources can each have a `status` field without collision.

This matters most for block-private scratch data. If a block needs a cache or intermediate results that other blocks shouldn't touch, use a resource:

```ts
const search = handler({
  name: "search",
  resources: {
    searchCache: defineResource({
      scope: "session",
      stateSchema: z.object({
        lastQuery: z.string().default(""),
        results: z.array(z.string()).default([]),
        cachedAt: z.number().default(0),
      }),
      writable: true,
    }),
  },
  execute: async (input, ctx) => {
    const cache = ctx.resources.searchCache;
    if (cache.state.lastQuery === input.query && Date.now() - cache.state.cachedAt < 60_000) {
      return { results: cache.state.results };
    }
    const results = await performSearch(input.query);
    await cache.setState({ lastQuery: input.query, results, cachedAt: Date.now() });
    return { results };
  },
});
```

Quick rules:
- **Multiple blocks need it?** Scope state with a specific field name
- **One block uses it, generic name?** Resource (avoids collisions)
- **One block, specific name?** Either works. Scope state is simpler

## Choosing the right scope

| Question | Session | User | Org |
|----------|---------|------|-----|
| Belongs to this conversation? | Yes | | |
| Survives across conversations? | | Yes | |
| Personal to one user? | | Yes | |
| Shared across users? | | | Yes |
| Temporary working data? | Yes | | |

### Session scope and background work

Background work runs in a session of its own, hanging off the conversation that started it. Each session has its own session scope, so a session-scoped resource in a child session is a different resource from the one in the conversation, holding whatever the child put in it.

To give a session-scoped resource one identity across a conversation and every session dispatched under it, mark it `sharedToLineage`:

```ts
const board = defineResource({
  scope: "session",
  sharedToLineage: true,
  ref: "board",
  stateSchema: z.object({
    items: z.array(z.string()).default([]),
  }),
});
```

Both sides reach it through the ordinary resource API, `ctx.resources.board`, and read and write the same rows. There is no separate call for the parent's copy — there is one copy. Children nest, and the resource follows the whole chain: a session dispatched by a child resolves the same resource as the conversation at the top.

The flag applies to collections too, and to session scope only. On a user- or org-scoped resource it's rejected when the flow is built, since those scopes already span every session the same user touches.

What it won't do:

**Share scope state.** Session state stays private to each session whether or not a resource beside it is shared. Hand state over as input when the work starts, or put it in a shared resource.

**Serialize writes.** Two sessions writing one shared resource is ordinary concurrent access. Nothing queues or orders them, so fence it yourself if the writes can collide.

**Reach sideways.** Sharing runs down one chain. Two conversations, and the sessions dispatched under each, hold separate resources.

## Client visibility

Scope state is never directly visible to clients. You expose it through each scope's `client` block — `expose` for verbatim fields, `derived` for computed projections (the latter runs server-side):

```ts
session: {
  stateSchema: z.object({ mode: z.string() }),
  client: {
    derived: {
      currentMode: (ctx) => ctx.state.mode,
    },
  },
}
```

This is the same shape resources already use. Scope-level `client.derived` mirrors resource-level `client.data` — one mental model for "what does the client see" everywhere. Resources additionally support `client.content` for lazy-loaded content access through dedicated hooks and endpoints; see [Client Access](/docs/resources/client-access) for the full API.

Choose state vs resources based on the data's nature and lifecycle, not on client visibility.
