# Resources and Client Data

Resources are **concrete persisted data** attached to a scope. Client data entries are **derived views** computed from state and resources — the mechanism for exposing server-side data to clients. Together, they provide structured, typed data management within flows.

## Resources

A resource carries an intrinsic `scope` (`"session"`, `"user"`, or `"org"`) and lives in a single flat `resources` map on a flow, block, or capability. The resource's scope routes its storage to the right layer; consumers reach for it via `ctx.resources.<accessor>` regardless of where it lives.

```ts
import { defineResource } from "@flow-state-dev/core";

const planResource = defineResource({
  ref: "plan",
  scope: "session",
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
  }),
  writable: true,
});

defineFlow({
  kind: "my-app",
  resources: { plan: planResource },
  // session.stateSchema, user.stateSchema, etc. unchanged
});
```

The accessor key (`plan`) is purely a typed read handle for `ctx.resources.<name>`. Persistence is keyed by ref identity: two blocks that declare the **same** `DefinedResource` reference under different accessor names see the same storage slot. Two blocks that declare **different** `DefinedResource` references under the same accessor name still conflict at flow-build time.

When a resource is declared **without** an explicit `ref`, the canonical storage key falls back to the first accessor encountered in declaration order. That's fine for single-accessor resources, but for dual-registered user/org-scoped resources it makes the storage key sensitive to declaration order. **Set `ref` explicitly on any non-session resource you plan to register under multiple accessor names** so persisted data survives reordering, refactors, or moves between block- and flow-level declarations.

### Resource Config

```ts
type ResourceConfig = {
  ref?: string;                 // Storage namespace identifier (combined with scope/flowIsolation)
  scope: "session" | "user" | "org"; // Required — intrinsic to the definition
  flowIsolation?: boolean;      // Default false. When true at user/org, namespaces by flowKind
  stateSchema: ZodTypeAny;     // Required: defines the data shape
  default?: JsonValue;          // Default initial value
  content?: string;             // Optional definition-time content body
  contentFile?: string;         // Optional path to initial content template
  render?: (content: string, state: JsonObject) => string | Promise<string>; // Optional renderer
  llmReadable?: boolean;        // Allows read tool access when readResourceContentTool is installed
  llmWritable?: boolean;        // Allows write tool access when writeResourceContentTool is installed
  dynamic?: boolean;            // Resolved at runtime
  writable?: boolean;           // Allow mutation from blocks
  allowedExtensions?: string[]; // Content type restrictions
  metadata?: Record<string, unknown>;
};
```

### `flowIsolation`

User- and org-scoped resources default to **shared** storage across every flow that touches the same `userId` / `orgId`. Set `flowIsolation: true` on a definition that should be flow-private — its data lives at `(scopeId, flowKind, ref)` instead of `(scopeId, ref)`.

`flowIsolation: true` on a session-scoped resource is a build-time error: sessions are intrinsically flow-bound, so the field has no semantic meaning there. The flow-level `isolateUserState` / `isolateOrgState` flags from FIX-431 remain as defaults for resources at the relevant scope that don't declare `flowIsolation` themselves; resource-level declarations always win.

| `scope` | `flowIsolation` | Storage key |
| -- | -- | -- |
| `session` | (n/a) | `(sessionId, ref)` |
| `user` | `false` (default) | `(userId, ref)` |
| `user` | `true` | `(userId, flowKind, ref)` |
| `org` | `false` (default) | `(orgId, ref)` |
| `org` | `true` | `(orgId, flowKind, ref)` |


### Resource Content

Resources can also carry file-like text content. Use `content` for inline templates or `contentFile` to load at startup (mutually exclusive). A bare-string `contentFile` resolves relative to `process.cwd()`; for cwd-independent resolution pass an anchored path — `contentFile: { path: "./doc.md", importerUrl: import.meta.url }` — which resolves relative to the declaring module first and falls back to the working directory (the same candidate semantics as prompt-file loading).

