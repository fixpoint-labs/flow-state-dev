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
  sessionResources: {
    searchCache: defineResource({
      stateSchema: z.object({
        lastQuery: z.string().default(""),
        results: z.array(z.string()).default([]),
        cachedAt: z.number().default(0),
      }),
      writable: true,
    }),
  },
  execute: async (input, ctx) => {
    const cache = ctx.session.resources.searchCache;
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

## Client visibility

Scope state is never directly visible to clients. You expose it through scope-level `clientData` — computed projections that run server-side:

```ts
session: {
  clientData: {
    currentMode: (ctx) => ctx.state.mode,
  },
}
```

Resources have a second option. Instead of (or in addition to) scope-level clientData, you can declare `client` config directly on the resource. This gives the frontend lazy-loaded access to resource content and metadata through dedicated hooks and endpoints. See [Client Access](/docs/resources/client-access) for the full API.

Choose state vs resources based on the data's nature and lifecycle, not on client visibility.
