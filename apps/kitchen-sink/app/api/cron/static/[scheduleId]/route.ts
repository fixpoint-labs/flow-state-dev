/**
 * Vercel Cron GET → framework POST shim for static weekly-digest
 * schedules. One row per static schedule in `vercel.json`; the path
 * carries the schedule id as a dynamic segment so adding new static
 * schedules doesn't require a new route file.
 */
import { createGetToPostCronShim } from "@flow-state-dev/vercel/schedules";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ scheduleId: string }> }
): Promise<Response> {
  const { scheduleId } = await params;
  const handler = createGetToPostCronShim({
    flowKind: "weekly-digest",
    scheduleId,
  });
  return handler(req);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
