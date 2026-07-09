import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { backfillSplits } from "@/src/flows/portfolio/portfolio-writes";
import { fetchYahooSplits } from "@/src/flows/analysis/tools/providers/yahoo";

// Backfill stock-split events for the household from Yahoo (keyless) so realized
// gains re-derive correctly for tickers whose splits the original import missed
// (FIX-874 follow-up). The route wires the real provider fetcher into the
// domain function (which is provider-agnostic and unit-tested with a stub).
// Idempotent — safe to POST repeatedly; a split already in the ledger dedups.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted in the body. A real
// multi-user deployment MUST resolve identity server-side — otherwise IDOR.
export const dynamic = "force-dynamic";

const payload = z.object({ userId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const repo = await getRepository();
  const report = await backfillSplits(parsed.data.userId, repo, fetchYahooSplits);
  return NextResponse.json(report);
}
