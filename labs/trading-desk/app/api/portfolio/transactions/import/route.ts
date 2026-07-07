import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import {
  importTransactionFile,
  importTransactionsSchema,
} from "@/src/flows/portfolio/portfolio-writes";

// Import a brokerage transaction-history file (OFX / QFX / QBO) into an
// account's ledger (FIX-775), returning the file-import report directly. Writes
// through the same FIX-774 ingestion contract manual entry uses; the ingest
// materializes derived positions, so the import alone rebuilds positions, cost
// basis, and hold periods. A plain route, not a flow action (FIX-736 follow-up)
// — the report reaching the UI is exactly what the flow envelope couldn't do.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted in the body. A real
// multi-user deployment MUST resolve identity server-side — otherwise IDOR.
export const dynamic = "force-dynamic";

const payload = importTransactionsSchema.extend({ userId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, ...input } = parsed.data;
  const repo = await getRepository();
  const report = await importTransactionFile(input, userId, repo);
  return NextResponse.json(report);
}
