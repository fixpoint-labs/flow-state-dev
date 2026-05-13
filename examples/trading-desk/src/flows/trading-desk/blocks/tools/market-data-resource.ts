/**
 * `marketDataCollection` — session-scoped resource keyed by tool + input.
 *
 * Two jobs:
 *
 *   1. **Deduplication.** Four analysts run in parallel and several of them
 *      request overlapping data (e.g. `get_fundamentals` from the
 *      fundamentals analyst and `get_price_history` from technical). Without
 *      a cache each request hits the upstream API; with the cache the second
 *      reader returns the first reader's payload. This is the proximate fix
 *      for the Yahoo 429s on `get_fundamentals`.
 *
 *   2. **Future context injection.** Because the cache is a real resource,
 *      a follow-on capability can format already-fetched market data into
 *      any analyst's prompt without re-calling the tool. The data is
 *      observable from the client (`state.read: true`) so a "data inventory"
 *      UI is also free.
 *
 * `payload` is typed as `z.unknown()` — each tool's output schema is what
 * the analyst-facing handler validates against, and tools have heterogeneous
 * shapes (bars vs. fundamentals vs. news items).
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const marketDataStateSchema = z.object({
  tool: z.string(),
  ticker: z.string(),
  date: z.string(),
  provider: z.enum([
    "fixture",
    "yahoo",
    "finnhub",
    "fred",
    "polymarket",
    "unavailable",
  ]),
  fetchedAt: z.string(),
  payload: z.unknown(),
});

export type MarketDataState = z.infer<typeof marketDataStateSchema>;

export const marketDataCollection = defineResourceCollection({
  pattern: "marketdata/**",
  scope: "session",
  stateSchema: marketDataStateSchema,
  client: {
    state: { read: true },
  },
});

export const marketDataResources = {
  marketdata: marketDataCollection,
} as const;
