---
title: Migrating to the flat resources namespace
sidebar_label: Migration — flat resources
---

# Migrating to the flat resources namespace

The framework moved from three scope-keyed install sites to a single flat `resources` map. Resources now carry their scope intrinsically — set once on `defineResource`, read everywhere through `ctx.resources`.

This guide shows the mechanical edits to land a codebase on the new surface.

## What changed

Three things collapsed into one:

1. The install-site fields `sessionResources`, `userResources`, `orgResources` on block / flow / capability configs.
2. The accessor paths `ctx.session.resources.*`, `ctx.user.resources.*`, `ctx.org.resources.*`.
3. `defineResource` itself — scope was optional and inferred from the install site; it is now required on the definition.

Cross-flow sharing used to be a flow-wide flag (`isolateUserState`). It now also has a per-resource form (`flowIsolation: boolean`) that always wins.

## The mechanical edits

### `defineResource` requires `scope`

```ts
// Before
const draftResource = defineResource({
  stateSchema: draftStateSchema,
});

// After
const draftResource = defineResource({
  ref: "draft",
  scope: "session",
  stateSchema: draftStateSchema,
});
```

Pick the scope based on where the resource was previously installed. A resource declared under `sessionResources` becomes `scope: "session"`, and so on.

`defineResourceCollection` works the same way — `scope` is required.

### Block / flow / capability configs collapse to one `resources` field

```ts
// Before
handler({
  name: "persist-obs",
  sessionResources: { observations: observationsResource },
  userResources: { profile: profileResource },
  execute: async (input, ctx) => {
    ctx.session.resources.observations.state.entries;
    ctx.user.resources.profile.state.preferences;
  },
});

// After
handler({
  name: "persist-obs",
  resources: {
    observations: observationsResource,
    profile: profileResource,
  },
  execute: async (input, ctx) => {
    ctx.resources.observations.state.entries;
    ctx.resources.profile.state.preferences;
  },
});
```

Same change applies to `generator`, `router`, `sequencer`, and `defineCapability` configs, and to flow definitions:

```ts
// Before
defineFlow({
  session: { resources: { plan: planResource } },
  user: { resources: { profile: profileResource } },
});

// After
defineFlow({
  resources: {
    plan: planResource,
    profile: profileResource,
  },
});
```

### Disambiguating same-named resources at different scopes

If you previously had two resources with the same accessor name installed at different scopes, pick distinct accessor keys:

```ts
resources: {
  sessionDraft: sessionDraftResource,
  userDraft: userDraftResource,
}
```

The resources' internal `ref` can still match — only the accessor key has to be unique within the flow.

### `ctx.<scope>.state` is unchanged

Per-scope state accessors stay. State slices are namespaces with no identity; resources have identity, so they got lifted out. The asymmetry is principled.

## `flowIsolation`

User- and org-scoped resources default to **shared** storage across every flow that touches the same `userId` / `orgId`. Set `flowIsolation: true` on a resource that should be flow-private:

```ts
const userDraftResource = defineResource({
  ref: "draft",
  scope: "user",
  flowIsolation: true,
  stateSchema: draftStateSchema,
});
```

Flow-level `isolateUserState` / `isolateOrgState` flags still exist as **defaults** — they apply to user/org-scoped resources that don't declare `flowIsolation` themselves. A resource's own declaration always wins.

`flowIsolation: true` on a session-scoped resource is a build-time error: sessions are intrinsically flow-bound, and the field has no semantic meaning there.

### Flows that previously used `isolateUserState: true`

If a flow has `isolateUserState: true` and you don't change anything else, every user-scoped resource it touches stays per-flow under the same `(userId, flowKind)` key. The flow flag continues to work as a default.

If you want a specific resource to escape the flow flag and become shared (e.g., a universal user-memory resource imported from a library), set `flowIsolation: false` on its definition. The library's intent wins over the flow's default.

## Capabilities

`defineCapability` collapsed the same way:

```ts
// Before
defineCapability({
  name: "memory",
  sessionResources: { workingMemory: wmResource },
  userResources: { episodicMemory: epResource },
});

// After
defineCapability({
  name: "memory",
  resources: {
    workingMemory: wmResource,
    episodicMemory: epResource,
  },
});
```

Presets pass resources via the same single `resources` field.

## Migration is atomic

There is no transitional support for the old field names or accessor paths. Production code, capabilities, examples, and tests all move together — type errors at the boundaries are by design.

## Storage-shape notes

- Changing a resource's `flowIsolation` between releases is a breaking storage change. Records under `(userId, flowKind, ref)` are invisible to a consumer reading from `(userId, ref)` and vice versa. Treat the flag as a stable property of the resource definition.
- Two definitions that resolve to the same effective storage tuple `(scope, ref, flowIsolation, flowKind?)` under different accessor keys are rejected at flow-build time. Pick distinct refs or flowIsolation settings.
- Identity-equal re-registration is always safe — diamond dependencies through capabilities are deduplicated by reference.
