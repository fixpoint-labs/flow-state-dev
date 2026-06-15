import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import { toAccountStates } from "@/src/db/repository";

// Server-only read of the app-owned portfolio tables (FIX-772). Accounts +
// holdings no longer flow through a resource client projection, so the
// Portfolio UI reads them here instead. `userId` is the household scope.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted, exactly as the lab's
// flow routes are — `createFlowApiRouter` here uses the default
// `body.userId` principal resolver (no `resolvePrincipal`), so there is no
// server-side identity anywhere in this single-user lab (USER_ID = "devuser").
// This route is no weaker than the existing surface, but a real multi-user
// deployment MUST resolve the caller identity server-side (auth middleware /
// a principal resolver) and ignore a client-supplied `userId` before trusting
// it — otherwise it is an IDOR.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }
  const repo = await getRepository();
  const accounts = toAccountStates(await repo.getPortfolio(userId));
  return NextResponse.json({ accounts });
}
