/**
 * Fixture flow for the cached-fetch capability scenario.
 *
 * A single handler block lists the `createCachedFetchCapability` capability in
 * `uses` and calls `ctx.cap.cache.getOrCompute(...)` for each requested key. The
 * capability auto-installs its user-scoped cache collection, so this fixture
 * verifies the end-to-end registry path: capability resolution, collection
 * install, real persistence (read-through + cross-request via a shared store),
 * and count eviction — none of which the stub-based unit tests exercise.
 *
 * `counters.fetches` records how many times the underlying fetcher actually
 * ran, so a test can assert cache hits by counting fetches rather than
 * inspecting internal state.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { createCachedFetchCapability, getOrCompute } from "@flow-state-dev/patterns";
import { z } from "zod";

async function getOrComputeViaRef(ref: any, key: string): Promise<string> {
  return getOrCompute(ref, key, async () => {
    counters.fetches += 1;
    return `value-for-${key}-${counters.fetches}`;
  }, { staleAfter: "5m" });
}

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
    const ref = (ctx as { resources: Record<string, any> }).resources.cacheStore;
    const values: string[] = [];
    for (const key of input.keys) {
      const value = await getOrComputeViaRef(ref, key);
      values.push(value);
    }
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
