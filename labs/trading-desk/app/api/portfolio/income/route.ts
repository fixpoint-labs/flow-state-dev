import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/db/portfolio-db";

// Server-only read of ledger-derived income (dividends + interest) per
// (account, ticker) — the `ledger` route precedent. Aggregated from the ledger
// at read time, so income earned on a since-closed position still appears (the
// holdings row is gone; the dividends were still earned). Ticker-less rows are
// account-level income (interest, MMF sweeps).
//
// AUTH POSTURE (dev-only): `userId` is client-asserted, exactly as the lab's
// other read routes and flow routes are (single-user lab, USER_ID = "devuser").
// A real multi-user deployment MUST resolve the caller identity server-side and
// ignore a client-supplied `userId` before trusting it — otherwise it is an IDOR.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const userId = params.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }
  const accountId = params.get("accountId") ?? undefined;

  const repo = await getRepository();
  const income = await repo.getIncomeSummary(userId, { accountId });
  return NextResponse.json({ income });
}
