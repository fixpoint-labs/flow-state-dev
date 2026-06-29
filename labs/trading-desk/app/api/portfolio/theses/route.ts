import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";

// Server-only read of the app-owned `app.theses` table (FIX-760). Theses are not
// an FSD resource, so the Portfolio UI reads them here (the `accounts` / `ledger`
// route precedent — a read route, not an action, since `sendAction` returns a
// request envelope not handler output). `userId` is the household scope; an
// optional `ticker` narrows to one record (the holding-row "has a thesis?" check).
//
// AUTH POSTURE (dev-only): `userId` is client-asserted, exactly as the lab's flow
// routes are (default `body.userId` principal, USER_ID = "devuser"). No weaker
// than the existing surface, but a real multi-user deployment MUST resolve the
// caller identity server-side and ignore a client-supplied `userId` — otherwise
// it is an IDOR.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }
  const ticker = req.nextUrl.searchParams.get("ticker");
  const repo = await getRepository();
  if (ticker) {
    const thesis = await repo.getThesis(userId, ticker.trim().toUpperCase());
    return NextResponse.json({ theses: thesis ? [thesis] : [] });
  }
  const theses = await repo.listTheses(userId);
  return NextResponse.json({ theses });
}
