import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import { resolveSector } from "@/src/flows/analysis/lib/sector-resolution";
import { mapLimit } from "@/src/flows/analysis/lib/concurrency";
import { reconcileFundClassification } from "@/src/flows/portfolio/reconcile-fund-classification";

// The per-ticker sector classification surface (FIX-762) — backs the Health
// view's sector-exposure axis. `GET ?userId=…` returns the sector for each of the
// user's held single-name EQUITY tickers, filling misses lazily from the existing
// Yahoo `resolveSector` and caching successes in the global
// `app.instrument_classifications` table.
//
// A sector miss is checked against `reconcileFundClassification` before being
// cached as "unclassified" (FIX-762 follow-up): a fund/crypto ticker mistyped
// `assetType: "equity"` at import has no GICS sector to find — that's not a
// resolution failure, it's a data-classification bug. When Yahoo's own
// instrument-kind field confirms it, the holding is auto-corrected
// (`repo.reclassifyHoldingByTicker`, self-heal semantics — a manual override
// is preserved) and drops out of the equity/sector ticker set for good, on the
// very next request.
//
// The ticker set is derived SERVER-SIDE from the caller's own holdings (the
// `quotes` route precedent), never taken from the query string: a provider
// fan-out + global-table write must not be driveable by caller-controllable
// input (BP-031/BP-033), so the client passes only `userId`, and only tickers the
// user actually holds can ever trigger a Yahoo call. Funds/bonds/crypto/cash have
// no single-name sector, so only equities are resolved.
//
// This GET deliberately WRITES two things:
//   1. An idempotent cache fill of global `instrument_classifications` reference
//      data (the same spirit as the tool runtime's `getOrFetch`, not user-scoped
//      state). Only successful resolutions are persisted; a transient Yahoo miss
//      returns `{ sector: null }` for that ticker and is NOT written, so an outage
//      never permanently blanks a ticker — it is retried on a later request
//      (in-process de-duped by `resolveSector`'s cache meanwhile).
//   2. A bounded self-heal of mistyped held equities (`reclassifyHoldingByTicker`)
//      when Yahoo's own instrument-kind confirms the ticker is a fund/crypto —
//      the same correction the offline `backfill-fund-classification` script
//      applies. Manual overrides are preserved. The response surfaces
//      `reclassifiedTickers` so the Health client can refetch accounts; a no-op
//      (manual row / no match) does NOT suppress the ticker.
//
// AUTH POSTURE (dev-only): `userId` is a client-asserted query param, exactly as
// the accounts / quotes / ledger read routes are; a real multi-user deployment
// resolves caller identity server-side before trusting it (BP-031, deferred
// lab-wide until real server auth lands). The classification rows themselves are
// global, public per-ticker facts (Key Decision 2) — the `userId` here scopes
// which tickers to fetch AND which household's holdings the self-heal may touch.
export const dynamic = "force-dynamic";

/** Bounded fan-out to Yahoo (the `getQuotes` idiom); `resolveSector`'s own
 *  `getOrFetch` de-dupes a burst in-process so a wide fill can't hammer it. */
const CLASSIFY_CONCURRENCY = 4;

/** One classification the route returns (null sector = unresolved this request). */
export type ClassificationEntry = { ticker: string; sector: string | null };

/** Response body — `reclassifiedTickers` lists holdings this request actually corrected. */
export type ClassificationsResponse = {
  classifications: ClassificationEntry[];
  reclassifiedTickers: string[];
};

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  const repo = await getRepository();
  // Derive the held single-name EQUITY tickers server-side — only these use the
  // sector axis, and only a ticker the user holds can trigger a provider call.
  const { holdings } = await repo.getPortfolio(userId);
  const tickers = [
    ...new Set(
      holdings
        .filter((h) => h.assetType === "equity")
        .map((h) => h.ticker.toUpperCase()),
    ),
  ];
  if (tickers.length === 0) {
    return NextResponse.json({
      classifications: [] as ClassificationEntry[],
      reclassifiedTickers: [] as string[],
    } satisfies ClassificationsResponse);
  }

  const cached = await repo.getInstrumentClassifications(tickers);
  const bySector = new Map<string, string | null>(cached.map((r) => [r.ticker, r.sector]));

  // A ticker with NO cached row is a miss (resolve it). The fill path never
  // writes a null-sector row, so a cached `null` means "resolved, no sector" and
  // is intentionally not re-resolved — only an out-of-band manual null row could
  // sit here, and treating it as a miss would re-hit Yahoo on every request.
  const misses = tickers.filter((t) => !bySector.has(t));
  const reclassified = new Set<string>();
  if (misses.length > 0) {
    const date = new Date().toISOString().slice(0, 10);
    const resolved = await mapLimit(misses, CLASSIFY_CONCURRENCY, async (ticker) => {
      const { sector } = await resolveSector(ticker, date);
      if (sector === null) {
        // No GICS sector — before caching this ticker as a genuinely
        // unclassified equity, check whether it's actually a fund/crypto
        // asset mistyped `assetType: "equity"` at import.
        const correction = await reconcileFundClassification(ticker);
        if (correction !== null) {
          const { updated } = await repo.reclassifyHoldingByTicker(userId, ticker, correction);
          // Only treat as reclassified when a row actually changed — a manual
          // override updates zero rows and must stay on the equity/sector axis
          // (and keep retrying), not be suppressed as if the heal landed.
          return { ticker, sector: null, reclassified: updated > 0 };
        }
      }
      return { ticker, sector, reclassified: false };
    });
    for (const r of resolved) {
      if (r.reclassified) reclassified.add(r.ticker);
      else bySector.set(r.ticker, r.sector);
    }
    // Persist SUCCESSES ONLY — a miss stays out of the table so it retries later.
    const successes = resolved.filter((r) => !r.reclassified && r.sector !== null) as {
      ticker: string;
      sector: string;
    }[];
    if (successes.length > 0) {
      await repo.upsertInstrumentClassifications(
        successes.map((r) => ({ ticker: r.ticker, sector: r.sector, source: "yahoo" })),
      );
    }
  }

  // A reclassified ticker is no longer `assetType: "equity"` as of this
  // request — omit it rather than reporting a misleading `{ sector: null }`
  // for what is now a fund/crypto holding; the next holdings fetch reflects
  // the correction and the ticker won't even reach this route's equity filter.
  const classifications: ClassificationEntry[] = tickers
    .filter((ticker) => !reclassified.has(ticker))
    .map((ticker) => ({ ticker, sector: bySector.get(ticker) ?? null }));
  return NextResponse.json({
    classifications,
    reclassifiedTickers: [...reclassified],
  } satisfies ClassificationsResponse);
}
