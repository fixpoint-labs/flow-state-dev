import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";

// The quotes REST surface over the durable `app.quotes` table (FIX-823). The
// Portfolio pane reads last-known prices here instead of the retired
// `portfolioQuotes` FSD resource: dispatching `getQuotes` upserts the table, then
// the pane refetches this route (an action-completion refetch, not SSE
// `resource_change`). The ticker set is derived SERVER-SIDE from the user's
// holdings — the client passes only `userId`, never a ticker list.
//
// AUTH POSTURE (dev-only): `userId` is a client-asserted query param, exactly as
// the accounts / ledger / income read routes are. A real multi-user deployment
// MUST resolve the caller identity server-side before trusting it (BP-031,
// deferred lab-wide until real server auth lands).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }
  const repo = await getRepository();
  const { holdings } = await repo.getPortfolio(userId);
  const tickers = [...new Set(holdings.map((h) => h.ticker.toUpperCase()))];
  const quotes = await repo.getQuotes(tickers);
  return NextResponse.json({ quotes });
}
