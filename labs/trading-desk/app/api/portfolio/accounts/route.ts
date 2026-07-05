import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { toAccountStates } from "@/src/db/repository";
import {
  deleteAccount,
  saveAccount,
  saveAccountSchema,
} from "@/src/flows/portfolio/portfolio-writes";

// The accounts REST surface over the app-owned portfolio tables (FIX-772). Read
// (GET) and the account mutations (POST save, DELETE) all live here as plain
// routes calling the repository / the domain-write functions — accounts are
// basic relational CRUD, not flow-shaped work, so they don't go through a flow
// action (FIX-736 follow-up; see `src/flows/portfolio/portfolio-writes.ts`).
//
// AUTH POSTURE (dev-only): `userId` is client-asserted (query param on GET/
// DELETE, body field on POST), exactly as the lab's other routes are. A real
// multi-user deployment MUST resolve the caller identity server-side and ignore
// a client-supplied `userId` before trusting it — otherwise it is an IDOR.
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

const savePayload = saveAccountSchema.extend({ userId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = savePayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, ...input } = parsed.data;
  const repo = await getRepository();
  const result = await saveAccount(input, userId, repo);
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const userId = params.get("userId");
  const accountId = params.get("accountId");
  if (!userId || !accountId) {
    return NextResponse.json(
      { error: "userId and accountId query params are required" },
      { status: 400 },
    );
  }
  const repo = await getRepository();
  await deleteAccount(accountId, userId, repo);
  return NextResponse.json({ ok: true });
}
