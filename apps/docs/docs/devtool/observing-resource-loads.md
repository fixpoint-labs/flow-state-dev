---
sidebar_position: 4
title: "Observing resource loads"
sidebar_label: "Observing resource loads"
---

# Observing resource loads

When you pick `prefetchMode: "eager"` or `"lazy"` for a collection, you're trading upfront load cost against per-access cost. The trouble is you usually tune that trade blind. A request feels slow, but is it the generator, or did one block hit the store fourteen times against a lazy collection?

The block trace in the DevTool records, per block, the resource loads that block triggered. Select a block in the trace and open its **Resource Loads** panel. You get the keys the block declared, the loads that actually fired, and for each load: where it came from, how long it took, and whether it was a real store fetch or an in-memory cache hit.

A quick vocabulary note, since these terms show up all over the panel:

- A **store fetch** is a real round-trip to the persistence layer. It has a wall time.
- A **cache hit** is a read served from the in-memory cache the request already loaded. It costs nothing.
- A load's **source** is the wave that paid for it: `flow-eager` (loaded at request start), `action-eager` (loaded when the action dispatched), `block-eager` (loaded when this block dispatched), or `lazy` (loaded on demand by a read inside the block).
- The **accessor** is which call triggered a lazy read: `get`, `getOptional`, `list`, or `count`.

This is trace-level observability. None of it touches the items stream your client consumes. Items stay user-meaningful events; loads stay operational signal on the trace channel.

## What the panel shows

The panel has two parts.

**Declared** lists the accessor keys this block declared at build time. If a key shows up here but never appears under Loaded, the block is declaring a resource it doesn't read. That's over-declaration: harmless, but worth trimming.

**Loaded** is one row per load. Each row carries the storage key (or the collection prefix for a `list`/`count`), a source badge, the accessor if it was a collection read, whether it was a fetch or a cache hit, the wall time for fetches, and a `×N` count when identical reads were collapsed into one row. A loop that reads the same key two hundred times shows as a single `cache hit ×200` row, not two hundred rows.

## Reading an eager collection

An eager collection loads its whole prefix once, up front, on the wave that declared it. Every read inside a block is then a cache hit.

In the panel you'll see one `fetch` row for the prefix (the upfront cost, attributed to the request's entry block), and the reads themselves show as collapsed `cache hit` rows. That's the signal that the prefetch is earning its keep: you paid once, and the reads are free. If you declared eager but only ever read one key, you'll see one fetch of the whole prefix and a single cache-hit read, which tells you the prefetch over-fetched.

## Reading a lazy collection

A lazy collection loads nothing up front. Each read fetches its key on demand.

```ts
import { defineResourceCollection, handler } from "@flow-state-dev/core";
import { z } from "zod";

const docs = defineResourceCollection({
  scope: "session",
  pattern: "docs/**",
  prefetchMode: "lazy",
  stateSchema: z.object({ title: z.string() }),
});

const summarize = handler({
  name: "summarize",
  resources: { docs },
  execute: async (input: { keys: string[] }, ctx) => {
    for (const key of input.keys) {
      const doc = await ctx.resources.docs.get(key);
      // ...use doc.state...
    }
    return { ok: true };
  },
});
```

Run this against a handful of keys, open the DevTool, select the `summarize` block, and expand Resource Loads. You'll see one `lazy` `fetch` row per distinct key, each with its own wall time. Read the same key again later in the block and it collapses into a `cache hit` row. If the same key shows up fetched once and then hit two hundred times, that's an under-prefetch hot path: the data is read often enough that eager would have been cheaper.

Watch out for `list()` and `count()` on a lazy collection. Each one reads the entire prefix in a single unbounded scan, and the panel shows it as one `lazy` `list` fetch with the full scan time. On a large collection that's the expensive case lazy was supposed to avoid.

## The request-level summary

Below the per-block panel is a **Resource Load Summary**. It aggregates the selected block and its descendants, so selecting the request's entry block gives you the whole-request picture:

- **Total loads** — every access, cache hits included.
- **Store fetches** — how many of those were real round-trips.
- **Total fetch time** — summed wall time across fetches.
- **Cache-hit rate** — the share of accesses served from cache.
- **Slowest fetch** — the single most expensive load and its key.

The request-init loads (flow-eager and action-eager) are surfaced here too, so a slow `list()` scan that fired before any block ran still shows up against the request rather than going missing.

## Using it to choose eager vs lazy

Three patterns to look for:

1. **Eager paying off.** One upfront prefix fetch, then a high cache-hit rate across many reads. Keep it eager. You're amortizing one scan over lots of reads.
2. **Eager over-fetching.** One prefix fetch, but only one or two reads against it. Switch to lazy so you fetch just the keys you touch.
3. **Lazy hot path.** The same key fetched once then hit dozens of times in a tight loop, or a `list()` scan you didn't expect. Switch to eager so the loop reads from a warm cache instead of round-tripping.

The numbers make the call obvious in a way that reading the flow definition can't.

## See also

- [Collections](../resources/collections.md#eager-vs-lazy-collections) — declaring `prefetchMode` and the cost of `list()`/`count()` on a lazy collection.
- [DevTool](./overview.md) — the rest of the trace surface.
