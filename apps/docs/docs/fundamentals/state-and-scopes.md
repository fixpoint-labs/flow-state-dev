---
sidebar_position: 5
---

# State & Scopes

State in AI applications is messy. Conversation history, user preferences, shared configuration, intermediate processing data — all at different lifetimes, all needing different isolation guarantees. flow-state.dev gives you four scoped levels with typed operations.

This page walks through the scopes and the basic patterns you'll use every day. For the full operation reference (CAS semantics, error handling, every helper signature), see [State Operations](/docs/fundamentals/state-operations).

## The four scopes

State is organized into four scopes, each its own record with its own key:

| Scope | Question it answers | Lifetime |
|-------|---------------------|----------|
| **Request** | What does this single action execution need right now? | One action execution |
| **Session** | What does this conversation need to remember? | Across requests in a conversation |
| **User** | What does this user need across their conversations in one organization? | Across sessions for a user, per organization |
| **Org** | What does the team need to share? | Across sessions in an org |

![Request, session, user and org state are four separate records, none inside another. Request state belongs to one action run and the next request cannot see it. Session state belongs to one conversation: its state, items, metadata and journal, and the resources an action declares, keyed by the session id and by the tenant when one is sent. User state follows one user across conversations and flows inside one organization, keyed by the user and the organization; with isolateUserState it is one record per flow copy instead. Org state is shared by everyone in the organization, keyed by the org id, or one record per flow copy with isolateOrgState. A session is bound to one organization when it is created; it names its user and org but holds neither one's state. A tenant id splits sessions only. Blocks read and write all four; the browser sees only the fields a scope's client config exposes](./state-scopes.svg)

A session names the user and organization it belongs to. It doesn't contain their state: each scope is read and written on its own record.

Most of your state lives at the session level. The other three matter, but they show up after you've shipped your first conversation. Start with session.

