import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/db/portfolio-db";
import {
  importHoldingsCsv,
  importHoldingsSchema,
} from "@/domain/portfolio/services/portfolio-writes";

// Import a holdings CSV into an account (FIX-772). Returns the authoritative
// import report directly — the whole reason CRUD is a route and not a flow
// action, where `sendAction` would return only a request envelope. The PDF
// import path (`extractHoldingsFromPdf`, a streaming LLM generator) stays a
// flow action; its confirmed rows are serialized to CSV and POSTed here, the
// same as a direct CSV upload.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted in the body. A real
// multi-user deployment MUST resolve identity server-side — otherwise IDOR.
export const dynamic = "force-dynamic";

const payload = importHoldingsSchema.extend({ userId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, ...input } = parsed.data;
  const repo = await getRepository();
  const report = await importHoldingsCsv(input, userId, repo);
  return NextResponse.json(report);
}
