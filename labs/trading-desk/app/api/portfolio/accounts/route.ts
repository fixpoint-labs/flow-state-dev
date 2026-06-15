import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import { toAccountStates } from "@/src/db/repository";

// Server-only read of the app-owned portfolio tables (FIX-772). Accounts +
// holdings no longer flow through a resource client projection, so the
// Portfolio UI reads them here instead. `userId` is the household scope (the
// single-user dev model threads `useFlowContext().userId`).
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
