import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import {
  deleteHolding,
  setHoldingAssetClass,
  setHoldingAssetClassSchema,
} from "@/src/flows/portfolio/portfolio-writes";

// Delete one holding by (account, ticker) — the app-owned holdings table
// (FIX-772). A holding is basic relational CRUD, so it's a plain route, not a
// flow action (FIX-736 follow-up). CSV/PDF holdings IMPORT is the sibling
// `holdings/import` route.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted. A real multi-user
// deployment MUST resolve identity server-side — otherwise it is an IDOR.
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const userId = params.get("userId");
  const accountId = params.get("accountId");
  const ticker = params.get("ticker");
  if (!userId || !accountId || !ticker) {
    return NextResponse.json(
      { error: "userId, accountId, and ticker query params are required" },
      { status: 400 },
    );
  }
  const repo = await getRepository();
  await deleteHolding(accountId, ticker, userId, repo);
  return NextResponse.json({ ok: true });
}

// Manually override a holding's allocation class (marks it manual so
// auto-classification preserves it). Same dev-only auth posture as DELETE.
export async function PATCH(req: NextRequest) {
  const parsed = setHoldingAssetClassSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "userId, accountId, ticker, and a valid assetClass are required" },
      { status: 400 },
    );
  }
  const { userId, accountId, ticker, assetClass } = parsed.data;
  const repo = await getRepository();
  await setHoldingAssetClass(accountId, ticker, userId, assetClass, repo);
  return NextResponse.json({ ok: true });
}
