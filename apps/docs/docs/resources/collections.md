---
sidebar_position: 3
---

# Resource Collections

Static resources have a fixed name you declare up front: `plan`, `artifacts`, `preferences`. Resource collections handle the case where you don't know how many instances you'll need. An AI managing a set of files, accumulating observations per topic, or creating workspaces on the fly — these are collection problems.

A collection defines a shared schema and a key pattern. Instances are created and destroyed at runtime. The **property name** you assign in `sessionResources` is how you access it at runtime — not the pattern string.

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});

// Register under any property name:
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  //                   ^^^^^ this is the access key
  execute: async (_input, ctx) => {
    const files = ctx.session.resources.files;  // ← access via property name
    await files.create("readme.md", { language: "markdown" });
  },
});
```

## Patterns

The pattern string determines which keys a collection can hold.

| Pattern | Example keys | Behavior |
|---------|-------------|----------|
| `files/*` | `files/readme.md` | Single-level wildcard. `files/src/utils.ts` would not match. |
| `files/**` | `files/readme.md`, `files/src/deep/nested.ts` | Deep wildcard. Matches any depth. |
| `[topic]/notes` | `react/notes`, `rust/notes` | Parameterized segment. The bracketed portion becomes a key parameter. |

`**` must be the last segment. Parameterized segments use `[name]` syntax.

## Runtime API

Collection entries on scope resource registries are `ResourceCollectionRef` instances.

### Core operations

The lookups (`get`, `getOptional`, `list`, `count`) return Promises, so `await` them. This is the same call shape regardless of `prefetchMode` — see [Eager vs lazy collections](#eager-vs-lazy-collections).

```ts
execute: async (input, ctx) => {
  const files = ctx.session.resources.files;

  // Create a new instance — returns a ResourceRef
  const ref = await files.create("readme.md", { language: "markdown" });

  // Get existing instance (throws if not found)
  const existing = await files.get("utils.ts");

  // Get or create — returns existing if present, creates with defaults if not
  const safe = await files.getOrCreate("config.json", { language: "json" });

  // List all instances, optionally filtered by prefix
  const allFiles = await files.list();
  const srcFiles = await files.list("src/");

  // Delete an instance (no-op if not found)
  await files.delete("old-file.ts");

  // Current instance count
  const count = await files.count();
}
```

Each returned `ResourceRef` supports the same operations as a static resource: `state`, `patchState()`, `setState()`, `updateState()`, `readContent()`, `readContentRaw()`. The `state` getter on a resolved ref is synchronous — you await the lookup, not the read of an already-resolved ref.

Each returned ref also carries `path`, `scope`, and `uri` fields for identity — see [Resource identity](./overview#resource-identity-path-scope-and-uri) for details.

### `create({ replace })` and `upsert` — handling the exists/missing branches

Two additional operations cover the recurring "is the instance already there?" patterns that show up in setup/reset and incremental-update paths:

```ts
execute: async (input, ctx) => {
  const files = ctx.session.resources.files;

  // Replace-or-create: overwrites existing state, creates if missing.
  // `setState` semantics — Zod `.default(null)` fills nullables, so a
  // prior published memo's body/headline reset cleanly on re-run.
  await files.create("readme.md", { language: "markdown" }, { replace: true });

  // Patch-or-create: applies a delta on exists, creates on missing.
  // 2-arg form — the second arg is patched on exists, used as-is on create.
  await files.upsert("readme.md", { language: "javascript" });

  // 3-arg form: `createOnly` extras fill fields you only need at first
  // creation. On exists, only `update` is applied; on missing, the
  // instance is created with `{ ...createOnly, ...update }` (update wins
  // on overlapping keys).
  await files.upsert(
    "readme.md",
    { language: "javascript" },          // patch — always applied
    { metadata: { createdBy: "setup" } } // create-only — only on first touch
  );
}
```

The four "if-exists / if-missing" patterns:

| API | If exists | If missing |
| --- | --- | --- |
| `create(k, s)` | throws | creates |
| `create(k, s, { replace: true })` | replaces (setState, defaults fill) | creates |
| `getOrCreate(k, init?)` | returns as-is | creates |
| `upsert(k, update, createOnly?)` | patches | creates with `{ ...createOnly, ...update }` |

Both new operations fire the right lifecycle hooks: `onInstanceUpdated` on the replace/patch branch, `onInstanceCreated` on the create branch. `maxInstances` is only checked when adding a new instance — replacing or patching an existing one never trips the guard.

### Parameterized patterns

When a pattern has `[name]` segments, pass an object key instead of a string:

```ts
const topicNotes = defineResourceCollection({
  pattern: "[topic]/notes",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
});

// Register under any property name:
sessionResources: { notes: topicNotes }

// At runtime:
const notes = ctx.session.resources.notes;
const ref = await notes.create({ topic: "react" }, { entries: [] });
// Storage key: "react/notes"

const existing = await notes.get({ topic: "rust" });
```

The framework resolves `{ topic: "react" }` to the storage key `react/notes`.

## Eviction

When `maxInstances` is set, the collection enforces a cap on live instances:

| Policy | Behavior |
|--------|----------|
| `"none"` (default) | Throws when the cap is reached. You must `delete()` before creating more. |
| `"lru"` | Evicts the least-recently-accessed instance. |
| `"oldest"` | Evicts the first-created instance. |

Setting `eviction` to `"lru"` or `"oldest"` without `maxInstances` throws at definition time. Without `maxInstances`, the collection is unbounded.

Set `maxInstances` for any collection that could grow without limit. An AI creating files in a loop with no cap will cause memory and storage pressure. `"lru"` is the safest default — it keeps the working set and discards stale entries.

## Eager vs lazy collections

`prefetchMode` is a loading-cost knob, not an API-shape knob. All reads (`get`, `getOptional`, `list`, `count`) are async in both modes — you always `await` them. What `prefetchMode` changes is *when* the data loads, not how you call for it. Flipping the mode requires zero call-site changes. The default is `"eager"`.

| Mode | When instances load | What a read does |
|------|---------------------|------------------|
| `"eager"` (default) | Whole prefix preloaded into an in-memory cache before any block reads it | Resolves instantly against the cache |
| `"lazy"` | Nothing up front; each access fetches from the store on demand and caches the result | One store read on a cache miss, then cached |

Same call shape either way:

```ts
const one = await files.get("readme.md");
const all = await files.list();
const n = await files.count();
```

The `ResourceRef` you get back has a synchronous `.state` getter. You await the lookup, not the read of an already-resolved ref:

```ts
const ref = await files.get("readme.md");
const title = ref.state.language; // sync
```

Mutations (`create`, `getOrCreate`, `upsert`, `delete`) are async in both modes too.

### Eager (default)

Eager is the right default for collections with a bounded, predictable size. The whole set is in memory, so `list()` and `count()` are exact and resolve without a store round-trip.

### Lazy

Set `prefetchMode: "lazy"` to defer loading:

```ts
const docs = defineResourceCollection({
  pattern: "docs/**",
  stateSchema: z.object({ title: z.string().default("") }),
  prefetchMode: "lazy",
});
```

Reach for lazy when a collection is large or unbounded and a typical request only touches a few keys by name. You pay one store read per key instead of scanning the whole prefix up front.

### The cost of `list()` and `count()` on a lazy collection

On a lazy collection, `list()` or `count()` reads the entire collection prefix in one unbounded scan. There's no pagination today. That's fine for an occasional full scan, but on a large collection it defeats the point of going lazy. Prefer `get(key)` by key on lazy collections, and fall back to `list()`/`count()` only when you genuinely need the whole set.

### Lazy requires `eviction: "none"`

A lazy collection only ever holds a partial cache, so eviction can't see the full set to make a correct decision. Combining `prefetchMode: "lazy"` with any eviction policy other than `"none"` throws at definition time. `maxInstances` and eviction still apply under eager mode exactly; under lazy they're best-effort and only see the instances that have been loaded.

A lazy single resource is also restricted: declaring `prefetchMode: "lazy"` on a single resource at flow level throws, because a flow-level declaration has no per-block dispatch to trigger the load. Declare it on the block that needs it instead.

### Observing load costs in the DevTool

Picking eager or lazy is a guess until you can see what it costs. The DevTool surfaces per-block resource-load metrics: which keys were fetched from the store versus served from cache, how long each fetch took, and whether your eager prefetch is actually earning its keep. Select a block in the trace and open its Resource Loads panel. See [Observing resource loads](../devtool/observing-resource-loads.md).

## Lifecycle hooks

Collections support per-instance hooks for logging, side effects, or cleanup:

```ts
defineResourceCollection({
  pattern: "files/**",
  stateSchema: fileSchema,
  onInstanceCreated: (key, state, ctx) => {
    ctx.log(`Created: ${key}`);
  },
  onInstanceUpdated: (key, state, prevState, ctx) => {
    ctx.log(`Updated: ${key}`);
  },
  onInstanceDeleted: (key, ctx) => {
    ctx.log(`Deleted: ${key}`);
  },
});
```

Hook context provides `log(message)` and `scopeType`. Hooks are synchronous.

## Block declarations

Collections work with block-level resource declarations the same way static resources do:

```ts
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  execute: async (_input, ctx) => {
    await ctx.session.resources.files.create("output.md", {
      language: "markdown",
    });
  },
});
```

Sequencers collect collection declarations from child blocks. `defineFlow` merges them into scope configs. Two blocks declaring different collection refs for the same name will throw at build time. Same ref instance, no conflict.

## Storage model

Collection instances are stored in the same flat `resources` map as static resources. A collection with pattern `files/**` stores instances under keys like `files/readme.md` and `files/src/utils.ts`. No schema changes to scope records are needed.

## When to use collections vs static resources

Static resources work when you know the names ahead of time. Collections work when you don't.

The deciding factors:
- **Unknown count** — you can't enumerate the instances at definition time
- **Independent lifecycles** — each instance is created, updated, and potentially deleted on its own schedule
- **Pattern-based organization** — instances naturally fit a path structure

If the set is bounded and predictable (three artifact slots), a static resource with an array or record in its state is simpler. Collections add value when the set is dynamic and potentially large.

## Exposing collections to clients

Collections can declare a `client` config to make their items visible to the frontend. This gives you React hooks for listing items, lazy-loading content, and performing CRUD operations. See [Client Access](/docs/resources/client-access) for the full reference.

## Lazy state by default

Collection state is fetched on demand. The session snapshot no longer carries every item's state — that approach broke down once collections grew past a few dozen items, and shared (org-scoped) collections made the bloat unworkable across sessions.

What the snapshot carries for each client-visible collection:

```ts
resources: {
  session: {
    artifacts: {
      count: 132,        // total items, always emitted
      prefetched?: [...]  // optional, only when prefetchWindow is set
    }
  }
}
```

There's no `items` map anymore. Clients fetch a page when they need one.

### Listing items from a client

Two surfaces, same data:

- **HTTP**: `GET /sessions/:sessionId/resources/:ref?limit=&offset=&topicPrefix=` returns one page.
- **React**: [`useResourceCollectionList`](/docs/client/react) wraps that endpoint and handles the React state lifecycle.

A minimal example:

```tsx
const { items, pagination, loadMore } = useResourceCollectionList(session, "artifacts", {
  limit: 50,
});

return (
  <>
    {items.map((item) => <ArtifactRow key={item.topic} item={item} />)}
    {pagination?.hasMore && <button onClick={loadMore}>Load more</button>}
  </>
);
```

Each item is a `CollectionItemHandle` with `topic`, `clientData`, and a lazy `fetchContent()` that hits the existing content endpoint.

The page response shape mirrors the rest of the framework:

```ts
{
  items: [{ topic: string, clientData?: unknown }],
  pagination: { offset, limit, total, hasMore, nextOffset }
}
```

`limit` defaults to 50 and is capped at 200.

### Filtering with topicPrefix

Pass `topicPrefix` to narrow the page. The prefix matches the **full storage key**, not just the topic suffix. So for a collection with pattern `artifacts/**`, items have keys like `artifacts/projects/abc/spec.md`, and `topicPrefix: "artifacts/projects/abc"` matches all items under that namespace.

```tsx
useResourceCollectionList(session, "artifacts", {
  topicPrefix: "artifacts/projects/abc",
});
```

This pairs with the namespacing convention from parameterized patterns — `[topic]/observations` keys naturally compose into prefix queries.

### prefetchWindow

For small, always-needed collections, the snapshot can carry the first N items inline. Set `prefetchWindow` on the collection definition:

```ts
defineResourceCollection({
  pattern: "artifacts/**",
  stateSchema: artifactSchema,
  client: {
    state: { read: true },
    data: (state) => ({ title: state.title }),
  },
  prefetchWindow: 20,
});
```

The snapshot then includes `prefetched: [{ topic, clientData }, ...]` for the first 20 items. Consumers render immediately without an extra round-trip; the convenience hook surfaces them as the initial paint. (The DevTool sees all items in a collection regardless of `prefetchWindow` — see [Debug vs client state](../devtool/debug-vs-client-state.md).)

Ordering is by **lexicographic storage key**, not by recency. There's no per-item `updatedAt` on the storage layer today, so picking the "most recently updated" 20 items would require schema work that's deliberately out of scope for this version. Apps that need recency can encode timestamps into topic keys (e.g., `2026-05-06T12:00|spec.md`); a future revision may add a richer ordering model.

The default is `0` (no prefetched window).

### Server-side projections still work

Scope-level `clientData` functions that call `collection.list()` continue to work. Lazy snapshots changed what the server *emits*, not what it *loads* — the full `persisted` map is still available to the projection function.

### Migration from earlier versions

The old snapshot carried `resources[scope][ref].items` as a record of every item's `clientData`. That field is gone except via an internal escape hatch that's removed before the next minor release. To migrate:

1. Replace `useResourceCollection({ items, actions })` destructure with `useResourceCollectionList(session, ref, { limit })` for paginated rendering, or call `list()` directly from `useResourceCollection` for custom flows.
2. Add `client: { state: { read: true } }` to any collection whose per-item `clientData` should remain visible to clients. State is gated separately from content now.
3. If you relied on `Object.keys(items).length` for a count, read the always-emitted `count` field from the snapshot.

See the changelog entry for the per-version detail.