Not everything on the context is state. Read-only instance config arrives separately as `ctx.settings` — see [Engine setup → Settings](/docs/server/setup#settings).

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

Each one writes a single key rather than the whole map, so two runs updating different keys don't overwrite each other. Two runs updating the *same* key do — the second write replaces the first, and both calls report success. [Concurrent writes](/docs/fundamentals/state-operations#cas-semantics) has the rule per call, including the cases where `deleteStateRecord` reports that it did nothing.

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
  .step(agent);
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

Limits on `items.history()` operate on conversational turns rather than individual protocol messages — see [Conversation history windowing](../advanced/generator-context.md#conversation-history-windowing). By default it also includes what the current request has produced so far; pass `includeInFlight: false` for earlier turns only.

History is windowed by default. Each request loads only the most recent `session.historyWindow.turns` completed turns (default 50), so per-turn cost does not grow with session length. `items.all()` and `items.client()` reflect that same loaded window, and a per-call `history({ limit })` narrows within it. The complete session log is never loaded into the execution context on the hot path; read it through the `GET /sessions/:id/state` endpoint when you need the full history. See [Flow-level history bounds](../advanced/generator-context.md#flow-level-history-bounds).

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

**Resources** — named typed containers for structured data and rich content. A request loads only the resources its dispatched action and blocks declare, not every resource in the scope. See [Resources](/docs/resources/overview) and [When resources load](/docs/resources/overview#when-resources-load).

### Creating sessions

A new session typically starts via `sessions.createSession({...})` on the client, which returns a stable `sess_<id>` you reuse on every subsequent action call. See [Client Overview](/docs/client/overview).

If you call an action without a `sessionId`, the framework generates a fallback ID (prefix `ephemeral_<ts>_<rand>`) and persists the session record like any other. The action route doesn't return that generated ID to the client, so the session is effectively orphaned — useful for one-shot internal callers and tests, but not a way to start "real" conversations. For production conversational flows, always create the session first and pass the ID through.

A caller can pass initial `state` when it creates a session. That suits preferences and drafts, and it is the wrong place for a value that grants anything: the caller wrote it.

When a session exists to work on one particular thing, such as one of the user's projects, give it a **link**. A link is a single string chosen when the session is created and fixed for the rest of its life. Your flow decides whether to allow it by declaring `session.createCheck`, a function that runs before the session is written and either accepts the link or refuses the create. Blocks read the accepted value as `ctx.session.link`, and callers can list sessions by it. The [example below](#example-one-session-per-project) walks through the whole thing.

For a field your flow changes as it runs, and that a caller must never set, list it in `session.serverOwned`:

```ts
session: {
  stateSchema: z.object({ reviewers: z.array(z.string()).default([]) }),
  serverOwned: ["reviewers"],
},
```

A create that sets `reviewers` in its `state` is refused with a 400 whose body names the field (`{ error, field: "reviewers" }`), and nothing is written. Blocks in your flow write it like any other session state.

### Example: one session per project

Say each user of your app keeps a list of projects, and every assistant session works on exactly one of them. A user should not be able to open a session on a project that doesn't exist, or on someone else's.

**1. Keep the projects in a user-scoped collection.** A [resource collection](/docs/resources/collections) with `scope: "user"` holds a separate set of rows for each user. Here a small `projects` flow writes to it:

```ts
// flows/projects.ts
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

// One row per project, in each user's own scope.
export const projects = defineResourceCollection({
  pattern: "projects/*",
  scope: "user",
  stateSchema: z.object({ name: z.string() }),
});

const createProjectInput = z.object({ slug: z.string(), name: z.string() });

const createProject = handler({
  name: "create-project",
  inputSchema: createProjectInput,
  resources: { projects },
  execute: async (input, ctx) => {
    await ctx.resources.projects.create(input.slug, { name: input.name });
    return { slug: input.slug };
  },
});

export const projectsFlow = defineFlow({
  kind: "projects",
  resources: { projects },
  actions: {
    create: { inputSchema: createProjectInput, block: createProject },
  },
})();
```

Every flow in the same organization that declares `projects` sees the same rows for a given user, unless a flow sets `isolateUserState`. After `user_1` runs `create` with `{ slug: "q3-launch", name: "Q3 launch" }`, their scope holds the row `projects/q3-launch`.

**2. Declare the check on the assistant flow.**

```ts
// flows/project-assistant.ts
import { defineFlow } from "@flow-state-dev/core";
import { z } from "zod";
import { loadProject } from "./load-project";
import { projects } from "./projects";

export const projectAssistant = defineFlow({
  kind: "project-assistant",
  resources: { projects },
  session: {
    createCheck: async ({ link, readCollectionItem }) => {
      if (link === undefined) {
        return { ok: false, message: "Pick a project to open." };
      }
      const project = await readCollectionItem("projects", link);
      if (project === undefined) {
        return { ok: false, status: 404, message: `No project "${link}".` };
      }
      return { ok: true };
    },
  },
  actions: {
    loadProject: { inputSchema: z.object({}), block: loadProject },
  },
})();
```

The check gets one object:

| Field | What it is |
|-------|------------|
| `link` | The link the create named, or `undefined` if it named none. |
| `principal` | The caller: `{ userId, orgId, tenantId? }`. |
| `readCollectionItem(ref, topic)` | Reads one row of a user- or org-scoped collection this flow declares. `ref` is the key in the flow's `resources` (`"projects"`). `topic` is the row's key in the collection: `"q3-launch"` for `projects/q3-launch`, or the parameters for a pattern like `[room]/info` (`{ room: "lobby" }`). Resolves the row's state, or `undefined` when there is no such row. Throws if `ref` isn't a user- or org-scoped collection of this flow. |
| `sessionId`, `flow`, `via` | The id being created, the flow (`{ kind, id }`), and which path is creating it: `"create"`, `"action"`, `"webhook"`, `"cli"` or `"dispatch"`. |

`readCollectionItem` only ever reads the caller's own scope. `user_2` asking for `q3-launch` gets `undefined` even though `user_1` has one, so "not yours" and "doesn't exist" get the same answer.

Return `{ ok: true }` to create the session, or `{ ok: false, message, status }` to refuse it. `status` can be 400, 403 or 404, and defaults to 400.

The check is only as strong as the caller identity it receives. With [authentication](/docs/server/authentication) set up, `principal` is the authenticated user. Without it, `principal.userId` is whatever `userId` the request sends.

Register both flows with your server as usual (see [Engine setup](/docs/server/setup)).

**3. Create a session for a project.** The client's option for the link is `worker`. It goes over the wire as `link`.

```ts
import { createSessionClient } from "@flow-state-dev/client";

const sessions = createSessionClient();

const session = await sessions.createSession({
  flowKind: "project-assistant",
  userId: "user_1",
  worker: "q3-launch",
});

session.link; // "q3-launch"
```

Over HTTP, the same create is:

```http
POST /api/flows/project-assistant/sessions
Content-Type: application/json

{ "userId": "user_1", "link": "q3-launch" }
```

It answers `201` with `{ "session": { "id": "sess_...", "link": "q3-launch", ... } }`.

In React, pass the value to `useFlow`. The hook lists only that project's sessions and creates new ones with it:

```ts
import { useFlow } from "@flow-state-dev/react";

const flow = useFlow({
  flowKind: "project-assistant",
  worker: projectSlug,
  autoCreateSession: true,
});
```

**4. Read the link in a block.** `ctx.session.link` is the value the check accepted:

```ts
// flows/load-project.ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { projects } from "./projects";

export const loadProject = handler({
  name: "load-project",
  inputSchema: z.object({}),
  resources: { projects },
  execute: async (_input, ctx) => {
    const slug = ctx.session.link;
    if (slug === undefined) throw new Error("This session has no project.");

    const project = await ctx.resources.projects.get(slug);
    return { slug, name: project.state.name };
  },
});
```

Run `loadProject` in the session from step 3 and it returns `{ slug: "q3-launch", name: "Q3 launch" }`. Every turn in that session sees the same link. No route, action or block can change it. The type is `string | undefined` because a flow with no `createCheck` has no link; on this flow it is always set.

**5. List a project's sessions.**

```ts
const forProject = await sessions.listSessions({
  flowKind: "project-assistant",
  userId: "user_1",
  worker: "q3-launch",
});
```

Over HTTP: `GET /api/flows/sessions?flowKind=project-assistant&userId=user_1&link=q3-launch`. Each row carries its `link`. The filter narrows the listing the caller already gets, so another user's sessions on a project with the same slug never show up.

**6. Handle a refusal.** When the check refuses, no session is written. The create answers with your `status` and a body of `{ error: message }`, and the client throws `ClientHttpError`:

```ts
import { ClientHttpError } from "@flow-state-dev/client";

try {
  await sessions.createSession({
    flowKind: "project-assistant",
    userId: "user_2",
    worker: "q3-launch",
  });
} catch (error) {
  if (error instanceof ClientHttpError) {
    error.status; // 404
    error.body; // { error: 'No project "q3-launch".' }
  }
}
```

With the check above:

| The create names | Status | Body |
|------------------|--------|------|
| A project the user has | `201` | `{ session: { ..., link: "q3-launch" } }` |
| A project that doesn't exist, or another user's | `404` | `{ error: 'No project "q3-launch".' }` |
| No project | `400` | `{ error: "Pick a project to open." }` |

A create with no link is refused with a 400 even if your check returns `{ ok: true }` for it, so every session of a flow with a check has a link. From `useFlow`, `createSession` rejects with the same error, and `autoCreateSession` leaves the hook with no active session.

**Where else the check runs.** The same check runs on every other path that creates a session of this flow: an action or webhook delivery sent to a session id that doesn't exist yet (these name no link, so on this flow they are refused with the 400 above; create the session first), a [`dispatcher()`](/docs/server/background-work#starting-a-job-from-a-flow) starting a child session with `session: { key, link }`, and `fsdev run project-assistant loadProject --worker q3-launch` when it starts a new session. A turn on an existing session never runs it.

## The `client` block: exposing state safely

Raw state never reaches the client. Session, user, and org each take a `client` block that declares the slice of state that crosses to the browser. Anything not in `client` stays on the server.

The block has two halves:

- `expose` — top-level state field names that pass through verbatim. Use it for primitives that are already client-shaped.
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

The values land at `snapshot.clientData.<scope>.<name>`. `useClientData` reads that object.

Internal state — intermediate processing, raw resource contents, block-private fields — stays on the server. The privacy contract is the default: a scope without a `client` block exposes nothing. Adding a new state field doesn't silently leak to the browser; you have to add it to `expose` or `derived` first.

`expose` and `derived` share a namespace. A name in both throws at `defineFlow`. `expose` names must be top-level keys on that scope's `stateSchema`.

During streaming, `state_change` and `resource_change` events signal that the client view may be stale. The client refetches the authoritative snapshot on `request.completed`.

Mutations to session, user, org, and request state all emit `state_change` items on the wire, in the same shape block-instance and sequencer target state emit, so React's `useClientData` can reflect mid-stream patches without waiting for terminal status. See [`useClientData`](/docs/client/react#useclientdata--client-data). Resources have the same option: one declaring `client: { live: true }` streams its projected delta the same way (see [Resources: client access — Live updates](/docs/resources/client-access#live-updates)), so apps don't need to mirror resource status onto session state.

This mirrors how resources work: a resource without a `client` config is invisible to clients (see [Resources: client access](/docs/resources/client-access)). One mental model — `client` everywhere — instead of two.

## The other three scopes

You'll reach for these less often than session, but each has a specific job.

**Request** is scratch space for one run: intermediate results, retry counters, temporary flags.

```ts
requestStateSchema: z.object({ retryCount: z.number().default(0) })
```

Use request state when you explicitly *don't* want data to accumulate in the session. The rule of thumb: if the next request might care, use session.

**User** follows a person from conversation to conversation: preferences, accumulated knowledge, personal collections.

```ts
userStateSchema: z.object({
  preferences: z.object({
    responseStyle: z.enum(["concise", "detailed"]).default("detailed"),
  }).default({}),
})
```

User data belongs to a user inside one organization. Alice in Acme and Alice in Globex have two user records, and two copies of every user-scoped resource, so nothing she saves while working for one organization shows up in the other. Inside one organization, every flow on the server shares her one record, so each flow's user state schema is compared at startup. Incompatible declarations throw `CrossFlowSchemaConflictError` from `FlowRegistry.register` before any data can be corrupted. [Flow Isolation](/docs/advanced/flow-isolation) gives each flow copy its own record instead, still inside the organization.

**Org** is shared by the whole team: configuration, knowledge bases, settings an admin controls for everyone.

```ts
orgStateSchema: z.object({
  config: z.object({
    maxTokenBudget: z.number().default(100_000),
  }).default({}),
})
```

Org state is shared across flows the same way and gets the same startup check. Read it with `ctx.org?.state.config`: `ctx.org` is optional in the types, but every request runs in an organization, so it is there on every execution ([where that organization comes from](/docs/server/authentication#every-request-runs-in-an-organization)). A session is tied to the organization it was created in, and a request against it that resolves to a different organization throws `OrgBindingMismatchError`.

For the full operation reference and CAS semantics that apply to all four scopes, see [State Operations](/docs/fundamentals/state-operations). For how `userId` and `orgId` flow into a request — including who's responsible for verifying them — see [Authentication](/docs/server/authentication).

## Multi-tenant isolation

If you run one deployment for several customers (your "tenants"), you can isolate their data at the store layer without writing your own filtering. Send a tenant id on each request through an HTTP header — `x-tenant-id` by default, configurable with `createFlowApiRouter({ tenantIdHeader })`. Set it from your gateway, or from your client's `fetch` wrapper, the same way you'd attach an auth header.

When a tenant id is present, the framework namespaces the **session** storage key. Two tenants that both use session id `chat-1` get two separate session records, separate session state, and separate session-scoped resources. Cross-turn history and request listing are scoped to the tenant too, so one tenant never sees another's turns.

```bash
# Two tenants, same session id, two independent sessions:
curl -H "x-tenant-id: acme"   ... -d '{"sessionId":"chat-1", ...}'
curl -H "x-tenant-id: globex" ... -d '{"sessionId":"chat-1", ...}'
```

What stays shared, on purpose: **user** and **org** scopes. Org-level policy and quotas, and a user's preferences, are usually meant to apply across tenants, so they key on the user and organization, or the organization alone, and not on the tenant. If you need those isolated per tenant, encode the tenant into the id you pass.

You read the tenant in a block the same way as any identity field: `ctx.session.identity.tenantId`. The session id you get back (`ctx.session.identity.id`, API responses) is always the bare id you sent — the tenant prefix is an internal storage detail.

Apps that never send the header do nothing: with no tenant id, a session keys on its own id alone. [Persistence](/docs/persistence/overview#tenant-isolation) covers the storage side, including what a persistent adapter does to an existing database.

## State tied to a run

The four scopes are tied to identity. Blocks can also hold state tied to *execution* — a generator remembering what it's loaded so far, a sequencer counting its own loop passes — that lives and dies with one run. See [Block State](/docs/advanced/block-state) for that primitive.

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
- **[Block State](/docs/advanced/block-state)** — request-scoped state any block can hold, addressed via `ctx.self` and `ctx.parent`.
- **[State Targets and Parents](/docs/advanced/state-targets-and-parents)** — typed access to ancestor block state via `targetStateSchemas` and `ctx.getTarget()`.
- **[Sequencer State](/docs/advanced/sequencer-state)** — state scoped to a sequencer's execution rather than identity, with a different durability boundary.
- **[Resources](/docs/resources/overview)** — typed containers for structured data and rich content, with the same atomic operations as state.
- **[Authentication](/docs/server/authentication)** — how `userId` and `orgId` reach a flow execution.