- `readContent()` returns rendered content (`string`) or `null` if no content exists.
- `readContentRaw()` returns the stored raw body (`string`) or `null`.
- Empty content (`""`) is valid and distinct from `null`.
- Template rendering is **opt-in** via `render`, e.g. `render: renderTemplate` from `@flow-state-dev/engine`. Nested `{{#each}}` blocks are not supported. Templates longer than 512 KB are rejected.
- LLM content access is **tool-driven and opt-in**. Add `readResourceContentTool()` / `writeResourceContentTool()` to a generator's `tools` list when you want these capabilities available.

```ts
const soul = defineResource({
  stateSchema: z.object({ values: z.array(z.string()), tone: z.string() }),
  content: "## Values\n{{#each values}}- {{this}}\n{{/each}}Tone: {{tone}}",
  render: renderTemplate,
  llmReadable: true,
  llmWritable: false,
});
```

### Content Storage

Resource content is persisted separately from scope record metadata via `ContentStore`. This separation lets adapters use different backends for content and metadata — SQL for scope records, blob storage for content, for example.

**Two read paths:**
1. **Execution context** — content is eagerly loaded from `ContentStore` into an in-memory cache at context creation. All reads during block execution are synchronous from this cache.
2. **State routes** — `handleGetSessionState` loads content fresh from `ContentStore` before building the response.

**Migration from inline content:** Earlier versions stored content inline on scope records as `resourceContent`. That field has been removed — content now lives exclusively in `ContentStore`. Records persisted before the cutover that still carry a `resourceContent` blob will silently drop it on the next round-trip; any content that needs to survive must be copied into `ContentStore` before upgrading. The in-memory and filesystem stores hold no legacy data, and SQLite/Postgres serialize records as JSON, so the field simply disappears from the projected record. Operators with inline content already in production should run a one-shot script that reads each session/user/org record, walks its old `resourceContent` map, and calls `stores.content.set(scopeType, scopeId, key, value)` for each entry before deploying.

**Content writes do not bump scope record version.** Content is separate from state. The scope record's `version` and `updatedAt` reflect state/metadata changes only. Content writes persist per-key to `ContentStore` without touching the scope record.

**Scope deletion cascades:** When a session (or other scope) is deleted, `ContentStore.deleteAll()` is called before the scope record is removed. This prevents orphaned content.

See the [server README](../../packages/engine/README.md) for `ContentStore` interface details and custom adapter instructions.

### State Storage

Resource *state* (the structured `JsonObject` each resource carries, as opposed to its content body) is persisted the same way content is: per-resource in a dedicated `ResourceStateStore`, keyed by `(scopeType, scopeId, resourceKey)`, separate from the scope record. This covers both single resources and collection instances under one store.

The two stores are parallel but independent — a resource can have state with no content body, and vice versa — so they keep distinct payload types (`JsonObject` for state, `string` for content) and distinct adapters.

The lifecycle mirrors content exactly:

1. **Execution context** — declared resource state is eagerly loaded from `ResourceStateStore` into an in-memory cache at context creation. Reads during block execution are synchronous against the cache.
2. **State writes persist per-key.** A mutation to one resource writes only that resource's key via `ResourceStateStore.set` — it never loads or rewrites the whole scope record. This removes the write amplification a collection of N instances previously paid (the whole `resources` map was rewritten on every single-instance change).
3. **State routes / debug snapshot** — read resource state fresh from `ResourceStateStore`.

The `Resource*Ref` API is unchanged; this is an internal storage relocation. The scope record's former inline `resources` field is no longer read or written.

### Typed Edges (`edges` slot)

A resource (or collection) can opt into a typed-edge graph by declaring `edges: true | { vocabulary?, maxEdges? }` on `defineResource` / `defineResourceCollection`. This is part of the resource contract, not a separate store:

- **State field injection.** `defineResource` extends the resource's `stateSchema` (and default) with an `edges: Edge[]` field unless the schema already declares one; `defineResourceCollection` does the same for each instance schema. Edges therefore live *inside* the resource's own state `JsonObject` and persist through the same per-key `ResourceStateStore` path as any other state — no new storage key, no store-adapter change. The graph is opaque to the store (it's just an array in the value), so traversal is in-memory.
- **`.edges` ref API.** When `edges` is declared, the live `ResourceRef` / `ResourceContext` (and each collection-instance ref) gains an `.edges` accessor: `add`, `supersede` (bi-temporal close, never a hard delete), `remove`, `all({ at? })`, `neighbors`, `egoGraph`, `shortestPath`, and `pruneDangling`. Mutators route through the resource's existing `updateState`, so edge writes emit the same `resource_change` events as any state write. The edge schema and pure traversal helpers are the reusable `@flow-state-dev/core/graph` primitive; the slot is what wires them onto the resource.
- **Bounding.** `maxEdges` caps growth; the cull drops superseded tombstones first, then lowest-confidence active edges, and never evicts the edge just added (so `add()` always returns a stored edge).

The first consumer is the memory `relations` tier (see `apps/docs/docs/memory/relations`), which stores typed relationships between fact subjects on the semantic resource's edge slot.

### Three-Wave Loading

A request loads only the resources its dispatched action and blocks declare, partitioned into three waves. The partition is computed from where each resource is declared:

- **Flow-level** — declared in `defineFlow({ resources })`. Available to every action.
- **Action-tree** — declared anywhere inside the dispatched action's block tree, but not at flow level.
- **Per-block (lazy)** — `prefetchMode: 'lazy'` resources, which opt out of the action-tree burst.

Where each wave fires:

- **Wave 1 (flow-level, request start)** — `createExecutionContext` loads the flow-level eager subset when the context is created, before any action runs.
- **Wave 2 (action-tree, dispatch)** — also in `createExecutionContext`. A context is always bound to exactly one action, so the context loads that action's declared resources in one parallel burst at creation time. This lives in `createExecutionContext`, not in `runAction`, precisely because the binding is one-context-per-action — there's no separate point where the action "starts" that the context doesn't already know about. Sibling actions' resources never load.
- **Wave 3 (per-block dispatch)** — the block runtime's `run` loads a block's `prefetchMode: 'lazy'` single resources when that block dispatches, through `_loadDeclaredResources`. Lazy collections defer further: they load per access through the on-demand accessor (below) rather than at block dispatch.

**Per-scope cache and dedupe.** Each scope (session / user / org) keeps an in-memory state and content cache that the waves fill. A `loadedCollectionPrefixes` set per scope records which collection pattern-prefixes have already been bulk-loaded, seeded with the flow-level prefixes from Wave 1, so a re-dispatch never re-scans. Single resources are tracked implicitly by presence in the state cache. An `inflightLoads` single-flight map collapses concurrent loads of the same key or prefix across parallel block dispatch (for example a sequencer's `.work()` fan-out), and clears its entry in `finally` so a failed load retries on the next attempt instead of poisoning the map.

**Concurrent writes to the cache.** Every write commits one key to the per-key store and then mutates the live per-scope cache in place at that key (`cache[key] = value`) rather than replacing the whole map (FIX-744). Because `.parallel`/`.forEach` branches share one execution context, this is what lets distinct-key collection writes from a fan-out coexist in the cache: a convergence read (`.list()`/`.count()`) after the fan-out sees every instance, not just the last branch's. Same-key concurrent writes are last-writer-wins. See [State and Scopes — concurrency guidance](./state-and-scopes.md).

**Lazy collection reads.** `prefetchMode` is a loading-cost knob, not an API-shape one: a collection's `get`/`getOptional`/`list`/`count` are async in both modes. Eager just resolves them against a cache the waves prefilled, while lazy defers loading to the moment of access. A `prefetchMode: 'lazy'` collection reads through a per-scope on-demand accessor: `getInstance(storageKey)` and `getByPrefix(prefix)` fill the same per-scope cache and reuse the same single-flight map and `loadedCollectionPrefixes` set as the eager waves, so a key fetched on demand and one fetched by a wave dedupe against each other. The underlying reads go to the per-key `ResourceStateStore` (and `ContentStore` for content). See [Resource Collections — prefetch mode](./resource-collections.md#prefetch-mode).

**Validation.** `prefetchMode: 'lazy'` on a single resource declared at flow level throws at build time — a flow-level declaration has no per-block dispatch to act as a load trigger. `prefetchMode: 'lazy'` combined with a non-`'none'` eviction policy throws — a lazy cache is partial, so eviction can't see the full set to evict correctly. `maxInstances` and eviction are exact under eager and best-effort under lazy (they only see loaded instances).

### Accessing Resources

Resources are accessed through the flat `ctx.resources` registry — the resource's intrinsic `scope` routes reads and writes to the right storage layer.

```ts
// Read resource state — same shape regardless of scope
const plan = ctx.resources.plan;
const steps = plan.state.steps;

// Mutate resource state
await plan.patchState({ status: "active" });
await plan.setState({ steps: ["step1", "step2"], status: "draft" });
await plan.updateState((current) => ({
  ...current,
  steps: [...current.steps, "new-step"],
}));
```

`ctx.session.state`, `ctx.user.state`, and `ctx.org.state` survive — state slices are namespaces that multiple unrelated blocks contribute keys into and need scope tagging at the install site. Resources have identity, so they carry their scope with them.

### Portable Resource Definitions

`defineResource` returns a definition stamped with `(scope, ref, flowIsolation)`:

```ts
import { defineResource } from "@flow-state-dev/core";

export const planResource = defineResource({
  ref: "plan",
  scope: "session",
  stateSchema: z.object({
    steps: z.array(z.string()).default([]),
    status: z.enum(["draft", "active", "complete"]).default("draft"),
  }),
  writable: true,
});

// Use in flow — single flat resources map
defineFlow({
  resources: { plan: planResource },
});
```

`defineResource` exposes `StateType` and `ContextType` helpers for typing shared helper functions:

```ts
type PlanState = typeof planResource.StateType;
type PlanContext = typeof planResource.ContextType;

async function addStep(ctx: PlanContext, step: string) {
  await ctx.updateState((plan) => ({
    ...plan,
    steps: [...plan.steps, step],
  }));
}
```

The updater above reports nothing, which is why a plain `updateState` is right for
it. As soon as a helper needs to tell its caller *what it did* — "yes, I removed
that step", "here are the three I dropped" — reaching outside the callback for a
variable is wrong: on the CAS path the updater can run more than once, and the
value left behind describes whichever attempt ran last rather than the one that
committed. Return the outcome through `updateStateWith` instead:

```ts
import { updateStateWith } from "@flow-state-dev/core/helpers";

async function removeStep(ctx: PlanContext, step: string): Promise<boolean> {
  return (await updateStateWith(ctx, (plan) => {
    if (!plan.steps.includes(step)) return { state: plan, result: false };
    return {
      state: { ...plan, steps: plan.steps.filter((s) => s !== step) },
      result: true,
    };
  })) ?? false;
}
```

See [State mutation model](https://flow-state.dev/docs/state/mutation-model) →
"Writing an updater that may run twice" for the full rule.

### Resource Collections

Static resources are declared by name at definition time. Resource collections let you create typed sets of resources dynamically at runtime — useful when the number of instances isn't known ahead of time (file collections, per-topic knowledge stores, dynamic workspaces).

See [Resource Collections](./resource-collections.md) for the full reference: patterns, runtime API, eviction, lifecycle hooks, and storage model.

### Block-Level Resource Declarations

Blocks declare resource dependencies via a single `resources` field:

```ts
const planManager = handler({
  name: "plan-manager",
  resources: { plan: planResource },
  execute: async (input, ctx) => {
    await ctx.resources.plan.patchState({ status: "active" });
    return input;
  },
});
```

Declared resources surface on `BlockDefinition.declaredResources` as a flat `Record<string, DefinedResource | DefinedResourceCollection>`. Sequencers, routers, and capability-merge utilities walk this metadata to bubble resource declarations up to the flow level.

#### Sequencer Resource Collection

Sequencers automatically collect `declaredResources` from all child blocks added through the DSL chain (`.step()`, `.parallel()`, `.rescue()`, etc.). Nested sequencers bubble their collected resources upward into the same flat map.

#### Flow-Level Resource Merge

`defineFlow` collects `declaredResources` from every action block and merges them into the flow's flat `resources` map. Flow-level declarations take priority on dedup; the merge errors at build time when two definitions share an accessor key but are different references:

```ts
const myFlow = defineFlow({
  kind: "my-app",
  actions: { chat: { block: pipeline } },
  resources: {
    // Flow-level plan overrides block-declared plan (same accessor key)
    plan: customPlanResource,
  },
});
```

#### Collision Detection

Two collision modes are checked at flow-build time:

1. **Same accessor key, different references** — same as before. Use the same `defineResource()` reference everywhere or pick distinct accessor keys.
2. **Different accessor keys, same effective storage key** — two definitions that resolve to the same `(scope, ref, flowIsolation, flowKind?)` tuple would silently share storage. Hard error.

Identity-equal re-registration is always safe (diamond dependencies through capabilities). Different accessor names pointing at the **same** `DefinedResource` reference share storage by design — the persisted slot is keyed by ref identity, not accessor name.

## Client Data

Client data entries are derived views — computed from state and resources within a single scope. They're the mechanism for exposing server-side data to clients.

```ts
session: {
  clientData: {
    activePlan: (ctx) => ctx.resources.plan?.state.steps ?? [],
    messageCount: (ctx) => ctx.state.messageCount ?? 0,
  },
}
```

Every `clientData` entry is a function, and every entry is client-visible. There's no `client: true/false` toggle — if it's in `clientData`, clients can see it.

### ClientDataComputeFn

```ts
type ClientDataComputeFn<TState, TResources> =
  (ctx: ClientDataContext<TState, TResources>) => JsonValue | Promise<JsonValue>;

type ClientDataContext<TState, TResources> = {
  state: Readonly<TState>;
  resources: TResources;
};
```

**Key differences from the former projection system:**
- **Single-scope context**: Each compute function receives only the state and resources from its own scope — no cross-scope access. A session-level `clientData` entry sees session state and session resources, nothing else.
- **No output schema validation**: Compute functions return `JsonValue` directly. Type safety comes from usage patterns, not runtime schema validation.
- **No `defineProjection()`**: There's no portable projection builder. For shared computation logic, extract a regular function.

### All Three Scopes

```ts
defineFlow({
  kind: "my-app",
  session: {
    clientData: {
      artifactsList: (ctx) => {
        const artifacts = ctx.resources.artifacts?.state;
        return artifacts?.order.map(id => ({
          id,
          title: artifacts.byId[id]?.title ?? "Untitled",
        })) ?? [];
      },
      modeStatus: (ctx) => ({
        currentMode: ctx.state.mode ?? "chat",
        requestCount: ctx.state.requestCount ?? 0,
      }),
    },
  },
  user: {
    clientData: {
      preferences: (ctx) => ({
        displayName: ctx.state.displayName ?? "User",
        preferredModel: ctx.state.preferredModel ?? "preset/fast",
      }),
    },
  },
  project: {
    clientData: {
      sharedConfig: (ctx) => ctx.state.config ?? {},
    },
  },
});
```

## Context Functions

Generators use `contextFn()` to pull typed data from scopes into model context — replacing the old projection reference helpers:

```ts
import { contextFn } from "@flow-state-dev/core";

const myContext = contextFn({
  sessionStateSchema: z.object({ mode: z.string() }),
  sessionResources: { plan: planResource },
  fn: (ctx) => {
    const steps = ctx.session.resources.plan?.state.steps ?? [];
    return `Current mode: ${ctx.session.state.mode}\nPlan steps: ${steps.join(", ")}`;
  },
});

const chatGenerator = generator({
  name: "chat",
  model: "preset/fast",
  prompt: "You are a helpful assistant.",
  context: [myContext],
  history: true,
  user: (input) => input.message,
});
```

### Prompt Formatters

The `@flow-state-dev/core/prompt` subpath provides utilities for formatting context data into LLM-friendly strings:

| Formatter | Purpose |
|-----------|---------|
| `section(title, content)` | Wrap content in a labeled section |
| `list(items)` | Bullet list |
| `keyValues(obj)` | Key-value pairs |
| `entries(items, fn)` | Map items through a formatter |
| `codeBlock(code, lang?)` | Fenced code block |
| `join(...parts)` | Concatenate with double newlines, filtering empties |
| `when(condition, content)` | Conditional inclusion |

## Type Helpers

The framework exports type utilities for working with resources and scopes:

```ts
import { StateOf, ContextOf, ResourceContext } from "@flow-state-dev/core";

// Extract state type from a schema or resource definition
type PlanState = StateOf<typeof planResource>;

// Get the context handle type for a scope/resource
type SessionCtx = ContextOf<typeof sessionStateSchema, "session">;
type PlanCtx = ContextOf<typeof planResource, "resource">;
```

`StateOf` and `ContextOf` work with both resource definitions and raw Zod schemas, so shared helper functions can use one consistent typing pattern.

## Client Visibility

Client-facing data is exposed through two complementary mechanisms:

1. **Scope-level `clientData`** — derived views computed from scope state and resources. Best for cross-resource projections and non-resource data.
2. **Resource-level `client`** — per-resource visibility, data projection, and content access. `client.content` controls content endpoints. `client.data` derives metadata for the snapshot. Best for exposing resource data directly to clients without manual projection.

### Scope-Level Client Data

Scope-level `clientData` remains unchanged — it computes derived values from state and resources within a single scope:

```
GET /api/flows/sessions/:sessionId/state
```

Returns scope-level client data grouped by scope:

```json
{
  "clientData": {
    "session": { "modeStatus": { "currentMode": "chat" } },
    "user": { "preferences": { "displayName": "User" } }
  }
}
```

### Resource-Level Client Exposure

Resources declare a `client` config to control what's visible to clients. `client.content` controls content endpoint access. `client.data` derives metadata for the snapshot.

```ts
// Single resource — content readable, data exposes derived state
defineResource({
  ref: 'soul',
  stateSchema: z.object({ values: z.array(z.string()), tone: z.string() }),
  content: `## Values\n{{#each values}}- {{this}}\n{{/each}}`,
  client: {
    content: { read: true },              // lazy by default
    // content: { read: true, prefetch: true },  // opt-in eager load
    data: (state) => ({ displayTone: state.tone }),
  },
})

// Collection — content readable and mutable
defineResourceCollection({
  ref: 'files',
  stateSchema: z.object({ mimeType: z.string(), size: z.number() }),
  client: {
    content: { read: true, create: true, update: true, delete: false },
    data: (state) => ({ size: state.size, mimeType: state.mimeType }),
  },
})
```

**Key rules:**
- `client.content` governs access to the rendered content body
- `client.data` derives metadata visible in the snapshot
- `create`, `update`, `delete` are collection-only — declaring them on a single resource is a type error
- Omitting `client` entirely means the resource is invisible to clients (no change from current behavior)

**Client-projection output type (FIX-741).** `defineResource` / `defineResourceCollection` carry the projected client-data type as a phantom (`ClientType`) alongside `StateType`, derived from the `client` config: `Pick` from `expose`, `Omit` from `exclude`, the awaited return of `data`, or the full state for the identity default. `ClientDataOf<typeof def>` extracts it, and the React hooks accept it as a `TClient` type parameter so `clientData` is typed instead of `unknown`. This is a pure type-level brand — `resolveClientProjection` and the `JsonValue` wire contract are unchanged; the hook applies a single projection-backed cast at its boundary. The `data` branch depends on the projection function's return type, so annotating that return is what threads a precise shape (the function's `state` argument is not concretely typed at the definer's inference position).

### Snapshot Response with Resources

The snapshot includes a `resources` key with metadata and `clientData` only — no content (except `prefetch: true` resources):

```json
{
  "clientData": { "session": { "modeStatus": {...} } },
  "resources": {
    "session": {
      "soul": { "clientData": { "displayTone": "Direct" } },
      "files": {
        "items": {
          "readme.md": { "clientData": { "size": 1240, "mimeType": "text/markdown" } },
          "notes.md": { "clientData": { "size": 430 } }
        }
      }
    }
  }
}
```

### Content Fetch Endpoints

Content is lazy-loaded via dedicated endpoints, gated by `client.content.read`:

```
GET /api/flows/sessions/:sessionId/resources/:ref/content          → single resource
GET /api/flows/sessions/:sessionId/resources/:ref/:topic/content   → collection item
```

### Mutation Endpoints (Collections Only)

```
POST   /api/flows/sessions/:sessionId/resources/:ref               → create item
PATCH  /api/flows/sessions/:sessionId/resources/:ref/:topic/content → update content
DELETE /api/flows/sessions/:sessionId/resources/:ref/:topic         → delete item
```

Server enforces declared permissions and rejects operations that exceed them.

#### Write ordering and `409 Conflict`

Item state and item content live in two stores (`ResourceStateStore`, `ContentStore`). Both write routes therefore follow one rule: **settle the state key first, then touch content.** A request that loses the state race returns `409` and never reaches `ContentStore`.

- **`POST`** inserts the state row at `expectedVersion: 0` (create-if-absent) and writes content only after that commits. Two concurrent creates of one topic yield one `201` and one `409`, and the stored body always belongs to the winner. The conflict is terminal — a losing create is never retried into an overwrite.
- **`DELETE`** reads the row's version, deletes state conditionally on it, and deletes content only after that commits. Deleting an absent topic is still an idempotent `200`.

**What the `DELETE` check covers.** The version is the one the *route* observes while serving the request, not one the caller supplied, so the window it closes is the route's own read→write window. A `DELETE` issued from a client view fetched earlier still reads the live row and removes it. A caller-supplied precondition is separate surface these routes do not accept ([FIX-1006](https://linear.app/fixpoint-labs/issue/FIX-1006)).

**Residuals, because a create is still two writes to two stores.** Between the `POST`'s state insert and its content write the item is *live but its content is not final*, and `ContentStore` is unversioned by decision, so no state predicate can fence a write to it:

| Window | Outcome |
| --- | --- |
| The content write fails | The item exists with empty content — visible in listings, repairable via `PATCH` when the collection grants `client.content.update` |
| A `DELETE` lands in the window | The create's body is orphaned behind the tombstone; a later create carrying no content revives the row over it, surfacing a deleted generation's content as current |
| A `PATCH` lands in the window | It is acknowledged `200` and then overwritten by the in-flight create |

These are accepted, not oversights. A version cannot distinguish a create's own row after a state write (version 2) from a successor generation created after a delete (also version 2) — the counter is per key, not per generation — so no post-hoc fence closes them without a generation-owner token, and a token still cannot fence a write to an unversioned store. Closing them is cross-record atomicity ([FIX-854](https://linear.app/fixpoint-labs/issue/FIX-854)). All three are pinned by tests in `packages/engine/test/resource-collection-routes.test.ts`.

### React Hooks

```ts
// Single resource — metadata from snapshot, content on demand
const { clientData, fetchContent } = useResource(session, 'soul')

// Convenience hook — fetches content immediately
const { clientData, content, isLoading } = useResourceContent(session, 'soul')

// Collection — metadata from snapshot, per-item content + CRUD actions
const { items, actions } = useResourceCollection(session, 'files')
await items['readme.md'].fetchContent()
await actions.create({ topic: 'spec.md', content: '# New Spec' })
await actions.update({ topic: 'readme.md', content: '# Updated' })
```

Mid-request, `state_change` and `resource_change` stream items signal invalidation — clients should refetch the snapshot on `request.completed`. The `resource_change` projection rides the registry's internal post-mutation seam (`onResourceChanged`); the same seam also drives in-session reactive blocks (`reactTo`) — see [Reactive blocks](/docs/resources/reactive-blocks) and the seam contract in [Resource Collections](./resource-collections.md#reactive-blocks-reactto).

## Canonical Authority

This document is authoritative for resources and client data. See also [flows-and-actions.md](./flows-and-actions.md) and [state-and-scopes.md](./state-and-scopes.md). For full type signatures, refer to the published types in `@flow-state-dev/core`.
