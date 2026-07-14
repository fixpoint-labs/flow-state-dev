import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { refreshQuotes } from "@/src/domain/portfolio/services/get-quotes";
import { usesLiveQuote } from "@/src/domain/portfolio/math/value-holding";
import { fetchPortfolioQuotes } from "@/src/lib/portfolio-market-data";

// Refresh the household's last-known prices (FIX-823): fetch a live quote per
// held, quote-valued ticker and upsert the durable `app.quotes` table, then the
// pane refetches `GET /api/portfolio/quotes`. This is the WRITE half of the
// quotes surface — a plain route, NOT a flow action. Fetching + upserting is
// domain work that gains nothing from a session; as a flow action it forced the
// pane to await the SSE stream's falling edge to know the upsert had committed
// (`sendAction` resolves at stream-attach, BEFORE the write). As a route the
// pane `await`s the write directly, exactly like the sibling `importHoldings` /
// `backfillSplits` writes.
//
// Only quote-valued types (equity / etf / mutual_fund / crypto) are fetched —
// bond / option value at a carried mark, cash / MMF at par — so the ticker set
// is derived + filtered SERVER-SIDE (BP-033) from the user's holdings, exactly
// as the `GET` read route derives it. The client passes only `userId`.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted in the body, exactly as
// the sibling portfolio routes are. A real multi-user deployment MUST resolve
// the caller identity server-side (BP-031, deferred lab-wide until real server
// auth lands).
export const dynamic = "force-dynamic";

const payload = z.object({ userId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const repo = await getRepository();
  const { holdings } = await repo.getPortfolio(parsed.data.userId);
  const tickers = [
    ...new Set(
      holdings
        .filter((h) => usesLiveQuote(h.assetType))
        .map((h) => h.ticker.toUpperCase()),
    ),
  ];
  const report = await refreshQuotes(
    { tickers },
    repo,
    fetchPortfolioQuotes,
  );
  return NextResponse.json(report);
}
