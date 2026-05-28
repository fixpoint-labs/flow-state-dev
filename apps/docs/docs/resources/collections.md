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

```ts
execute: async (input, ctx) => {
  const files = ctx.session.resources.files;

  // Create a new instance — returns a ResourceRef
  const ref = await files.create("readme.md", { language: "markdown" });

  // Get existing instance (throws if not found)
  const existing = await files.get("utils.ts");

  // Get or create — returns existing if present, creates with defaults if not
  const safe = await files.getOrCreate("config.json", { language: "json" });

  // List one page of instances, optionally filtered by prefix
  const page = await files.list({ prefix: "src/", limit: 50 });
  for (const f of page.items) { /* ... */ }

  // Or iterate every instance with the auto-paging async iterator
  for await (const f of files.scan({ prefix: "src/" })) { /* ... */ }

  // Delete an instance (no-op if not found)
  await files.delete("old-file.ts");

  // Current instance count
  const count = await files.count();
}
```

Each returned `ResourceRef` supports the same operations as a static resource: `ref.state` (a synchronous property), `patchState()`, `setState()`, `updateState()`, `readContent()`, `readContentRaw()`.

The collection's read accessors are async: `get`, `getOptional`, `list`, `scan`, and `count` all return promises or async iterators. That's what lets a collection load instances on demand instead of all at once. The ref you get back already has its state loaded, so `ref.state` is a plain synchronous property — you only await the lookup, not the read.

#### Paginating with `list` and `scan`

`list` returns one page plus an opaque cursor:

```ts
let cursor: string | undefined;
do {
  const page = await files.list({ prefix: "src/", limit: 50, cursor });
  for (const ref of page.items) { /* ... */ }
  cursor = page.nextCursor;
} while (cursor !== undefined);
```

`limit` defaults to 50, clamped to `[1, 1000]`. The end of the list is `nextCursor === undefined`. An empty `items` page with a defined `nextCursor` is legitimate — a `prefix` filter can empty a page while more remain, so keep paging until `nextCursor` is undefined.

`scan` is the same loop as an async iterator over every matching instance in key order. It accepts `prefix`, `pageSize`, and an `AbortSignal`:

```ts
for await (const ref of files.scan({ prefix: "src/" })) {
  // process each instance
}
```

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

## Prefetch modes

`prefetchMode` decides how much of a collection loads into the execution context when a scope starts up. It's a server-side loading knob. (It's separate from `prefetchWindow`, which shapes the client snapshot — covered under [Lazy state](#lazy-state-by-default).)

```ts
defineResourceCollection({
  pattern: "memos/**",
  stateSchema: memoSchema,
  prefetchMode: "partial",
  recentLimit: 20,
});
```

| Mode | Loads at startup | Reads after startup |
|------|------------------|---------------------|
| `"eager"` (default) | Every matching instance. | Served from memory. |
| `"lazy"` | Nothing. | `get` / `getOptional` / `list` / `scan` / `count` read from the store on demand. |
| `"partial"` | The `recentLimit` highest keys (loaded lexicographically descending). | Cached instances from memory; the rest on demand. |

The tradeoff is startup cost versus per-access cost. `eager` pays the full load up front so every later read is in-memory. `lazy` trades a per-access store read for a near-zero startup cost — good when a collection holds thousands of instances but a request touches only a few, or when it's shared across sessions and most never read it. `partial` preloads a recent working set and leaves the long tail lazy.

`recentLimit` is required for `"partial"` and ignored otherwise. It must be a positive integer, must not exceed `maxInstances` when set, and is capped at 10000 (above that, definition throws). Above 1000 it warns, since loading that many instances at startup costs latency and memory.

### Sortable keys for `partial`

`partial` loads the highest keys, sorted descending. To turn that into "most-recent N," encode order into the storage key — zero-padded counters (`memos/00042`) or ISO-timestamp prefixes (`memos/2026-05-28T14:00:00Z|spec`). Both make the newest entries sort highest. Without a sortable convention, "highest key" is an arbitrary slice, not a recency window.

Single resources accept `prefetchMode?: 'eager' | 'lazy'` as well. `'lazy'` fetches state on the first `state()` call and caches it for the request. `'partial'` is collection-only; passing it to a single resource throws.

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

- **HTTP**: `GET /sessions/:sessionId/resources/:ref?limit=&cursor=&topicPrefix=` returns one page. Pagination is cursor-based: the response carries the next page's cursor, and you pass it back as `?cursor=` until there's no next cursor. `limit` defaults to 50. (The exact response field names are finalized in the route slice; the model is "items plus an opaque next cursor.")
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

The page response carries a list of items plus an opaque cursor for the next page:

```ts
{
  items: [{ topic: string, clientData?: unknown }],
  pagination: { limit, nextCursor? }   // nextCursor absent ⇒ last page
}
```

You request the next page by passing the previous `nextCursor` back as `?cursor=`; pagination ends when no `nextCursor` is returned. `limit` defaults to 50. (The pagination field names are finalized in the route slice; the model is "items plus an opaque next cursor," matching the `list`/`scan` accessors above.)

### Filtering with topicPrefix

Pass `topicPrefix` to narrow the page. The prefix matches the **full storage key**, not just the topic suffix. So for a collection with pattern `artifacts/**`, items have keys like `artifacts/projects/abc/spec.md`, and `topicPrefix: "artifacts/projects/abc"` matches all items under that namespace.

```tsx
useResourceCollectionList(session, "artifacts", {
  topicPrefix: "artifacts/projects/abc",
});
```

This pairs with the namespacing convention from parameterized patterns — `[topic]/observations` keys naturally compose into prefix queries.

### prefetchWindow

`prefetchWindow` is the client-snapshot twin of [`prefetchMode`](#prefetch-modes). `prefetchMode` controls server-side loading (what's in the execution context); `prefetchWindow` controls the client snapshot (what's inlined for the browser). They're independent — a `lazy` collection can still set `prefetchWindow`, and an `eager` one can leave it at `0`.

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

Scope-level `clientData` functions that page through a collection with `await collection.list({ ... })` (or `collection.scan(...)`) continue to work. Lazy snapshots changed what the server *emits*, not what it *loads*. Note that under `prefetchMode: "lazy"` or `"partial"` these reads may hit the store rather than an in-memory cache, so a projection that walks the whole collection pays that cost; reach for `prefetchMode: "eager"` if a projection must read every instance on every request.

### Migration from earlier versions

The old snapshot carried `resources[scope][ref].items` as a record of every item's `clientData`. That field is gone except via an internal escape hatch that's removed before the next minor release. To migrate:

1. Replace `useResourceCollection({ items, actions })` destructure with `useResourceCollectionList(session, ref, { limit })` for paginated rendering, or call `list()` directly from `useResourceCollection` for custom flows.
2. Add `client: { state: { read: true } }` to any collection whose per-item `clientData` should remain visible to clients. State is gated separately from content now.
3. If you relied on `Object.keys(items).length` for a count, read the always-emitted `count` field from the snapshot.

See the changelog entry for the per-version detail.
