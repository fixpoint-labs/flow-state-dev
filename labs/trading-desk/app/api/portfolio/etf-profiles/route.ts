import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/db/portfolio-db";
import type { EtfProfileRow, EtfProfileUpsertInput } from "@/db/repository";
import { mapLimit } from "@/lib/concurrency";
import { withLease } from "@/lib/singleflight";
import { computeRefusalBackoff, type EtfProfileRefusalClass } from "@/lib/etf-profile-backoff";
import {
  AlphaVantageBudgetError,
  AlphaVantageRateLimitError,
  hasAlphaVantageKey,
} from "@/lib/providers/alpha-vantage";
import { fetchEtfProfile, type NormalizedEtfProfile } from "@/lib/providers/etf-profile";
import { allHeldTickers, isEtfProfileFetchCandidate } from "@/domain/portfolio/math/etf-profile-map";

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

/** Whether a stored row is still due for a fetch attempt right now — the
 *  SAME rule the outer `misses` filter uses, re-applied under the lease
 *  against a FRESH read (see the `GET` handler for why: a sequential, not
 *  just concurrent, race can leave the request-local snapshot stale). */
function isDueForFetch(stored: EtfProfileRow | undefined, now: Date): boolean {
  if (!stored) return true; // never fetched
  if (stored.payload !== null) {
    if (!isStale(stored.fetchedAt, now)) return false; // fresh success
    // Stale, but a prior refresh attempt may have deferred the next one
    // (the retryAt-on-preserved-payload case) — honor that backoff too.
    if (stored.retryAt && new Date(stored.retryAt).getTime() > now.getTime()) return false;
    return true;
  }
  if (!stored.retryAt) return true; // defensive — shouldn't happen, but never stall a genuine miss
  return new Date(stored.retryAt).getTime() <= now.getTime(); // refusal past backoff
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  const repo = await getRepository();
  const { holdings } = await repo.getPortfolio(userId);
  // FETCH-eligible = held as an ETF, not a curated bond ETF (pre-filtered
  // locally — zero fetches, Decision 5), and not a flagged
  // inconsistent-history row. Mutual funds are never fetch-eligible
  // (assetType !== "etf" — the endpoint is ETF-only, Non-goals).
  // `isEtfProfileFetchCandidate` is the single definition of this predicate —
  // the Health UI's eligibility-refetch signature reads it too, so both agree
  // on exactly the set this route will ever spend an Alpha Vantage unit on.
  const eligibleTickers = [
    ...new Set(
      holdings.filter(isEtfProfileFetchCandidate).map((h) => h.ticker.toUpperCase()),
    ),
  ];
  // READ-eligible is DELIBERATELY BROADER — every held ticker, not just the
  // fetch-eligible ones. `app.etf_profiles` is global reference data, and the
  // pure leaf's fund-detection oracle (`resolveTickerIsFund`) is designed to
  // let a STORED profile override a stale/mistyped local `assetType` — using
  // `eligibleTickers` for the READ (as this route originally did) would mean
  // a ticker still tagged `equity` locally but already correctly profiled
  // (by this household or another) is never even looked up, so the oracle
  // never sees the evidence and the Health UI reports it as a direct single
  // name instead of doing look-through (Codex review, FIX-801 sub-PR c — the
  // same bug the analysis seed's `heldTickersForProfileLookup` had, fixed
  // there first; `allHeldTickers` is the shared derivation so this route and
  // the seed can't drift apart on it again).
  const allTickers = allHeldTickers(holdings);
  if (allTickers.length === 0) {
    return NextResponse.json({
      profiles: [] as EtfProfileEntry[],
      refusals: [] as EtfProfileRefusalEntry[],
    } satisfies EtfProfilesResponse);
  }

  const [quotesRows, storedRows] = await Promise.all([
    repo.getQuotes(eligibleTickers),
    repo.getEtfProfiles(allTickers),
  ]);
  const pricedTickers = new Set(quotesRows.map((q) => q.ticker));
  const storedByTicker = new Map(storedRows.map((r) => [r.ticker, r]));

  const now = new Date();
  // A fund with no quote yet contributes no numerator/denominator on either
  // axis (the existing rule) — no budget unit is spent on a profile nothing
  // can use yet. It re-enters the fetch set once pricing resolves (the UI's
  // job, FIX-801 §8 step 6 — a client-side concern, not this route's).
  const fetchCandidates = eligibleTickers.filter((t) => pricedTickers.has(t));

  const misses = fetchCandidates.filter((ticker) => isDueForFetch(storedByTicker.get(ticker), now));
  // No key configured is a documented, supported state (every other AV
  // consumer in this codebase checks this first) — no fetch attempted,
  // nothing persisted, never a refusal. Without this gate, a keyless
  // deployment would let `fetchEtfProfile` throw `AlphaVantageError`, which
  // the catch path below records as a `transient` refusal — three keyless
  // reads and a ticker is suppressed for up to 90 days, so configuring a key
  // later wouldn't actually unblock it until that backoff expires (Codex
  // review, FIX-801 sub-PR a).
  const missesToFetch = hasAlphaVantageKey() ? misses.slice(0, ETF_PROFILE_MISS_CAP) : [];

  let quotaHit = false;
  await mapLimit(missesToFetch, FETCH_CONCURRENCY, async (ticker) => {
    if (quotaHit) return; // stop scheduling new fetches once the shared budget is known spent

    // The lease covers the FULL fetch-AND-persist for this ticker, not just
    // the fetch. A lease released right after the fetch settles — but before
    // the write lands — would let a second overlapping request (a race two
    // browser tabs, or a mount racing a refresh) see a DB miss during that
    // window and spend a second budget unit on a ticker just fetched, which
    // defeats the whole point of the lease (Codex review, FIX-801 sub-PR a).
    const { row, hitQuota } = await withLease(`etf-profile:${ticker}`, async () => {
      // Re-check under the lease against a FRESH read, not the request-local
      // `storedByTicker` snapshot: a SEQUENTIAL race — caller A fetches,
      // persists, and fully releases the lease BEFORE caller B (in this
      // request's own batch, or a different overlapping request) reaches
      // this ticker's lease acquisition — leaves B's snapshot unaware A's
      // write already landed. Re-reading here is what protects BOTH the
      // "should I even fetch" decision below AND the "should I clobber"
      // guard from acting on stale information (Codex review, FIX-801
      // sub-PR a).
      const storedBefore = (await repo.getEtfProfiles([ticker]))[0];
      if (!isDueForFetch(storedBefore, now)) {
        // Resolved already by someone else while we were queued — no fetch,
        // no write, just hand back what's already there.
        return { row: storedBefore ?? null, hitQuota: false };
      }

      // Refresh guard, applied uniformly to BOTH outcome paths below (Cursor
      // review + follow-up, FIX-801 sub-PR a): a REFRESH attempt on a ticker
      // that already has a valid, if stale, stored profile must never
      // clobber that known-good data — neither a thrown transport error NOR
      // a fresh-but-refused HTTP-200 judgment is trustworthy enough to
      // overturn an already-attributed fund. Alpha Vantage's documented
      // flakiness means even a clean "not_an_etf" response on a refresh
      // could be a transient hiccup, not a real change in the fund's nature.
      // Only a fresh SUCCESS overwrites the payload; a genuinely NEW miss
      // (no prior payload) gets a normal refusal written. Either way the
      // outcome STILL stamps a retry boundary (reviewer follow-up on
      // sub-PR a): keeping the payload with no backoff would retry the same
      // failing refresh on every single read, burning the shared budget.
      const hasStoredSuccess = storedBefore !== undefined && storedBefore.payload !== null;
      // `transientAttempts` is only ever nonzero for a `transient`-class
      // outcome (the backoff module resets it to 0 for every other class),
      // so reading it unconditionally — regardless of whether the row is
      // currently shaped as a success (payload kept) or a refusal — correctly
      // continues an escalating transient streak either way.
      const priorTransientAttempts = storedBefore?.transientAttempts ?? 0;

      let upsert: EtfProfileUpsertInput;
      let hitQuotaHere = false;
      try {
        const outcome = await fetchEtfProfile(ticker);
        // Fresh timestamp for the BACKOFF computation, captured only now that
        // the outcome is actually known — NOT the outer `now` from function
        // entry. `fetchEtfProfile` can block behind the shared per-minute AV
        // pacing (`alphaVantageRequest`), and a request queued across a UTC
        // midnight would otherwise compute `nextUtcDailyReset` from a
        // pre-midnight timestamp: "the next reset after `now`" resolves to a
        // reset that has ALREADY PASSED by the time this code runs, producing
        // a `retryAt` already in the past — the very next read immediately
        // retries and burns another shared budget unit instead of respecting
        // the backoff (Codex review, FIX-801 sub-PR c). `now` itself stays
        // correct for the outer `isDueForFetch` gates (deciding WHETHER to
        // attempt), just not for the boundary this attempt's OWN outcome sets.
        const outcomeAt = new Date();
        if (outcome.kind === "profile") {
          upsert = { ticker, payload: outcome.profile, refusalReason: null };
        } else if (hasStoredSuccess) {
          const { retryAt, transientAttempts } = computeRefusalBackoff(
            outcome.reason,
            outcomeAt,
            priorTransientAttempts,
          );
          upsert = {
            ticker,
            payload: storedBefore!.payload!,
            // Recorded (not forced null) so the repository's conflict-update
            // precedence guard can tell this DOMAIN-class preserved backoff
            // apart from a concurrent TRANSPORT-class one (Codex review,
            // FIX-801 sub-PR c, round 10) — inert everywhere else, since a
            // stored row is read as "usable" by `payload !== null` alone.
            refusalReason: outcome.reason,
            refusalDetail: outcome.detail,
            retryAt: retryAt.toISOString(),
            transientAttempts,
            fetchedAt: storedBefore!.fetchedAt, // PRESERVE — this is not a new fetch
          };
        } else {
          const { retryAt } = computeRefusalBackoff(outcome.reason, outcomeAt, 0);
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
        const outcomeAt = new Date(); // same fresh-timestamp reasoning as the try block above
        const isQuota =
          err instanceof AlphaVantageBudgetError || err instanceof AlphaVantageRateLimitError;
        if (isQuota) hitQuotaHere = true;
        const reason: EtfProfileRefusalClass = isQuota ? "quota" : "transient";
        const { retryAt, transientAttempts } = computeRefusalBackoff(
          reason,
          outcomeAt,
          priorTransientAttempts,
        );
        if (hasStoredSuccess) {
          upsert = {
            ticker,
            payload: storedBefore!.payload!,
            // Same reasoning as the try-block preserving write above: record
            // the TRANSPORT class instead of forcing null, so the precedence
            // guard can see it (round 10).
            refusalReason: reason,
            refusalDetail: err instanceof Error ? err.message : String(err),
            retryAt: retryAt.toISOString(),
            transientAttempts,
            fetchedAt: storedBefore!.fetchedAt, // PRESERVE — this is not a new fetch
          };
        } else {
          upsert = {
            ticker,
            payload: null,
            refusalReason: reason,
            refusalDetail: err instanceof Error ? err.message : String(err),
            retryAt: retryAt.toISOString(),
            transientAttempts,
          };
        }
      }

      await repo.upsertEtfProfiles([upsert]);
      // Re-read rather than project `upsert` itself (Codex review, FIX-801
      // sub-PR a): in the multi-instance race the repository's conditional
      // upsert can silently DROP this write (a losing success-vs-success or
      // refusal-vs-success race, see the WHERE clause in
      // `upsertEtfProfiles`) — returning the pre-write intent would then
      // hand the caller a row that was never actually persisted, and the
      // response would disagree with the database. Re-reading returns
      // whatever the conditional write actually left behind: this write's
      // own row when it won, or the other instance's already-stored row when
      // it lost.
      const persisted = (await repo.getEtfProfiles([ticker]))[0]!;
      return { row: persisted, hitQuota: hitQuotaHere };
    });

    // Propagate quota state to THIS caller's own request-local flag — even
    // when this caller was deduped onto another (executing) caller's lease,
    // possibly from a DIFFERENT overlapping request, whose fetch is what
    // actually hit quota. Without this, a caller whose ticker happened to
    // share a lease with the one that discovered exhaustion would keep
    // scheduling paced calls for the REST of its own batch that were always
    // going to fail (Codex review, FIX-801 sub-PR a).
    if (hitQuota) quotaHit = true;
    if (row) storedByTicker.set(ticker, row);
  });

  const profiles: EtfProfileEntry[] = [];
  const refusals: EtfProfileRefusalEntry[] = [];
  // Walks `allTickers` (READ-eligible), not `eligibleTickers` (FETCH-eligible)
  // — this is what actually surfaces a mistyped-equity ticker's already-cached
  // profile to the Health UI. Iterating `eligibleTickers` here would silently
  // drop it from the response even after the broadened read above found it.
  for (const ticker of allTickers) {
    const row = storedByTicker.get(ticker);
    if (!row) continue; // never fetched, deferred by the cap, or unpriced — simply absent
    const projected = projectRow(ticker, row);
    if ("reason" in projected) refusals.push(projected);
    else profiles.push(projected);
  }

  return NextResponse.json({ profiles, refusals } satisfies EtfProfilesResponse);
}
