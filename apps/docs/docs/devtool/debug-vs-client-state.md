---
sidebar_position: 4
title: "Debug vs client state"
---

# Debug vs client state

The DevTool shows you the full server-side state of a session. Your production clients see only what you let them see. This page explains the difference and how to control it.

## Two views of the same session

There are two ways to look at a session.

Production clients (your React app, your CLI, anything calling the public API) read the session through the normal endpoints. What they get back is filtered: each resource's `client` config decides which fields ship, and collections obey `prefetchWindow` so a client only sees the items it asked for.

The DevTool talks to a different surface. It calls a privileged debug endpoint that returns the raw server-side state, ignoring `client.data` projections and `prefetchWindow` entirely. It's the same session, but the DevTool sees it the way the runtime sees it.

This is deliberate. The point of an inspector is to show you what's actually there, including the parts your clients can't reach. The point of a production client is to receive a shaped, minimal payload. The two views are useful for different reasons.

## What the debug endpoint returns

For each storage key the session touches, the debug response includes:

- The full state body (every field on the state schema)
- Content metadata
- The underlying resource definition, with its alias list
- A second copy showing the projection your `client.data` would produce

It does not apply `prefetchWindow`. Every item in every collection is listed. It does not apply `client.data` to the storage view; that projection is shown alongside the raw state, not in place of it.

The endpoint is read-only. You can't mutate state through it.

## Seeing the projection in situ

The Resources panel renders each resource's state as JSON. When the projection a client receives matches the server state — the common case, because a resource with no `client.data` / `expose` / `exclude` passes through as-is — the panel shows a single JSON tree with no tabs.

When the projection diverges from the server state, the panel shows a two-tab toggle:

- **Server**: the full server-side state, as the runtime sees it.
- **Client**: what `client.data` (or `expose` / `exclude`) actually emits to a connected client. This is what your React hook will receive.

A small example. Suppose your state has five fields: `title`, `body`, `internalNotes`, `draftHistory`, `updatedAt`. Your `client` config exposes only two:

```ts
defineResource({
  stateSchema: z.object({
    title: z.string(),
    body: z.string(),
    internalNotes: z.string(),
    draftHistory: z.array(z.string()),
    updatedAt: z.number(),
  }),
  client: {
    expose: ["title", "updatedAt"],
  },
});
```

The two-tab toggle appears because the projection drops fields. Server shows all five fields; Client shows only `title` and `updatedAt`. Switching between them confirms what your production client will and won't receive.

## The "0/n items" trap

A common source of confusion: the DevTool shows a collection with N items, but your React app's `useResourceCollection` hook returns 0.

Picture a trading-desk app. The flow maintains an `orders` collection. The DevTool's Resources panel shows 47 orders sitting in state. The frontend renders an empty list and a "no orders yet" placeholder.

What happened: the collection has no `client.state.read: true` and no `prefetchWindow`. The server holds all 47. The client snapshot carries only the collection's `count` and the (empty) prefetched window. From the React hook's perspective, there's nothing to render.

Two ways to fix it:

1. **Declare client config so the items ship.** Add `client: { state: { read: true }, expose: [...] }` and either set `prefetchWindow: 50` for inline rendering or call `useResourceCollectionList` to page through them on demand.
2. **Accept the gap by design.** If the collection is internal state (scratch space the flow uses but the UI shouldn't see), leave it alone. The DevTool will keep showing it; the client will keep ignoring it. That's the contract working as intended.

The Server/Client toggle tells you which one you're in. If the Client tab is empty but Server is full, the projection is dropping everything. That's either a config gap (case 1) or a deliberate choice (case 2).

## When client.data is missing or throws

`client.data` is a user-supplied function, and `client.state.read` is a collection-level gate. The panel handles each case:

- **No projection declared.** The resource has no `client.data` / `expose` / `exclude`. The runtime ships state as identity, so the panel renders a single JSON tree — no tabs, because Server and Client are the same.
- **`client.state.read: false` on a collection.** State is gated off entirely. The panel renders the two-tab toggle, and the Client tab carries a notice that production clients cannot read this resource's state. Set `client.state.read: true` to lift the gate.
- **`client.data` threw.** The projection ran and raised. The panel shows the error message in place of the Client tab. Common cause: the projection assumes a field that doesn't exist yet on a freshly-created item. Fix the projection or initialize the state.

These states surface in the panel so you can tell "projection is intentionally absent" from "projection is broken" without reading the server logs.

## Aliases — when one resource has two names

A resource can be registered under more than one name. The round-robin pattern does this: it dual-registers the participants collection under both `participants` and the pattern-prefixed `roundRobin/participants` so blocks inside the pattern and blocks outside the pattern can both reach it.

The debug response lists every alias for each storage key. The panel shows them as a small "also known as" list under the resource header. If you're chasing a "resource not found" error, check the alias list. The block may be looking for one name while the resource is registered under another.

## Enabling the debug endpoint

The endpoint is off by default. Three ways to turn it on:

```ts
import { createFlowApiRouter } from "@flow-state-dev/engine";

const router = createFlowApiRouter({
  registry,
  debugEndpointsEnabled: true,
  debugAllowedOrigins: ["http://localhost:3001"],
});
```

`debugEndpointsEnabled` is the master switch. `debugAllowedOrigins` widens the default loopback-only origin check — add the origins your DevTool is served from. Both options also read from the `FSDEV_DEBUG_ENDPOINTS=1` env flag, which is convenient for local development.

`fsdev dev` enables the endpoint automatically and restricts it to loopback. You don't need to set anything to use the DevTool in local development.

## Don't ship it enabled to production

The endpoint is read-only, but it exposes the full server-side state of every session, including fields your `client.data` deliberately hides. That's the point of it as a debugging tool, and it's also the reason you don't want it reachable from the public internet.

We made the default fail-closed because the cost of an accidental opt-in to a production deployment is much higher than the cost of typing one extra env flag in local development.

If you have a legitimate reason to enable it in a non-local environment (a staging tier where the DevTool runs on a known internal origin), audit `debugAllowedOrigins` carefully and put the route behind whatever authentication your platform already enforces.

Per-block resource-load metrics are server-side observability in the same vein as this debug state view, gated by trace observability rather than the debug endpoint. See [Observing resource loads](./observing-resource-loads.md).
