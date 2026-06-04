/**
 * FRED (Federal Reserve Economic Data) provider — a single per-series fetch
 * with transient-failure retry. Stateless; reads no env on its own (the caller
 * passes the key so each tool keeps its own key-gate + empty-payload policy).
 *
 * Extracted so both `get_macro_indicators` (9 macro series) and
 * `get_cross_asset_flow` (the NFCI financial-conditions series) share one
 * FRED client instead of duplicating the HTTP + retry plumbing. Callers own
 * the bounded concurrency (FRED throttles concurrent bursts with 429s even
 * under quota — fan out via `mapLimit`, not a raw `Promise.all`).
 */

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

/** Default retry attempts for transient throttling / server errors. */
export const FRED_RETRIES = 2;

/** True when a FRED API key is configured. */
export function hasFredKey(): boolean {
  return Boolean(process.env.FRED_API_KEY?.trim());
}

/**
 * Fetch one FRED series — the most recent `limit` observations, newest-first —
 * retrying transient 429 / 5xx / network errors with linear backoff. Returns
 * the finite values newest-first (FRED's "." missing-observation sentinel and
 * empty strings are dropped). Throws after the final attempt so the caller can
 * degrade just that series to `[]` rather than blanking the whole payload.
 */
export async function fetchFredSeries(
  seriesId: string,
  limit: number,
  key: string,
  retries: number = FRED_RETRIES,
): Promise<number[]> {
  const url = new URL(FRED_BASE);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 150ms, then 300ms — small linear backoff; FRED throttling clears fast.
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`FRED ${seriesId}: HTTP ${res.status} ${body.slice(0, 120)}`);
        // Retry transient throttling / server errors; give up on client errors.
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      const data = (await res.json()) as {
        observations?: Array<{ date: string; value: string }>;
      };
      return (data.observations ?? [])
        .map((o) => o.value)
        .filter((v) => v !== "." && v !== "")
        .map(Number)
        .filter(Number.isFinite);
    } catch (err) {
      lastErr = err; // network error — retry
    }
  }
  throw lastErr;
}
