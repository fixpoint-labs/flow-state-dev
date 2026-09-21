---
sidebar_position: 1
---

# Building projects on org scope

Org scope is a single shared scope. The framework gives you `org` because some app data isn't per-user and isn't per-session — it lives at a wider boundary. What that boundary represents — a workspace, a folder, a customer, a project — is your call. The framework doesn't know what an "org" means in your app.

This guide walks through the common case of building a project-like grouping on top of org scope using a keyed resource collection plus session state. No new framework primitives required.

## When to use this pattern

You want users to:

- Create multiple project-like containers within the same org.
- Switch between projects within a session, or carry an active project across sessions.
- Share artifacts and configuration scoped to a single project, not the whole org.
- Maintain a per-user idea of "the project I'm currently in."

The framework gives you scope and storage. You build the projects abstraction on top.

## The shape

Three pieces:

1. **An org-scoped resource collection** keyed by `{projectId}/{itemId}`. Items in the collection live at org scope; the keying just gives you a way to filter by project.
2. **An `activeProjectId` field** on session state. The user is currently working on this project.
3. **Filtering at read time** — when handlers and renderers need "the artifacts in the active project," they read the org collection and filter by `topicPrefix`.

```ts
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

const artifactsCollection = defineResourceCollection({
  ref: "artifacts",
  scope: "org",
  stateSchema: z.object({
    projectId: z.string(),
    name: z.string(),
    content: z.string()
  }),
  client: { content: { read: true, update: true } },
});

const projectsCollection = defineResourceCollection({
  ref: "projects",
  scope: "org",
  stateSchema: z.object({
    name: z.string(),
    instructions: z.string()
  }),
  client: { content: { read: true, update: true } },
});

const flow = defineFlow({
  kind: "project-app",
  session: {
    stateSchema: z.object({
      activeProjectId: z.string().optional()
    }),
  },
  org: {
    resources: {
      projects: projectsCollection,
      artifacts: artifactsCollection,
    },
  },
  actions: {
    /* ... */
  },
});
```

When a request runs, the user is in some project (`session.activeProjectId`). Reading "this project's artifacts" is a filtered read on the org collection:

```ts
const activeProjectId = ctx.session.state.activeProjectId;
const artifacts = activeProjectId
  ? await ctx.org!.resources.artifacts.list({ topicPrefix: `${activeProjectId}/` })
  : [];
```

Writes use the same key convention:

```ts
await ctx.org!.resources.artifacts.set(`${activeProjectId}/note-${id}`, {
  projectId: activeProjectId,
  name: "Note",
  content: "..."
});
```

## Which organization a session runs in

The value comes from your app's configuration, never from the caller.

**Single-organization apps.** Configure no `resolvePrincipal` and everything runs under `DEFAULT_ORG_ID`, a reserved id exported from `@flow-state-dev/core`. That is a development identity, not a security boundary, so an app with real customers configures a resolver.

**Multi-organization apps.** Resolve the organization from your own auth or routing context and return it from `resolvePrincipal`:

```ts
import { defineFlow } from "@flow-state-dev/core";

const flow = defineFlow({
  kind: "project-app",
  authentication: {
    resolvePrincipal: async (ctx) => {
      const session = await readSession(ctx.request!);
      return { userId: session.userId, orgId: session.tenantId };
    },
  },
  /* session, org, actions as above */
});
```

An `orgId` posted in the request body, query or metadata is ignored, so a caller cannot name someone else's organization. A resolver that returns no organization, a blank one, or `DEFAULT_ORG_ID` is refused with `401`.

Organization ids are opaque nonempty strings, app-owned like `userId`. [Authentication](/docs/server/authentication#every-request-runs-in-an-organization) covers the resolver in full.

## Switching projects mid-conversation

`activeProjectId` is session state, so a "switch project" action just patches it:

```ts
const switchProject = handler({
  name: "switch-project",
  inputSchema: z.object({ projectId: z.string() }),
  execute: async (input, ctx) => {
    await ctx.session.patchState({ activeProjectId: input.projectId });
    return { ok: true };
  },
});
```

Subsequent reads see the new project. There's no rebind step at the framework level — the session is still bound to the same org; you just changed which project within that org the session is currently focused on.

## What about session orgId?

`orgId` is **immutable** for the lifetime of a session. Once a session is created with an org, that binding is permanent. If a user genuinely needs to "move" a session to a different org, the app creates a new session and copies what should carry over.

This is a deliberate constraint. Orgs are stickier than projects — mid-conversation "this should belong to a different org" is rare in practice, while "this should belong to a different project within the same org" is common, and the latter is exactly what `activeProjectId` solves.

## What's not in this pattern (yet)

The "memories" demo from the kitchen-sink showcase needs a resource that's **dynamically scoped** — sometimes user-scoped, sometimes org-scoped, depending on the session. That dynamic routing (`scope: (bind) => ...` and `ctx.dynamic.resources.*`) hasn't shipped yet. The projects-as-collection pattern above doesn't need it — pick `scope: "org"` at definition time and you're done.
