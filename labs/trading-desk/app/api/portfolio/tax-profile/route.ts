import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/portfolio-db";
import { saveTaxProfile, saveTaxProfileSchema } from "@/src/flows/portfolio/portfolio-writes";

// The tax-profile write (FIX-874) — its own PUT (the composite `GET /tax` read
// handles the reads). Keyed on the household, so a save overwrites in place.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted, exactly as the lab's
// other write routes are. A real multi-user deployment MUST resolve the caller
// identity server-side before trusting it — otherwise it is an IDOR.
export const dynamic = "force-dynamic";

const putPayload = saveTaxProfileSchema.extend({ userId: z.string().min(1) });

export async function PUT(req: NextRequest) {
  const parsed = putPayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { userId, ...input } = parsed.data;
  const repo = await getRepository();
  const profile = await saveTaxProfile(input, userId, repo);
  return NextResponse.json({ profile });
}
