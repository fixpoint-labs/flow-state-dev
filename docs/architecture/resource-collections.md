# Resource Collections

Static resources are declared by name at definition time. You know up front that there's a `plan` resource and an `artifacts` resource. Resource collections handle the case where you don't know how many instances you'll need. An AI managing files, accumulating per-topic observations, or creating workspaces on the fly — these are collection problems.

A collection defines a shared schema and pattern. Instances are created and destroyed at runtime. The property name you assign in `sessionResources` (or `userResources`, `projectResources`) is the key you use to access the collection at runtime — not the pattern string.

```ts
import { defineResourceCollection } from "@flow-state-dev/core";

const filesCollection = defineResourceCollection({
  pattern: "files/**",
  stateSchema: z.object({ language: z.string().default("text") }),
  maxInstances: 200,
  eviction: "lru",
});

// In a block definition:
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  //                   ^^^^^ this property name = ctx.session.resources.files
  execute: async (input, ctx) => {
    const files = ctx.session.resources.files;
    // ...
  },
});
```

For background on resources in general, see [Resources and Client Data](./resources-and-client-data.md).

## How access keys work

The property name in `sessionResources` determines how you access the collection on `ctx.session.resources`. The pattern string only affects **storage keys** for instances.

```ts
// You declare:
sessionResources: { docs: myCollection }

// You access:
ctx.session.resources.docs  // ← property name, not the pattern

// Instances are stored under pattern-resolved keys:
// "documents/readme.md", "documents/src/utils.ts", etc.
```

This means the same collection definition can be registered under different property names in different blocks or flows without conflict.

## Patterns

The pattern string determines which keys a collection can hold and how they're matched.

| Pattern | Example keys | Behavior |
|---------|-------------|----------|
| `files/*` | `files/readme.md` | Single-level wildcard. `files/src/utils.ts` would not match. |
| `files/**` | `files/readme.md`, `files/src/deep/nested.ts` | Deep wildcard. Matches any depth. |
| `[topic]/observations` | `react/observations`, `rust/observations` | Parameterized segment. The `[name]` portion becomes a key parameter. |

Constraints:
- `**` must be the last segment
- Parameterized segments use `[name]` syntax
- A collection pattern cannot overlap with another collection pattern or a static resource name in the same scope

## Runtime API — `ResourceCollectionRef`

At runtime, collection entries on scope resource registries (`ctx.session.resources`, `ctx.user.resources`, `ctx.project.resources`) are `ResourceCollectionRef` instances.

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

  // List one page of instances. Cursor-paginated; see "Listing instances" below.
  const firstPage = await files.list({ prefix: "src/", limit: 50 });
  for (const f of firstPage.items) { /* ... */ }

  // Or iterate every instance with the auto-paging async iterator
  for await (const f of files.scan({ prefix: "src/" })) { /* ... */ }

  // Delete an instance (no-op if not found)
  await files.delete("old-file.ts");

  // Current instance count
  const count = await files.count();
}
```

Each returned `ResourceRef` supports the same operations as a static resource: `await ref.state()`, `patchState()`, `setState()`, `updateState()`, `readContent()`, `readContentRaw()`.

The accessor methods that read from a collection are async: `get`, `getOptional`, `list`, `scan`, and `count` all return promises (or async iterators). This is what lets a collection load lazily — a `get` on a non-prefetched instance issues a store read on demand. Inside a handler, the per-resource handler context (`ctx.state`) stays synchronous; only the standalone `ResourceRef`/`ResourceCollectionRef` accessor surface is async.

### Listing instances

`list` returns one page at a time with an opaque cursor:

```ts
let cursor: string | undefined;
do {
  const page = await files.list({ prefix: "src/", limit: 50, cursor });
  for (const ref of page.items) { /* ... */ }
  cursor = page.nextCursor;
} while (cursor !== undefined);
```

`limit` defaults to 50 and is clamped to `[1, 1000]`. `cursor` is the last-seen key from the previous page's `nextCursor`; pass it back to fetch the next page. The end of the list is `nextCursor === undefined`. An empty `items` page with a defined `nextCursor` is legitimate — a `prefix` filter can eliminate every key on a page while more pages remain, so keep paging until `nextCursor` is undefined.

`scan` wraps that loop. It's an auto-paging async iterator over every matching instance in lexicographic key order, with an optional `pageSize` and an `AbortSignal` for cancellation:

```ts
const controller = new AbortController();
for await (const ref of files.scan({ prefix: "src/", signal: controller.signal })) {
  // process ref; call controller.abort() to stop early
}
```

### Parameterized patterns

When a pattern has `[name]` segments, pass an object key instead of a string:

```ts
const topicNotes = defineResourceCollection({
  pattern: "[topic]/notes",
  stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
});

// Register under any property name you want:
sessionResources: { notes: topicNotes }

// At runtime:
const notes = ctx.session.resources.notes;
const ref = await notes.create({ topic: "react" }, { entries: [] });
// Storage key: "react/notes"

