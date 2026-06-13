---
sidebar_position: 8
sidebar_label: Cached Fetch
---

# Cached Fetch

Cached Fetch gives fetched or computed data a home that knows how old it is. Fetch a value once, reference it by a stable key, and treat it as good for some number of minutes. The next block that asks for the same key inside that window gets the stored value instead of paying for the fetch again. Past the window, the next read refetches.

You consume it as a capability. A capability is a self-contained bundle of resources, context, and helpers that a block opts into with `uses: [cap]`. See [Capabilities](../fundamentals/capabilities.md) for the general model. Cached Fetch rides on a normal [resource collection](../resources/collections.md) — a typed, key-addressed set of persisted instances — so its cache is real persisted data, not an in-memory side table that vanishes between requests.

A **freshness window** is the maximum age a stored value may have and still be served. Set it with `staleAfter`. A value younger than `staleAfter` is fresh and served as-is. A value older than that is stale and triggers a refetch on the next read.

## When to reach for this

The framework already has two other caching mechanisms. Cached Fetch is the third, and it occupies a spot the other two don't cover.

**Tool-call memoization** (the `cacheable` flag on a tool, covered in [Flow policy](./flow-policy.md) and [Tools overview](../tools/overview.md)) is input-addressed and lives in memory for the duration of a run. Two workers calling the same tool with the same arguments share one execution. When the run ends, the cache is gone. Reach for it to dedupe redundant tool calls inside one fan-out. It has no notion of "this value is good for 15 minutes across requests."

**Plain resource collections** are identity-addressed and persisted. You write a value under a key, and it stays there across requests until you overwrite or delete it. What they lack is time. A collection entry written an hour ago looks identical to one written a second ago.

Cached Fetch is identity-addressed and persisted like a collection, and freshness-bounded like a TTL cache. Reach for it when you fetch something external (a quote, a profile, an embedding, a rendered report) that's expensive to compute, stable for a known window, and worth keeping warm across requests and across blocks.

## Basic usage

Create the capability once, give it a default freshness window, and add it to any block's `uses`. The capability declares its own cache collection, so it installs that collection into every block that uses it. You don't declare a resource per flow.

```ts
import { createCachedFetchCapability } from "@flow-state-dev/patterns";

const marketData = createCachedFetchCapability({
  name: "cache",      // accessor name on ctx.cap (default "cache")
  staleAfter: "15m",  // default freshness window, overridable per call
});
```

On a block, opt in with `uses`, then call through `ctx.cap.<name>`. Inside a tool the block owns, `getOrFetch` is the input-addressed entry point: pass a tool name and its arguments, and the accessor builds the key for you.

```ts
import { handler } from "@flow-state-dev/core";
import { z } from "zod";

const quoteTool = handler({
  name: "get-quote",
  inputSchema: z.object({ ticker: z.string() }),
  outputSchema: z.object({ price: z.number() }),
  uses: [marketData],
  execute: async ({ ticker }, ctx) => {
    const quote = await ctx.cap.cache.getOrFetch(
      "get_quote",
      { ticker },
      () => fetchQuote(ticker),
    );
    return { price: quote.price };
  },
});
```

The key is `get_quote/<canonicalized args>`. Argument order and key order don't matter — the args are canonicalized before they become part of the key, so `{ ticker: "ABC" }` and the same object built in a different order hit the same entry.

When you have your own stable identity for a value, skip the tool sugar and use `getOrCompute`. It takes the key directly. Use it for domain-keyed data where you already know the identity.

```ts
const profile = await ctx.cap.cache.getOrCompute(
  `profile/${userId}`,
  () => loadProfile(userId),
);
```

Both methods accept a per-call overrides object as a final argument, so a single accessor can serve a 15-minute default and a 6-hour exception side by side:

```ts
const slowMoving = await ctx.cap.cache.getOrCompute(
  `sector-map/${sector}`,
  () => loadSectorMap(sector),
  { staleAfter: "6h" },
);
```

To force a refetch, invalidate by exact key or by prefix. It returns the number of entries removed.

```ts
await ctx.cap.cache.invalidate(`profile/${userId}`); // exact key
await ctx.cap.cache.invalidate("get_quote/");        // prefix: every quote
```

## Freshness semantics

