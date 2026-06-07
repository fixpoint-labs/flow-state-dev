/**
 * Massive.com (rebranded Polygon.io) REST helpers — the desk's only futures and
 * options-chain source. Like the other providers in this folder, each function
 * makes one or more HTTP calls and returns RAW-but-normalized data; it reads
 * `MASSIVE_API_KEY` from the environment and throws on any failure (no key,
 * non-2xx, parse error) so the calling tool can fall through with a single
 * `try { ... } catch {}`.
 *
 * Composition + the judgment math live in the tools (`get_options_chain`,
 * `get_futures_curve`) and the pure `options-math` / `futures-math` modules —
 * mirroring `get_cross_asset_flow` over `fred.ts`, not the inline-normalize shape
 * of `finnhub.ts`. The provider stays a stateless client; no caching (the tool
 * wraps with `getOrFetch`).
 *
 * Massive bills per asset-class product (options, futures bought separately), so
 * a key without the right product entitlement 401s — which surfaces, correctly,
 * as `source: "unavailable"` on the tool. Base URL is the new `api.massive.com`;
 * the legacy `api.polygon.io` host still works against the same keys.
 *
 * NOTE: exact response shapes track `massive.com/docs`; the field reads below are
 * defensive (optional chaining + finite-number guards) so a shape drift degrades
 * a field to null rather than throwing the whole payload away.
 */
import type { OptionContract } from "../data/options-math";

const MASSIVE_BASE = "https://api.massive.com";

/** Hosts the bearer token may be sent to. Pagination follows a `next_url`
 *  returned by the API, so we pin it to the known Massive/Polygon hosts before
 *  attaching credentials — a malformed or tampered `next_url` pointing off-domain
 *  must never leak the API key (defence-in-depth). */
const MASSIVE_ALLOWED_HOSTS = new Set(["api.massive.com", "api.polygon.io"]);

function requireKey(): string {
  const key = process.env.MASSIVE_API_KEY?.trim();
  if (!key) throw new Error("MASSIVE_API_KEY not set");
  return key;
}

/** True when a Massive (Polygon) API key is configured. */
export function hasMassiveKey(): boolean {
  return Boolean(process.env.MASSIVE_API_KEY?.trim());
}

