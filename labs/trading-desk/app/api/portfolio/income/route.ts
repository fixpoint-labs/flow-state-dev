import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/db/portfolio-db";

// Server-only read of ledger-derived income (dividends + interest) per
// (account, ticker) — the `ledger` route precedent. Aggregated from the ledger
// at read time, so income earned on a since-closed position still appears (the
// holdings row is gone; the dividends were still earned). Ticker-less rows are
// account-level income (interest, MMF sweeps).
//
// This is a single-user lab, so its principal is fixed server-side rather than
// accepted from the request. A multi-user deployment must replace this with its
// authenticated server-side principal.
export const dynamic = "force-dynamic";

const USER_ID = "devuser";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const accountId = params.get("accountId") ?? undefined;

  const repo = await getRepository();
  const income = await repo.getIncomeSummary(USER_ID, { accountId });
  return NextResponse.json({ income });
}
