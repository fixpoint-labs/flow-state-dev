/**
 * Portfolio market-data composition over shared provider clients.
 *
 * The portfolio domain owns classification and persistence rules; this module
 * composes shared provider clients with backend cache, concurrency, retry, and
 * fallback policy, then exposes the small function contracts domain services
 * accept. Portfolio quote refresh is always live; deterministic domain tests
 * inject a quote source instead of replaying analysis-tool fixtures.
 */
import {
  type Quote,
  type RefreshQuotesInput,
} from "@/domain/portfolio/services/get-quotes";
import { getOrFetch } from "@/lib/cache";
import { mapLimit, sleep } from "@/lib/concurrency";
import {
  fetchFinnhubCandles,
  hasFinnhubKey,
} from "@/lib/providers/finnhub";
import {
  fetchYahooChart,
  fetchYahooQuoteKind,
} from "@/lib/providers/yahoo";

/** Live quote fan-out throttle: at most this many provider requests in flight. */
const QUOTE_CONCURRENCY = 5;
/** Per-ticker retry budget for transient throttling and network failures. */
const QUOTE_RETRIES = 2;

/** Take the last bar's close + date from a price-history payload, or null. */
function lastClose(payload: {
  bars?: Array<{ date: string; close: number }>;
}): { price: number | null; asOf: string | null } {
  const last = payload.bars?.at(-1);
  if (last === undefined) return { price: null, asOf: null };
  return { price: last.close, asOf: last.date };
}

/** Resolve one ticker through the live provider chain. */
async function resolveQuote(
  ticker: string,
  date: string,
): Promise<Quote> {
  try {
    const payload = await getOrFetch(
      "get_price_history",
      { ticker, date, range: "1mo" },
      async () => {
        let lastErr: unknown;
        for (let attempt = 0; attempt <= QUOTE_RETRIES; attempt++) {
          if (attempt > 0) await sleep(200 * attempt);
          try {
            if (hasFinnhubKey()) {
              try {
                return await fetchFinnhubCandles({ ticker, date, range: "1mo" });
              } catch {
                // Fall through to Yahoo for this attempt.
              }
            }
            return await fetchYahooChart({ ticker, date, range: "1mo" });
          } catch (err) {
            lastErr = err;
          }
        }
        throw lastErr;
      },
    );
    const { price, asOf } = lastClose(payload);
    return { ticker, price, asOf };
  } catch {
    return { ticker, price: null, asOf: null };
  }
}

/** Fetch portfolio quotes with bounded fan-out, preserving input order. */
export async function fetchPortfolioQuotes(
  input: RefreshQuotesInput,
): Promise<Quote[]> {
  const date = new Intl.DateTimeFormat("en-CA").format(new Date());
  return mapLimit(input.tickers, QUOTE_CONCURRENCY, (ticker) =>
    resolveQuote(ticker, date),
  );
}

/** Resolve Yahoo's instrument-kind discriminator with process-wide deduping. */
export function resolvePortfolioQuoteKind(ticker: string): Promise<string | null> {
  return getOrFetch("yahoo-quote-kind", { ticker }, () =>
    fetchYahooQuoteKind(ticker),
  );
}
