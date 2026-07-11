import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import { resolveSector } from "@/src/flows/analysis/lib/sector-resolution";
import { mapLimit } from "@/src/flows/analysis/lib/concurrency";

// The per-ticker sector classification surface (FIX-762) — backs the Health
// view's sector-exposure axis. `GET ?userId=…` returns the sector for each of the
// user's held single-name EQUITY tickers, filling misses lazily from the existing
// Yahoo `resolveSector` and caching successes in the global
// `app.instrument_classifications` table.
//
// The ticker set is derived SERVER-SIDE from the caller's own holdings (the
// `quotes` route precedent), never taken from the query string: a provider
// fan-out + global-table write must not be driveable by caller-controllable
// input (BP-031/BP-033), so the client passes only `userId`, and only tickers the
// user actually holds can ever trigger a Yahoo call. Funds/bonds/crypto/cash have
// no single-name sector, so only equities are resolved.
//
// This GET deliberately WRITES (an idempotent cache fill of global reference
// data — the same spirit as the tool runtime's `getOrFetch`, not user-scoped
// state). Only successful resolutions are persisted; a transient Yahoo miss
// returns `{ sector: null }` for that ticker and is NOT written, so an outage
// never permanently blanks a ticker — it is retried on a later request
// (in-process de-duped by `resolveSector`'s cache meanwhile).
//
// AUTH POSTURE (dev-only): `userId` is a client-asserted query param, exactly as
// the accounts / quotes / ledger read routes are; a real multi-user deployment
// resolves caller identity server-side before trusting it (BP-031, deferred
// lab-wide until real server auth lands). The table rows themselves are global,
// public per-ticker facts (Key Decision 2) — the `userId` here scopes only which
// tickers to fetch, not who may read a sector.
export const dynamic = "force-dynamic";

/** Bounded fan-out to Yahoo (the `getQuotes` idiom); `resolveSector`'s own
 *  `getOrFetch` de-dupes a burst in-process so a wide fill can't hammer it. */
const CLASSIFY_CONCURRENCY = 4;

/** One classification the route returns (null sector = unresolved this request). */
export type ClassificationEntry = { ticker: string; sector: string | null };

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
    return NextResponse.json({ classifications: [] as ClassificationEntry[] });
  }

  const cached = await repo.getInstrumentClassifications(tickers);
  const bySector = new Map<string, string | null>(cached.map((r) => [r.ticker, r.sector]));

  // A ticker with NO cached row is a miss (resolve it). The fill path never
  // writes a null-sector row, so a cached `null` means "resolved, no sector" and
  // is intentionally not re-resolved — only an out-of-band manual null row could
  // sit here, and treating it as a miss would re-hit Yahoo on every request.
  const misses = tickers.filter((t) => !bySector.has(t));
  if (misses.length > 0) {
    const date = new Date().toISOString().slice(0, 10);
    const resolved = await mapLimit(misses, CLASSIFY_CONCURRENCY, async (ticker) => {
      const { sector } = await resolveSector(ticker, date);
      return { ticker, sector };
    });
    for (const r of resolved) bySector.set(r.ticker, r.sector);
    // Persist SUCCESSES ONLY — a miss stays out of the table so it retries later.
    const successes = resolved.filter((r) => r.sector !== null) as { ticker: string; sector: string }[];
    if (successes.length > 0) {
      await repo.upsertInstrumentClassifications(
        successes.map((r) => ({ ticker: r.ticker, sector: r.sector, source: "yahoo" })),
      );
    }
  }

  const classifications: ClassificationEntry[] = tickers.map((ticker) => ({
    ticker,
    sector: bySector.get(ticker) ?? null,
  }));
  return NextResponse.json({ classifications });
}
