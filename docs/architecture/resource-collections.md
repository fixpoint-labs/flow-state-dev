# Resource Collections

A collection is a resource whose instances are created and destroyed at runtime under one schema and key pattern. The API, eviction, hooks, `reactTo` and when to use one are user-facing: [Resource Collections](../../apps/docs/docs/resources/collections.md), [Reactive blocks](../../apps/docs/docs/resources/reactive-blocks.md). General resource contracts: [Resources and Client Data](./resources-and-client-data.md).

## Access key vs storage key

The property name in a `resources` map is the runtime accessor (`ctx.resources.<name>`); the pattern only shapes **storage keys**. So one collection definition can be registered under different names in different blocks without conflict.

## Patterns

| Pattern | Matches |
|---|---|
| `files/*` | one level (`files/a.md`, not `files/src/a.ts`) |
| `files/**` | any depth; `**` must be the last segment |
| `[topic]/notes` | parameterised; pass `{ topic: "react" }` as the key → `react/notes` |

A collection pattern **cannot overlap** another collection pattern or a static resource name in the same scope. Owner-private patterns (`~`-prefixed segments) add stronger isolation rules: [Owner-private collections](./resources-and-client-data.md#owner-private-collections).

## `ResourceRef` identity

Every handle has immutable `path`, `scope` and `uri`:

- `path` is the canonical within-scope key: the accessor key or `config.ref` for a single resource; the resolved key for an instance. **For dual-registered aliases it's the canonical key**, not the alias, so two accessors to one ref produce identical `path`/`uri` (they share storage).
- `uri` is always `${scope}/${path}`: unique across scopes within a flow, opaque (not RFC-3986). Content tools and search address resources by `uri`, which keeps resolution unambiguous when two collections share a pattern in different scopes.

## Config stamped onto instances

`llmReadable` / `llmWritable` / `writable` are declared once on the collection and stamped onto every instance ref (`createNamespaceInstanceRef` puts `nsConfig` on `ref.config`), so content tools and search gate instances exactly as they gate single resources. `writable: false` makes every write throw (`patchState`, `setState`, `updateState`, `incState`, `pushState`, `upsert` patch, `writeContent`, `create({ replace: true })` on an existing key, `delete`), while `create` / `getOrCreate` of a **missing** key stay open. The LLM write tool admits on `llmWritable` alone, but persistence still honours `writable`.

## The post-mutation seam

`onInstance*` hooks and `reactTo` both ride one internal seam, `onResourceChanged`: fired after persistence, awaitable, carrying `changeType` (`created`/`updated`/`deleted`) and `{ state, prevState, evicted, contentWrite }`. Two consumers: the client `resource_change` projection and the in-session reactive dispatcher.

- `deleted` fires for both explicit `delete()` and capacity eviction; `evicted` tells them apart. A `client.live` collection streams a `null` delta for either, so the client tombstones mid-stream.
- Single resources fire only `updated`, and stream a client item only with `client.live`; a `reactTo`-only single runs its block without a client item.
- `writeContent` fires `updated` with `contentWrite` and no state delta. The dispatcher maps it to `contentUpdated` (not a state reaction); the client still sees `updated`.
- `onInstance*` hooks are synchronous and run inline: no heavy I/O.

## Storage and loading

- Instances and single resources share one flat keyspace, persisted per resource in `ResourceStateStore` ([State storage](./resources-and-client-data.md#state-storage)), so a write to one instance touches only that key.
- All lookups (`get`, `getOptional`, `list`, `count`) are async in **both** prefetch modes; the mode changes cost, not the API, so flipping it needs no call-site changes.
- `prefetchMode: 'eager'` (default): the prefix is bulk-loaded by the resource waves before any block reads it.
- `'lazy'`: keyed reads call `lazyLoad.getInstance(key)`; `list`/`count` call `lazyLoad.getByPrefix(prefix)`, and **a loaded prefix is authoritative** (the cache is complete for that collection afterwards). Both go through the shared single-flight map, so they dedupe against waves and concurrent dispatches. Both live in `createExecutionContext`.
- `eviction: "lru" | "oldest"` without `maxInstances` throws at definition.
