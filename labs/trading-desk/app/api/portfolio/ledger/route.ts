import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import {
  recordManualEvent,
  recordEventSchema,
} from "@/src/domain/portfolio/services/portfolio-writes";

// The transaction ledger REST surface (FIX-774) — an app-owned table, not a
// resource. GET reads it (the Portfolio transactions view); POST records one
// manual event, returning the ingest report directly. Basic CRUD, so a plain
// route rather than a flow action (FIX-736 follow-up). Historical file import
// (OFX) is the sibling `transactions/import` route.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted (query param on GET,
// body field on POST). A real multi-user deployment MUST resolve the caller
// identity server-side before trusting it — otherwise it is an IDOR.
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

// `recordEventSchema` now carries a cross-field refine (ZodEffects), which has
// no `.extend`; intersect the caller-asserted `userId` on instead.
const recordPayload = z.object({ userId: z.string().min(1) }).and(recordEventSchema);

export async function POST(req: NextRequest) {
  const parsed = recordPayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, ...input } = parsed.data;
  const repo = await getRepository();
  const report = await recordManualEvent(input, userId, repo);
  return NextResponse.json(report);
}
