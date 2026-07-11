import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import { resolveSector } from "@/src/flows/analysis/lib/sector-resolution";
import { mapLimit } from "@/src/flows/analysis/lib/concurrency";

// The per-ticker sector classification surface (FIX-762) — backs the Health
// view's sector-exposure axis. `GET ?tickers=A,B,C` returns each held equity
// ticker's Yahoo sector, filling misses lazily from the existing `resolveSector`
// and caching successes in the global `app.instrument_classifications` table.
//
// This GET deliberately WRITES (an idempotent cache fill of global reference
// data — the same spirit as the tool runtime's `getOrFetch`, not a
// user-scoped mutation). Only successful resolutions are persisted; a transient
// Yahoo miss returns `{ sector: null }` for that ticker and is NOT written, so a
// provider outage never permanently blanks a ticker — it is retried on a later
// request (in-process de-duped by `resolveSector`'s cache meanwhile).
//
// AUTH POSTURE: no `userId` — a ticker's sector is a public global fact, not
// per-user data (the `app.quotes` / classification scoping, Key Decision 2).
export const dynamic = "force-dynamic";

/** Sanity cap — the union of a household's held tickers is far below this. */
const MAX_TICKERS = 200;
/** Bounded fan-out to Yahoo (the `getQuotes` idiom); `resolveSector`'s own
 *  `getOrFetch` de-dupes a burst in-process so a wide request can't hammer it. */
const CLASSIFY_CONCURRENCY = 4;

/** One classification the route returns (null sector = unresolved this request). */
export type ClassificationEntry = { ticker: string; sector: string | null };

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers");
  if (!raw) {
    return NextResponse.json({ error: "tickers query param is required" }, { status: 400 });
  }
  const tickers = [...new Set(raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))];
  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers query param is empty" }, { status: 400 });
  }
  if (tickers.length > MAX_TICKERS) {
    return NextResponse.json(
      { error: `too many tickers (max ${MAX_TICKERS})` },
      { status: 400 },
    );
  }

  const repo = await getRepository();
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
