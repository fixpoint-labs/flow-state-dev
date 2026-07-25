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

/** Flatten a discriminated {@link EtfProfileUpsertInput} into the read shape
 *  ({@link EtfProfileRow}) the response-building loop reads — the ONE place
 *  that reconciles the write shape and the read shape, so persisting an
 *  outcome and reflecting it into the in-memory `storedByTicker` map never
 *  restate the same flattening logic twice. */
function toStoredRow(input: EtfProfileUpsertInput, fetchedAt: string): EtfProfileRow {
  if (input.refusalReason === null) {
    return {
      ticker: input.ticker,
      payload: input.payload,
      refusalReason: null,
      refusalDetail: null,
      retryAt: null,
      transientAttempts: 0,
      fetchedAt,
    };
  }
  return {
    ticker: input.ticker,
    payload: null,
    refusalReason: input.refusalReason,
    refusalDetail: input.refusalDetail,
    retryAt: input.retryAt,
    transientAttempts: input.transientAttempts,
    fetchedAt,
  };
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
  await mapLimit(missesToFetch, FETCH_CONCURRENCY, async (ticker) => {
    if (quotaHit) return; // stop scheduling new fetches once the shared budget is known spent

    // The lease covers the FULL fetch-AND-persist for this ticker, not just
    // the fetch. A lease released right after the fetch settles — but before
    // the write lands — would let a second overlapping request (a race two
    // browser tabs, or a mount racing a refresh) see a DB miss during that
    // window and spend a second budget unit on a ticker just fetched, which
    // defeats the whole point of the lease (Codex review, FIX-801 sub-PR a).
    //
    // IMPORTANT: `storedByTicker` is REQUEST-LOCAL (one per `GET` call), so a
    // deduped concurrent caller's lease body never actually runs — it just
    // awaits the FIRST caller's shared promise. The upsert therefore has to
    // come back as `withLease`'s RETURN VALUE and be reflected into THIS
    // caller's own `storedByTicker`, not as a side effect buried inside the
    // executing caller's closure (which a deduped sibling request would
    // never see, leaving ITS OWN map — and its response — stale).
    const result = await withLease(`etf-profile:${ticker}`, async () => {
      const storedBefore = storedByTicker.get(ticker);
      // Refresh guard, applied uniformly to BOTH outcome paths below (Cursor
      // review + follow-up, FIX-801 sub-PR a): a REFRESH attempt on a ticker
      // that already has a valid, if stale, stored profile must never
      // clobber that known-good data — neither a thrown transport error NOR
      // a fresh-but-refused HTTP-200 judgment is trustworthy enough to
      // overturn an already-attributed fund. Alpha Vantage's documented
      // flakiness means even a clean "not_an_etf" response on a refresh
      // could be a transient hiccup, not a real change in the fund's nature.
      // Only a fresh SUCCESS overwrites existing data; only a genuinely NEW
      // miss (no prior payload) gets a refusal written.
      const hasStoredSuccess = storedBefore !== undefined && storedBefore.payload !== null;

      let upsert: EtfProfileUpsertInput;
      try {
        const outcome = await fetchEtfProfile(ticker);
        if (outcome.kind === "profile") {
          upsert = { ticker, payload: outcome.profile, refusalReason: null };
        } else if (hasStoredSuccess) {
          return null; // refused judgment on a refresh — leave the good row intact
        } else {
          const { retryAt } = computeRefusalBackoff(outcome.reason, now, 0);
          upsert = {
            ticker,
            payload: null,
            refusalReason: outcome.reason,
            refusalDetail: outcome.detail,
            retryAt: retryAt.toISOString(),
            transientAttempts: 0,
          };
        }
      } catch (err) {
        const isQuota =
          err instanceof AlphaVantageBudgetError || err instanceof AlphaVantageRateLimitError;
        if (isQuota) quotaHit = true;
        if (hasStoredSuccess) return null; // thrown error on a refresh — leave the good row intact
        const reason: EtfProfileRefusalClass = isQuota ? "quota" : "transient";
        const priorTransientAttempts =
          storedBefore?.refusalReason === "transient" ? storedBefore.transientAttempts : 0;
        const { retryAt, transientAttempts } = computeRefusalBackoff(
          reason,
          now,
          priorTransientAttempts,
        );
        upsert = {
          ticker,
          payload: null,
          refusalReason: reason,
          refusalDetail: err instanceof Error ? err.message : String(err),
          retryAt: retryAt.toISOString(),
          transientAttempts,
        };
      }

      await repo.upsertEtfProfiles([upsert]);
      return upsert;
    });

    if (result) storedByTicker.set(ticker, toStoredRow(result, now.toISOString()));
  });

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