const existing = await notes.get({ topic: "rust" });
// Storage key: "rust/notes"
```

The framework resolves `{ topic: "react" }` to the storage key `react/notes`.

## Eviction

When `maxInstances` is set, the collection enforces a cap on live instances. What happens when a `create()` would exceed that cap depends on the eviction policy:

| Policy | Behavior |
|--------|----------|
| `"none"` (default) | Throws an error. The caller must explicitly `delete()` before creating more. |
| `"lru"` | Evicts the least-recently-accessed instance to make room. |
| `"oldest"` | Evicts the first-created instance. |

Setting `eviction` to `"lru"` or `"oldest"` without `maxInstances` throws at definition time. If you don't set `maxInstances`, the collection is unbounded.

Practical guidance: set `maxInstances` for any collection that could grow without limit. An AI that creates files in a loop with no cap will eventually cause memory and storage pressure. `"lru"` is the safest default for most use cases — it keeps the working set and discards stale entries.

## Prefetch modes

`prefetchMode` controls how much of a collection loads into the execution context when a scope starts up. It's a server-side loading knob — distinct from `prefetchWindow`, which shapes the client SSE snapshot (see below).

```ts
defineResourceCollection({
  pattern: "memos/**",
  stateSchema: memoSchema,
  prefetchMode: "partial",
  recentLimit: 20,
});
```

| Mode | What loads at startup | Reads after startup |
|------|----------------------|---------------------|
| `"eager"` (default) | Every matching instance in the scope. | Served from the in-memory cache. |
| `"lazy"` | Nothing. | `get` / `getOptional` / `list` / `scan` / `count` fetch from the store on demand. |
| `"partial"` | The `recentLimit` lexicographically highest keys (loaded descending). | Cached instances served from memory; everything else fetched on demand. |

The tradeoff is startup cost versus per-access cost. `eager` pays the full load up front and every subsequent read is in-memory. `lazy` trades a per-access store read for a near-zero startup cost — reach for it when a collection can hold thousands of instances but a given request only touches a handful, or when the collection is shared (org-scoped) and most sessions never read it. `partial` is the middle ground: it preloads a recent working set and leaves the long tail lazy.

`recentLimit` is required when `prefetchMode` is `"partial"` and ignored otherwise. It must be a positive integer, must not exceed `maxInstances` when that's set, and is hard-capped at 10000 (above that `defineResourceCollection` throws). Values above 1000 warn — eagerly loading that many instances at startup inflates request latency and memory.

### The sortable-key convention for `partial`

`partial` loads the highest keys, sorted lexicographically descending. To get "most-recent N" semantics out of that, encode order into the storage key. Two common conventions:

- Zero-padded counters: `memos/00042`, `memos/00043` — the newest sort highest.
- ISO-timestamp prefixes: `memos/2026-05-28T14:00:00Z|spec` — recent timestamps sort highest.

Without a sortable convention, "highest key" is just an arbitrary slice of the keyspace, not a recency window.

### `prefetchMode` vs `prefetchWindow`

These are separate knobs that happen to both contain "prefetch":

- `prefetchMode` shapes **server-side execution-context loading** — how many instances are in memory while a flow runs.
- `prefetchWindow` shapes the **client SSE snapshot** — how many items are inlined in the `prefetched` window the browser receives. See [Resources and Client Data](./resources-and-client-data.md) for the client side.

You can set them independently. A collection can be `prefetchMode: "lazy"` (load nothing server-side) yet still set `prefetchWindow` (inline a few items in the snapshot for first paint), or vice versa.

Single resources accept `prefetchMode?: 'eager' | 'lazy'` too. `'eager'` (default) loads state at scope startup; `'lazy'` fetches it on the first `state()` call and caches it for the rest of the request. A single resource has one state, so `'partial'` is collection-only and `defineResource` throws if you pass it.

## Lifecycle hooks

Collections support per-instance lifecycle hooks for logging, side effects, or cleanup:

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

Hook context (`CollectionHookContext`) provides `log(message)` and `scopeType`. Hooks are synchronous — they run inline during the operation and should not perform heavy I/O.

## Storage model

Collection instances and single resources share one flat keyspace for state. A collection with pattern `files/**` stores instances under keys like `files/readme.md`, `files/src/utils.ts`. Resource state — single and collection-instance alike — is persisted per-resource in the keyed `ResourceStateStore`, separate from the scope record (see [State Storage](./resources-and-client-data.md#state-storage)). The in-execution view is still a flat map, so accessors are unchanged; the difference is that a write to one instance touches only that instance's key instead of rewriting the whole scope record.

## Block declarations

Collections work with block-level resource declarations the same way static resources do:

```ts
const fileManager = handler({
  name: "file-manager",
  sessionResources: { files: filesCollection },
  execute: async (input, ctx) => {
    const ref = await ctx.session.resources.files.create("output.md", {
      language: "markdown",
    });
    return input;
  },
});
```

Sequencers collect collection declarations from child blocks. `defineFlow` merges them into scope configs. Conflict detection applies: two blocks declaring different collection refs for the same name will throw at build time. If both blocks reference the same `defineResourceCollection()` instance, the merge succeeds.

## When to use collections vs static resources

Use a static resource when you know the resource names at definition time: `plan`, `artifacts`, `preferences`. These are fixed parts of your flow's data model.

Use a collection when instances come and go at runtime. The deciding factors:

- **Unknown count** — you can't enumerate the instances ahead of time
- **Independent lifecycles** — each instance is created, updated, and potentially deleted on its own schedule
- **Pattern-based organization** — instances naturally fit a path structure (`files/src/utils.ts`, `topics/react/notes`)

If the collection is bounded and predictable (say, three artifact slots), a static resource with an array or record in its state is simpler. Collections add value when the set is dynamic and potentially large.

## Canonical Authority

This document is authoritative for resource collections. See also [flows-and-actions.md](./flows-and-actions.md) and [state-and-scopes.md](./state-and-scopes.md). For full type signatures, refer to the published types in `@flow-state-dev/core`.
