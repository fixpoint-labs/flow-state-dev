import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";

// Server-only read of the transaction ledger (FIX-774). The ledger is an
// app-owned table, not a resource, so the Portfolio UI's transactions pane reads
// it here (the `accounts` route precedent). `userId` is the household scope;
// optional `accountId` / `ticker` filters and a `limit` cap narrow the read.
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
  const ticker = params.get("ticker") ?? undefined;
  const limitParam = params.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const repo = await getRepository();
  const events = await repo.getLedger(userId, { accountId, ticker, limit });
  return NextResponse.json({ events });
}
