/**
 * `getOrFetch` — read-through cache against the `marketdata` resource collection.
 *
 * Three layers, cheapest first:
 *
 *   1. **In-process Promise map** keyed by `sessionId|cacheKey`. Two analysts
 *      running in parallel that request the same data resolve through one
 *      upstream call — the second caller awaits the first caller's pending
 *      promise. Cleared once the promise settles.
 *
 *   2. **Resource state** (`ctx.resources.marketdata`). Survives across handler
 *      invocations within a session, so a sequential second caller skips both
 *      the upstream call and the parallel dedup. Also makes the data visible
 *      to clients and to future context-injection capabilities.
 *
 *   3. **Upstream fetch** (`fetcher` arg). Called at most once per
 *      `sessionId|cacheKey` pair within a single run.
 *
 * Provenance: the resource's `provider` field is taken from the returned
 * payload's `source` tag, so a later read can tell whether the cached payload
 * came from Finnhub, Yahoo, or fixture.
 */
import type { ToolInput, ToolName, ToolOutput } from "./data-source";
import { marketDataCollection } from "./market-data-resource";

/** Stable cache key per (tool, input). Macro tool has no ticker → sentinel. */
export function cacheKey<T extends ToolName>(tool: T, input: ToolInput<T>): string {
  const i = input as { ticker?: string; date: string; range?: string };
  const ticker = i.ticker ?? "_macro";
  const extra = tool === "get_price_history" && i.range ? `/${i.range}` : "";
  return `marketdata/${tool}/${ticker}/${i.date}${extra}`;
}

// Structurally typed against `BlockContext` for handlers that declare
// `resources: marketDataResources`. Kept loose (`any` on the ref state) so
// updates to the framework's resource generics don't ripple here — the
// payload shape is validated by each tool's `outputSchema` at the handler
// boundary, not at the cache layer.
type Ctx = {
  session: { identity: { id: string } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resources: { marketdata: any };
};

const pending = new Map<string, Promise<unknown>>();

export async function getOrFetch<T extends ToolName>(
  ctx: Ctx,
  tool: T,
  input: ToolInput<T>,
  fetcher: () => Promise<ToolOutput<T>>,
): Promise<ToolOutput<T>> {
  const key = cacheKey(tool, input);
  const dedupKey = `${ctx.session.identity.id}|${key}`;

  // Layer 1: dedup parallel callers within this process.
  const inflight = pending.get(dedupKey);
  if (inflight) {
    return (await inflight) as ToolOutput<T>;
  }

  // Layer 2: durable resource state — already-fetched within this session.
  const existing = ctx.resources.marketdata.getOptional(key);
  if (existing !== undefined) {
    return existing.state.payload as ToolOutput<T>;
  }

  // Layer 3: upstream fetch. Register an inflight promise immediately so any
  // concurrent caller in this process awaits it instead of double-fetching.
  const inputAny = input as { ticker?: string; date: string };
  const promise = (async (): Promise<ToolOutput<T>> => {
    const payload = await fetcher();
    const provider = (payload as { source: "fixture" | "yahoo" | "finnhub" }).source;
    // Re-check before create — another caller might have written this key
    // while we were awaiting the upstream call.
    if (ctx.resources.marketdata.getOptional(key) === undefined) {
      try {
        await ctx.resources.marketdata.create(key, {
          tool,
          ticker: inputAny.ticker ?? "_macro",
          date: inputAny.date,
          provider,
          fetchedAt: new Date().toISOString(),
          payload,
        });
      } catch {
        // Duplicate-key race or transient write failure: payload is already
        // returned to the caller, and the next reader will fall into the
        // resource-hit branch above.
      }
    }
    return payload;
  })();

  pending.set(dedupKey, promise);
  try {
    return await promise;
  } finally {
    pending.delete(dedupKey);
  }
}

export { marketDataCollection };