Freshness is evaluated app-side, on read. Every stored entry carries a `storedAt` timestamp in its persisted envelope. When a block reads a key, the accessor compares the entry's age against `staleAfter` and decides whether to serve it or refetch. The store is never asked to expire anything.

Two consequences follow from that. Freshness works on any store backend, because it's plain arithmetic over a timestamp the framework wrote. And shortening `staleAfter` in a deploy takes effect immediately on existing entries, because the next read recomputes age against the new window. There's no stored expiry baked into the entry to invalidate.

Expiry is lazy. A stale entry isn't deleted when it goes stale. It sits in the collection until a refetch overwrites it or the collection's eviction policy evicts it on a count cap. There's no background sweeper scanning for stale keys.

`staleIfError` is the grace-after-stale knob. When a fetcher throws, the accessor will serve a stale entry rather than propagate the error, as long as the entry's age is still under `staleAfter + staleIfError`. The default is `true`, which serves a stale entry of any age on a fetcher failure. Set it to `false` to never serve stale on error — the error rethrows. Set it to a duration to bound the grace window:

```ts
const marketData = createCachedFetchCapability({
  name: "cache",
  staleAfter: "15m",
  staleIfError: "2h", // on fetch failure, serve stale up to 2h past staleAfter
});
```

Be direct about the tradeoff here. A persisted cache makes a warm run behave differently from a cold one, on purpose. The first request fetches; the second reads from the cache and never calls the fetcher. For tests and replays where you want every run to behave identically, scope the cache to `session` (so it doesn't outlive the conversation) or point the flow at a fresh store. The default `user` scope is the right call for production warmth and the wrong call for a hermetic fixture.

## Bounded vs unbounded

Whether you set `maxInstances` changes how the underlying collection loads.

Set `maxInstances` and the collection is bounded. It prefetches eagerly (the whole prefix loads into memory per request) and evicts on the cap with an LRU policy by default. This is the right shape for many small entries: a few hundred quotes, each a handful of bytes. The eager load is cheap and `list`/`count` are exact.

Omit `maxInstances` and the collection is unbounded. It prefetches lazily (nothing loads up front; each key you touch costs one store read) and never count-evicts. This is the right shape for large payloads where loading the whole prefix per request would be wasteful, and where you accept that the cache grows without a hard cap. You're trading bounded memory for not paying a bulk load you don't need.

Pick bounded when entries are small and numerous and you want a hard ceiling. Pick unbounded when entries are large and you read a few keys by name per request.

## Concurrency

Cached Fetch coordinates concurrent fetches at two levels.

Per-request single-flight is always on. If two blocks in the same run ask for the same key at the same time and the value isn't fresh, they share one fetch. The second caller waits on the first instead of issuing a duplicate.

`processDedup` extends that across requests within the same process. It's on by default and tenant-safe: the single-flight is keyed by scope id, so a fetch in flight for one user's key never blocks or leaks into another user's. Concurrent requests for the same key in the same scope coalesce into one fetch.

Cross-process coordination is out of scope. Two server processes racing to populate the same cold key will both fetch and both write. The behavior is last-writer-wins, and it's benign: both writes carry freshly fetched data, so whichever lands second is just as valid as the first. There's no corruption risk, only a small amount of duplicated work on a cold key under multi-process load.

## Lower-level surface

The capability is the surface most code should use. When you want explicit control over the cache collection — a typed domain collection with its own schema, or a collection you wire into a flow yourself — drop to the substrate.

`cachedCollection` is sugar over `defineResourceCollection`. It wraps your `valueSchema` in the cache envelope (`{ value, storedAt }`) and applies the same bounded/unbounded defaults the capability uses: unbounded collections get `prefetchMode: "lazy"` and `eviction: "none"`, bounded ones (with `maxInstances` set) get `prefetchMode: "eager"` and `eviction: "lru"`.

```ts
import { cachedCollection, getOrCompute } from "@flow-state-dev/patterns/cached-fetch";
import { z } from "zod";

const quotes = cachedCollection({
  pattern: "quotes/**",
  scope: "user",
  valueSchema: z.object({ price: z.number(), asOf: z.string() }),
  maxInstances: 500, // bounded → eager + lru
});
```

With a ref in hand, `getOrCompute(ref, key, fetcher, options)` is the ref-first read-through. The `options` object carries `staleAfter` (and optionally `staleIfError` and a `now` clock for tests):

```ts
const quote = await getOrCompute(
  ctx.session.resources.quotes,
  `quotes/${ticker}`,
  () => fetchQuote(ticker),
  { staleAfter: "15m" },
);
```

`invalidateCached(ref, keyOrPrefix)` is the ref-first invalidate, matching the accessor's `invalidate` by exact key or prefix.

For free-form payloads with no fixed shape, `jsonValueSchema` is a recursive JSON value schema you can pass as `valueSchema`.

## API reference

Exported from `@flow-state-dev/patterns` and from the subpath `@flow-state-dev/patterns/cached-fetch`.

### `createCachedFetchCapability(options)`

The primary surface. Returns a capability. A block opts in with `uses: [cap]` and calls through `ctx.cap.<name>`. The capability declares its cache collection in its own `resources` slot, so it auto-installs into every block that uses it.

Options:

| Option | Default | Meaning |
|---|---|---|
| `staleAfter` (required) | — | Default freshness window. `"15m"`, `"120s"`, `"6h"`, or raw milliseconds. Overridable per call. |
| `name` | `"cache"` | Accessor name on `ctx.cap` (so `ctx.cap.cache` by default). |
| `pattern` | `"cache/**"` | The cache collection's key pattern. |
| `scope` | `"user"` | `"session"`, `"user"`, or `"org"`. |
| `flowIsolation` | `false` | When false, the cache is shared across flows of the same scope owner. |
| `valueSchema` | `jsonValueSchema` | Schema for the cached value (wrapped in the cache envelope). |
| `staleIfError` | `true` | Grace-after-stale. `true` serves stale of any age on error; `false` rethrows; a duration bounds the grace window. |
| `processDedup` | `true` | Cross-request single-flight within the process, tenant-safe (keyed by scope id). |
| `maxInstances` | — | Bounds the collection (forces eager + lru). |
| `eviction` | — | `"lru"` or `"oldest"`. |
| `prefetchMode` | — | `"eager"` or `"lazy"`. |
| `client` | — | Client-visibility config forwarded to the collection. |

### The accessor `ctx.cap.<name>` (`CachedFetchAccessor`)

- `getOrCompute<T>(key, fetcher, overrides?): Promise<T>` — identity-addressed read-through. Serves the stored value if fresh, otherwise runs `fetcher`, stores the result, and returns it.
- `getOrFetch<T>(tool, args, fetcher, overrides?): Promise<T>` — input-addressed sugar over `getOrCompute`. The key is `${tool}/${canonicalizeToolArgs(args)}`.
- `invalidate(keyOrPrefix): Promise<number>` — deletes by exact key or by prefix, returns the count removed.

The `overrides` object on the read methods accepts `staleAfter` and `staleIfError` to override the capability defaults for that one call.

### Substrate

- `cachedCollection(options)` — sugar over `defineResourceCollection` that wraps `valueSchema` in the cache envelope and applies bounded/unbounded defaults. Options: `pattern`, `scope`, `flowIsolation?`, `valueSchema`, `maxInstances?`, `eviction?`, `prefetchMode?`, `client?`.
- `getOrCompute(ref, key, fetcher, options)` — ref-first read-through. `options: { staleAfter, staleIfError?, now? }`.
- `invalidateCached(ref, keyOrPrefix)` — ref-first invalidate by exact key or prefix.
- `jsonValueSchema` — recursive JSON value schema for free-form payloads.

### Types

- `CacheEnvelope<TValue>` — the persisted shape, `{ value, storedAt }`.
- `CachedFetchAccessor` — the `ctx.cap.<name>` accessor type.
- `CachedCollectionOptions` — options for `cachedCollection`.
- `CreateCachedFetchCapabilityOptions` — options for `createCachedFetchCapability`.
- `GetOrComputeOptions` — the substrate `getOrCompute` options type.

## See also

- [Capabilities](../fundamentals/capabilities.md) — the `uses` model Cached Fetch rides on
- [Resource Collections](../resources/collections.md) — the persistence substrate underneath the cache
- [Flow policy](./flow-policy.md) — in-run, input-addressed tool memoization (the other caching layer)
- [Tools overview](../tools/overview.md) — marking a tool `cacheable`
- [Patterns Overview](./overview.md) — when to reach for which pattern
