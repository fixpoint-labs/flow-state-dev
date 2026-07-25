import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/db/portfolio-db";
import type { EtfProfileRow, EtfProfileUpsertInput } from "@/db/repository";
import { mapLimit } from "@/lib/concurrency";
import { withLease } from "@/lib/singleflight";
import { computeRefusalBackoff, type EtfProfileRefusalClass } from "@/lib/etf-profile-backoff";
import {
  AlphaVantageBudgetError,
  AlphaVantageRateLimitError,
} from "@/lib/providers/alpha-vantage";
import { fetchEtfProfile, type NormalizedEtfProfile } from "@/lib/providers/etf-profile";

// The ETF holdings-profile fill surface (FIX-801) — backs the Health view's
// look-through axis, mirroring the classifications route's shape (a lazy
// REST fill of a global ticker-keyed reference table) but NOT its fan-out
// policy: Alpha Vantage is a KEYED 5/min + 25/day provider, not the
// keyless one classifications hits, so this route fetches at low
// concurrency, leans on the shared per-minute pacing in `alphaVantageRequest`
// (FIX-801 §8 step 0) rather than re-implementing it, and CAPS how many
// misses one call will fetch — the remainder defers to the next read.
//
// The ticker set is derived SERVER-SIDE from the caller's own holdings
// (BP-031/033), never taken from the query string — same posture as
// `classifications/route.ts` and `quotes/route.ts`.
//
// AUTH POSTURE (dev-only): `userId` is a client-asserted query param, exactly
// as the sibling portfolio read routes are (see `classifications/route.ts`).
export const dynamic = "force-dynamic";

/** Low concurrency for the keyed AV fan-out (FIX-801 §8 step 3, "pinned" —
 *  NOT the classifications route's concurrency, which targets a keyless
 *  provider). Pacing itself is enforced by the shared `alphaVantageRequest`. */
const FETCH_CONCURRENCY = 2;

/** How many misses ONE call will fetch — "roughly a minute's worth" against
 *  the free tier's 5/min cap (FIX-801 §8 step 3). A cold household with more
 *  funds than this warms over a few reads instead of colliding with both the
 *  per-minute and per-day limits at once. Exported as a named constant, a
 *  tuning number not a contract. */
export const ETF_PROFILE_MISS_CAP = 5;

/** A stored profile older than this is treated as a miss and refetched on the
 *  next read that needs it (Decision 1/§9) — a ceiling imposed by the data
 *  (index membership moves quarterly; some large ETFs publish monthly with a
 *  ~2-week lag), not a preference. No timer — checked lazily at read time. */
export const ETF_PROFILE_STALENESS_DAYS = 30;

/** One fund's projected profile — everything the (later) pure look-through
 *  leaf needs to produce both axes: per-constituent ticker/weight, the
 *  mapped sector rows, and both RAW coverage totals (fractions in `[0, 1]`).
 *  Deliberately does NOT include a computed coverage-gate verdict — Decision
 *  4's ~85% floor is the consuming leaf's business logic (one copy of the
 *  money math, focus practice 3); this route ships the numbers the leaf
 *  gates on, not a pre-baked verdict that would duplicate the threshold. */
export type EtfProfileEntry = {
  ticker: string;
  leveraged: boolean;
  constituents: NormalizedEtfProfile["constituents"];
  nameCoverage: number;
  sectors: NormalizedEtfProfile["sectors"];
  sectorCoverage: number;
  fetchedAt: string;
};

/** One fund the route could not (or could no longer) attribute, with why —
 *  reported even when this call didn't re-fetch it (a stored refusal still
 *  within its backoff window), so the Health view can label it "incomplete"
 *  without waiting on a retry. */
export type EtfProfileRefusalEntry = {
  ticker: string;
  reason: EtfProfileRefusalClass;
  detail: string | null;
  retryAt: string | null;
};

export type EtfProfilesResponse = {
  profiles: EtfProfileEntry[];
  refusals: EtfProfileRefusalEntry[];
};

function projectRow(ticker: string, row: EtfProfileRow): EtfProfileEntry | EtfProfileRefusalEntry {
  if (row.payload !== null) {
    return {
      ticker,
      leveraged: row.payload.leveraged,
      constituents: row.payload.constituents,
      nameCoverage: row.payload.nameCoverage,
      sectors: row.payload.sectors,
      sectorCoverage: row.payload.sectorCoverage,
      fetchedAt: row.fetchedAt,
    };
  }
  return {
    ticker,
    reason: row.refusalReason ?? "not_an_etf",
    detail: row.refusalDetail,
    retryAt: row.retryAt,
  };
}

