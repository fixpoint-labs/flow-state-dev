/**
 * Per-minute polling tick for dynamic weekly-digest schedules. Claims
 * due rows from the shared `ScheduleIndex` and fans them out to the
 * framework's dispatch endpoint with bounded concurrency.
 *
 * `getRouter()` is awaited on every request because the ScheduleIndex
 * implementation is installed lazily inside `createStores()` (it needs
 * the same pg pool the stores use). On a cold lambda where this route
 * is the first request to hit the box, the impl is uninitialised and
 * `claimDue` would no-op — so we force initialisation before delegating.
 */
import { createScheduleTickHandler } from "@flow-state-dev/vercel/schedules";
import { scheduleIndex, getRouter } from "@/lib/server";

const handler = createScheduleTickHandler({
  flowKind: "weekly-digest",
  index: scheduleIndex,
});

export async function GET(req: Request): Promise<Response> {
  await getRouter();
  return handler(req);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
