/**
 * Per-minute polling tick for dynamic weekly-digest schedules. Claims
 * due rows from the shared `ScheduleIndex` and fans them out to the
 * framework's dispatch endpoint with bounded concurrency.
 */
import { createScheduleTickHandler } from "@flow-state-dev/vercel/schedules";
import { scheduleIndex } from "@/lib/server";

export const GET = createScheduleTickHandler({
  flowKind: "weekly-digest",
  index: scheduleIndex,
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