function isStale(fetchedAt: string, now: Date): boolean {
  const ageMs = now.getTime() - new Date(fetchedAt).getTime();
  return ageMs > ETF_PROFILE_STALENESS_DAYS * 24 * 60 * 60 * 1000;
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  const repo = await getRepository();
  const { holdings } = await repo.getPortfolio(userId);
  // Eligible = held as an ETF, not a curated bond ETF (pre-filtered locally —
  // zero fetches, Decision 5), and not a flagged inconsistent-history row.
  // Mutual funds are never eligible (assetType !== "etf" — the endpoint is
  // ETF-only, Non-goals).
  const eligibleTickers = [
    ...new Set(
      holdings
        .filter(
          (h) =>
            h.assetType === "etf" &&
            h.assetClass !== "fixed_income" &&
            h.dataQuality !== "inconsistent_history",
        )
        .map((h) => h.ticker.toUpperCase()),
    ),
  ];
  if (eligibleTickers.length === 0) {
    return NextResponse.json({
      profiles: [] as EtfProfileEntry[],
      refusals: [] as EtfProfileRefusalEntry[],
    } satisfies EtfProfilesResponse);
  }

  const [quotesRows, storedRows] = await Promise.all([
    repo.getQuotes(eligibleTickers),
    repo.getEtfProfiles(eligibleTickers),
  ]);
  const pricedTickers = new Set(quotesRows.map((q) => q.ticker));
  const storedByTicker = new Map(storedRows.map((r) => [r.ticker, r]));

  const now = new Date();
  // A fund with no quote yet contributes no numerator/denominator on either
  // axis (the existing rule) — no budget unit is spent on a profile nothing
  // can use yet. It re-enters the fetch set once pricing resolves (the UI's
  // job, FIX-801 §8 step 6 — a client-side concern, not this route's).
  const fetchCandidates = eligibleTickers.filter((t) => pricedTickers.has(t));

  const misses = fetchCandidates.filter((ticker) => {
    const stored = storedByTicker.get(ticker);
    if (!stored) return true; // never fetched
    if (stored.payload !== null) return isStale(stored.fetchedAt, now); // stale success
    if (!stored.retryAt) return true; // defensive — shouldn't happen, but never stall a genuine miss
    return new Date(stored.retryAt).getTime() <= now.getTime(); // refusal past backoff
  });
  const missesToFetch = misses.slice(0, ETF_PROFILE_MISS_CAP);

  let quotaHit = false;
  const fetchResults = await mapLimit(missesToFetch, FETCH_CONCURRENCY, async (ticker) => {
    if (quotaHit) return null; // stop scheduling new fetches once the shared budget is known spent
    try {
      const outcome = await withLease(`etf-profile:${ticker}`, () => fetchEtfProfile(ticker));
      if (outcome.kind === "profile") {
        return {
          ticker,
          upsert: { ticker, payload: outcome.profile, refusalReason: null } as EtfProfileUpsertInput,
        };
      }
      const { retryAt } = computeRefusalBackoff(outcome.reason, now, 0);
      return {
        ticker,
        upsert: {
          ticker,
          payload: null,
          refusalReason: outcome.reason,
          refusalDetail: outcome.detail,
          retryAt: retryAt.toISOString(),
          transientAttempts: 0,
        } as EtfProfileUpsertInput,
      };
    } catch (err) {
      const isQuota =
        err instanceof AlphaVantageBudgetError || err instanceof AlphaVantageRateLimitError;
      if (isQuota) quotaHit = true;
      const stored = storedByTicker.get(ticker);
      // A throwing fetch on a REFRESH attempt (this ticker already has a
      // valid, if stale, stored profile) must not clobber known-good data
      // with a refusal marker — a transient network blip or a momentary quota
      // hit is not evidence the fund stopped being attributable. Leave the
      // row intact; it stays "stale" and is retried on the next read that
      // needs it (the same no-timer staleness discipline).
      if (stored && stored.payload !== null) return null;
      const reason: EtfProfileRefusalClass = isQuota ? "quota" : "transient";
      const priorTransientAttempts =
        stored?.refusalReason === "transient" ? stored.transientAttempts : 0;
      const { retryAt, transientAttempts } = computeRefusalBackoff(
        reason,
        now,
        priorTransientAttempts,
      );
      return {
        ticker,
        upsert: {
          ticker,
          payload: null,
          refusalReason: reason,
          refusalDetail: err instanceof Error ? err.message : String(err),
          retryAt: retryAt.toISOString(),
          transientAttempts,
        } as EtfProfileUpsertInput,
      };
    }
  });

  const toPersist = fetchResults
    .filter((r): r is { ticker: string; upsert: EtfProfileUpsertInput } => r !== null)
    .map((r) => r.upsert);
  if (toPersist.length > 0) {
    await repo.upsertEtfProfiles(toPersist);
  }
  // Merge freshly-fetched outcomes over the pre-fetch read so the response
  // reflects this call's work without a second round-trip to the table.
  for (const r of toPersist) {
    storedByTicker.set(r.ticker, {
      ticker: r.ticker,
      payload: r.payload,
      refusalReason: r.refusalReason,
      refusalDetail: r.refusalReason === null ? null : r.refusalDetail,
      retryAt: r.refusalReason === null ? null : r.retryAt,
      transientAttempts: r.refusalReason === null ? 0 : r.transientAttempts,
      fetchedAt: now.toISOString(),
    });
  }

  const profiles: EtfProfileEntry[] = [];
  const refusals: EtfProfileRefusalEntry[] = [];
  for (const ticker of eligibleTickers) {
    const row = storedByTicker.get(ticker);
    if (!row) continue; // never fetched, deferred by the cap, or unpriced — simply absent
    const projected = projectRow(ticker, row);
    if ("reason" in projected) refusals.push(projected);
    else profiles.push(projected);
  }

  return NextResponse.json({ profiles, refusals } satisfies EtfProfilesResponse);
}
