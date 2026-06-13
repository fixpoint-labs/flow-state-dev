/**
 * Fixture flow for the cached-fetch capability scenario.
 *
 * A single handler block lists the `createCachedFetchCapability` capability in
 * `uses` and calls `ctx.cap.cache.getOrCompute(...)` for each requested key. The
 * handler runs as a nested sequencer step (not the root action block), so this
 * fixture verifies that a nested block reaches its own capability accessor — the
 * end-to-end path: capability resolution, collection auto-install, real
 * persistence (read-through within a request and cross-request via a shared
 * store), and count eviction.
 *
 * `counters.fetches` records how many times the underlying fetcher actually
 * ran, so a test can assert cache hits by counting fetches.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { createCachedFetchCapability } from "@flow-state-dev/patterns";
import { z } from "zod";

/** Test seam: number of times the fetcher actually executed across a run. */
export const counters = { fetches: 0 };

/** Reset the fetch counter between test cases. */
export function resetCounters(): void {
  counters.fetches = 0;
}

const cacheCapability = createCachedFetchCapability({
  name: "cache",
  scope: "user",
  flowIsolation: false,
  staleAfter: "5m",
  // Bounded so the scenario can exercise eviction; eager + lru by default.
  maxInstances: 3,
});

const fetchInputSchema = z.object({
  keys: z.array(z.string()),
});

const fetchHandler = handler({
  name: "cache-fetch",
  uses: [cacheCapability],
  inputSchema: fetchInputSchema,
  outputSchema: z.object({
    values: z.array(z.string()),
    count: z.number(),
  }),
  execute: async (input, ctx) => {
    const values: string[] = [];
    for (const key of input.keys) {
      const value = await ctx.cap.cache.getOrCompute(key, async () => {
        counters.fetches += 1;
        return `value-for-${key}-${counters.fetches}`;
      });
      values.push(value as string);
    }
    // Read the live instance count straight off the auto-installed collection.
    const ref = ctx.resources.cacheStore as unknown as { count(): Promise<number> };
    const count = await ref.count();
    return { values, count };
  },
});

const fetchPipeline = sequencer({
  name: "cache-fetch-pipeline",
  inputSchema: fetchInputSchema,
}).step(fetchHandler);

const cachedFetchFlow = defineFlow({
  kind: "test-cached-fetch",
  requireUser: true,
  actions: {
    fetch: {
      inputSchema: fetchInputSchema,
      block: fetchPipeline,
    },
  },
  session: {
    stateSchema: z.object({}),
  },
});

export default cachedFetchFlow({ id: "default" });
