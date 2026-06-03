/**
 * `getQuotes` — a read-only flow action that fetches a current price per held
 * ticker so the Portfolio UI can compute market value / weight / unrealized P/L
 * without a model run.
 *
 * There is no standalone quote tool. The canonical current-price source is the
 * last bar's `close` from `get_price_history`, which exists in both fixture and
 * live modes. This handler reuses that tool's fetch idiom DIRECTLY — it calls
 * `loadFixture` (fixture mode) / `getOrFetch` (live mode), exactly like
 * `compute-spine.ts`, NOT `get_price_history.run()`. Calling provider functions
 * from a handler is BP-011-safe; calling a block from a handler is not.
 *
 * Real-money trust gates:
 *  - A null/unavailable price degrades to `price: null` (the UI shows "—"),
 *    NEVER a fabricated number (BP-020 spirit).
 *  - Live mode never silently substitutes fixture data: on a live miss the
 *    fetch throws and this returns `price: null`, not a fixture close.
 *  - `asOf` carries the price's own date so the UI can label staleness; in
 *    fixture mode that is the pinned snapshot date, not "now".
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { getOrFetch } from "../lib/cache";
import { mapLimit, sleep } from "../lib/concurrency";
import { loadFixture } from "../lib/fixtures";
import { fetchFinnhubCandles, hasFinnhubKey } from "../providers/finnhub";
import { fetchYahooChart } from "../providers/yahoo";
import { portfolioQuotesResource } from "./portfolio-quotes-resource";

/** Live quote fan-out throttle: at most this many provider requests in flight at
 *  once, so a 20+ holding portfolio doesn't trip Yahoo's rate limiter and drop a
 *  random subset of tickers to "—". */
const QUOTE_CONCURRENCY = 5;
/** Per-ticker retry budget for the live path — covers a transient throttle
 *  (HTTP 429) or network blip with a short backoff before degrading to null. */
const QUOTE_RETRIES = 2;

/** One requested ticker's resolved current price + provenance. `price` is null
 *  when no source could answer — the UI degrades to "—". */
const quoteSchema = z.object({
  ticker: z.string(),
  price: z.number().nullable(),
  asOf: z.string().nullable(),
});

export const getQuotesInputSchema = z.object({
  tickers: z.array(z.string()),
  dataSource: z.enum(["fixture", "live"]).default("fixture"),
});

export const getQuotesOutputSchema = z.object({
  quotes: z.array(quoteSchema),
});

export type Quote = z.infer<typeof quoteSchema>;

/** Take the last bar's close + date from a price-history payload, or null. */
function lastClose(payload: {
  bars?: Array<{ date: string; close: number }>;
}): { price: number | null; asOf: string | null } {
  const last = payload.bars?.at(-1);
  if (last === undefined) return { price: null, asOf: null };
  return { price: last.close, asOf: last.date };
}

/** Resolve one ticker's current price, mirroring `get_price_history`'s mode
 *  branch + provider chain. Any failure returns a null price (never fabricated,
 *  never a silent fixture fallback in live mode). */
async function resolveQuote(
  ticker: string,
  date: string,
  mode: "fixture" | "live",
): Promise<Quote> {
  try {
    if (mode === "fixture") {
      const payload = await loadFixture("get_price_history", { ticker, date });
      const { price, asOf } = lastClose(payload);
      return { ticker, price, asOf };
    }
    const payload = await getOrFetch(
      "get_price_history",
      { ticker, date, range: "1mo" },
      async () => {
        // Retry the provider chain on transient failure (throttle / network).
        // The loop is INSIDE the cache factory so a successful retry is the
        // value that gets cached, and a final failure throws (caught below →
        // null), never caching a miss.
        let lastErr: unknown;
        for (let attempt = 0; attempt <= QUOTE_RETRIES; attempt++) {
          if (attempt > 0) await sleep(200 * attempt); // 200ms, then 400ms
          try {
            if (hasFinnhubKey()) {
              try {
                return await fetchFinnhubCandles({ ticker, date, range: "1mo" });
              } catch {
                // fall through to Yahoo for this attempt
              }
            }
            return await fetchYahooChart({ ticker, date, range: "1mo" });
          } catch (err) {
            lastErr = err; // transient — back off and retry
          }
        }
        throw lastErr;
      },
    );
    const { price, asOf } = lastClose(payload);
    return { ticker, price, asOf };
  } catch {
    // Missing fixture, all live providers down, etc. Degrade to "—".
    return { ticker, price: null, asOf: null };
  }
}

/**
 * Fetch current prices for a set of tickers. Default `dataSource: "fixture"` so
 * the Portfolio view works offline. Dedupes tickers; preserves the requested
 * order in the response.
 *
 * Writes the result to the session-scoped `portfolioQuotes` resource so the UI
 * can read it via `useResource` after `session.refresh()` — `sendAction` does
 * not return handler output to the client in this runtime (see the resource's
 * doc comment). Also returns the report, which is what the unit test asserts on.
 */
export const getQuotes = handler({
  name: "get-quotes",
  inputSchema: getQuotesInputSchema,
  outputSchema: getQuotesOutputSchema,
  resources: { portfolioQuotes: portfolioQuotesResource },
  execute: async (input, ctx) => {
    const mode = input.dataSource === "live" ? "live" : "fixture";
    // Fixture-mode price lookups ignore the date (pinned snapshot); live mode
    // uses today as the range anchor. A real per-ticker date is not modeled.
    const date = new Intl.DateTimeFormat("en-CA").format(new Date());
    const unique = [...new Set(input.tickers.map((t) => t.toUpperCase()))];
    // Bounded fan-out (not Promise.all): a 20+ ticker portfolio fired all at
    // once trips Yahoo's throttle and drops a random subset to "—". mapLimit
    // caps in-flight requests and preserves the requested order.
    const quotes = await mapLimit(unique, QUOTE_CONCURRENCY, (ticker) =>
      resolveQuote(ticker, date, mode),
    );
    await ctx.resources.portfolioQuotes.patchState({
      dataSource: mode,
      fetchedAt: new Date().toISOString(),
      quotes,
    });
    return { quotes };
  },
});
