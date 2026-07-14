/**
 * `refreshQuotes` — the server helper behind `POST /api/portfolio/quotes/refresh`
 * (FIX-823). It fetches a current price per held ticker so the Portfolio UI can
 * compute market value / weight / unrealized P/L without a model run, and upserts
 * the LIVE prices into the durable, ticker-keyed `app.quotes` table.
 *
 * It is a plain route helper, NOT a flow action. Fetching + upserting is domain
 * work that gains nothing from a session — and as a flow action it forced the
 * pane to await the SSE stream's falling edge to know the write had committed
 * (`sendAction` resolves at stream-attach, before the upsert). As a route the
 * pane `await`s the write directly, exactly like the `importHoldings` /
 * `backfillSplits` writes (FIX-736 boundary: flows for streaming/reactive work,
 * routes for domain CRUD).
 *
 * There is no standalone quote tool. The injected live market-data source uses
 * the last bar's `close` from the same provider chain as `get_price_history`;
 * the domain service only normalizes tickers and applies persistence rules.
 *
 * Real-money trust gates:
 *  - A null/unavailable price degrades to `price: null` (the UI shows "—"),
 *    NEVER a fabricated number (BP-020 spirit).
 *  - Provider failures return `price: null`; analysis fixtures are never part
 *    of this production refresh path.
 *  - `asOf` carries the price's own date so the UI can label staleness.
 */
import { z } from "zod";
import type { PortfolioRepository } from "@/src/db/repository";

/** One requested ticker's resolved current price + provenance. `price` is null
 *  when no source could answer — the UI degrades to "—". */
const quoteSchema = z.object({
  ticker: z.string(),
  price: z.number().nullable(),
  asOf: z.string().nullable(),
});

export type Quote = z.infer<typeof quoteSchema>;

/** Input for a live quote refresh. The route derives tickers from the user's holdings. */
export type RefreshQuotesInput = {
  tickers: string[];
};

/** Market-data source that resolves normalized portfolio quote inputs. */
export type PortfolioQuoteSource = (input: RefreshQuotesInput) => Promise<Quote[]>;

/**
 * Fetch and persist current live prices for a set of tickers.
 * Dedupes tickers; preserves the requested order in the response.
 *
 * Persists non-null-priced quotes to the durable, ticker-keyed `app.quotes`
 * table (FIX-823) via `upsertQuotes`, so any consumer (Portfolio UI, analysis
 * seed, the future household view) can value from persisted state without a live
 * fetch. Fixture replay is intentionally unavailable on this path, so demo data
 * cannot overwrite the global last-known row. Null-priced quotes are dropped (a
 * provider miss keeps the prior last-known row). Returns the report; the UI reads
 * persisted rows back via `GET /api/portfolio/quotes`.
 */
export async function refreshQuotes(
  input: RefreshQuotesInput,
  repo: PortfolioRepository,
  source: PortfolioQuoteSource,
): Promise<{ quotes: Quote[] }> {
  const unique = [...new Set(input.tickers.map((t) => t.toUpperCase()))];
  const quotes = await source({ tickers: unique });
  await repo.upsertQuotes(
    quotes
      .filter(
        (q): q is { ticker: string; price: number; asOf: string | null } =>
          q.price !== null,
      )
      .map((q) => ({ ticker: q.ticker, price: q.price, asOf: q.asOf, source: "live" })),
  );
  return { quotes };
}