/** Finite-number guard: returns the number or null (never NaN/Infinity). */
function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function massiveFetchJson<T>(
  pathOrUrl: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  // `pathOrUrl` may be a bare path or a full `next_url` returned by the API.
  const url = pathOrUrl.startsWith("http")
    ? new URL(pathOrUrl)
    : new URL(`${MASSIVE_BASE}${pathOrUrl}`);
  if (!MASSIVE_ALLOWED_HOSTS.has(url.hostname)) {
    // Refuse to attach the bearer token to an unexpected host (e.g. an
    // off-domain `next_url`). Throw before fetching so the key never leaves.
    throw new Error(`Massive: refusing to send credentials to unexpected host ${url.hostname}`);
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${requireKey()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Massive ${url.pathname} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Max snapshot pages to follow. The chain is requested expiry-ascending, so a
 *  few pages cover the near-dated expiries the term-structure / skew reads need
 *  without pulling the entire multi-thousand-contract chain. */
const OPTION_SNAPSHOT_MAX_PAGES = 3;
const OPTION_SNAPSHOT_PER_PAGE = 250;

type OptionSnapshotResult = {
  details?: {
    strike_price?: number;
    expiration_date?: string;
    contract_type?: string;
  };
  greeks?: { delta?: number };
  implied_volatility?: number;
  open_interest?: number;
  day?: { volume?: number };
  underlying_asset?: { price?: number };
};
type OptionSnapshotResponse = {
  results?: OptionSnapshotResult[];
  next_url?: string;
};

/**
 * Option chain snapshot for an underlying. Returns the underlying spot (first
 * finite `underlying_asset.price` seen) and the normalized contract list,
 * paging expiry-ascending up to `OPTION_SNAPSHOT_MAX_PAGES`. An empty `results`
 * is a valid answer (the name simply has no listed options) — `contracts: []`,
 * not a throw. Throws only on transport / auth / parse failure.
 */
export async function fetchOptionChainSnapshot(
  ticker: string,
): Promise<{ spot: number | null; contracts: OptionContract[] }> {
  const contracts: OptionContract[] = [];
  let spot: number | null = null;

  let page: OptionSnapshotResponse = await massiveFetchJson(
    `/v3/snapshot/options/${encodeURIComponent(ticker)}`,
    { limit: OPTION_SNAPSHOT_PER_PAGE, order: "asc", sort: "expiration_date" },
  );
  for (let i = 0; i < OPTION_SNAPSHOT_MAX_PAGES; i++) {
    for (const r of page.results ?? []) {
      const strike = finite(r.details?.strike_price);
      const expiry = r.details?.expiration_date;
      const rawType = r.details?.contract_type;
      const type = rawType === "call" || rawType === "put" ? rawType : null;
      if (strike === null || !expiry || type === null) continue;
      if (spot === null) spot = finite(r.underlying_asset?.price);
      contracts.push({
        type,
        strike,
        expiry,
        iv: finite(r.implied_volatility),
        delta: finite(r.greeks?.delta),
        openInterest: finite(r.open_interest),
        volume: finite(r.day?.volume),
      });
    }
    if (!page.next_url || i === OPTION_SNAPSHOT_MAX_PAGES - 1) break;
    page = await massiveFetchJson(page.next_url);
  }

  return { spot, contracts };
}

// ---------------------------------------------------------------------------
// Futures
// ---------------------------------------------------------------------------

/** A resolved futures contract leg: its ticker plus the last and prior session
 *  closes (prior is null when only one bar was returned). The `next` leg only
 *  needs `last` (for the front-vs-next spread), so it uses the narrower
 *  `FuturesNextLeg` below. */
export interface FuturesLeg {
  ticker: string;
  last: number | null;
  priorClose: number | null;
}

/** The next active contract, reduced to what the front-vs-next spread needs. */
export interface FuturesNextLeg {
  ticker: string;
  last: number | null;
}

type FuturesContractsResponse = { results?: Array<{ ticker?: string }> };
type FuturesAggregatesResponse = { results?: Array<{ close?: number }> };

/** Daily closes (last, prior) for one futures contract, newest-first. Returns
 *  nulls when the contract has no aggregate bars. */
async function fetchContractCloses(
  contractTicker: string,
): Promise<{ last: number | null; priorClose: number | null }> {
  const aggs: FuturesAggregatesResponse = await massiveFetchJson(
    `/v3/futures/aggregates/${encodeURIComponent(contractTicker)}`,
    { resolution: "1day", order: "desc", limit: 2 },
  );
  const bars = aggs.results ?? [];
  return { last: finite(bars[0]?.close), priorClose: finite(bars[1]?.close) };
}

/**
 * Resolve the front and next active contracts for a futures product and read
 * their session closes. The front carries last + prior (for the session change);
 * the next carries last only (for the front-vs-next spread). Returns both `null`
 * when the product has no active contracts. Throws only on transport / auth /
 * parse failure of the contracts lookup.
 */
export async function fetchFuturesFrontNext(
  productCode: string,
): Promise<{ front: FuturesLeg | null; next: FuturesNextLeg | null }> {
  const contracts: FuturesContractsResponse = await massiveFetchJson(
    "/v3/futures/contracts",
    {
      product_code: productCode,
      active: "true",
      order: "asc",
      sort: "expiration_date",
      limit: 10,
    },
  );
  const tickers = (contracts.results ?? [])
    .map((c) => c.ticker)
    .filter((t): t is string => Boolean(t));
  if (tickers.length === 0) return { front: null, next: null };

  const frontTicker = tickers[0]!;
  const frontCloses = await fetchContractCloses(frontTicker);
  const front: FuturesLeg = { ticker: frontTicker, ...frontCloses };

  let next: FuturesNextLeg | null = null;
  if (tickers[1]) {
    // The next contract is secondary — only the front/next spread reads it. A
    // failure fetching its aggregates must NOT discard the front leg that
    // already priced, so it degrades to null on its own (the caller then
    // reports a null spread, not a fully-failed product).
    try {
      const nextCloses = await fetchContractCloses(tickers[1]);
      next = { ticker: tickers[1], last: nextCloses.last };
    } catch {
      next = null;
    }
  }
  return { front, next };
}
