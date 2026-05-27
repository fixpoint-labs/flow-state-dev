/**
 * 15-minute polling tick for dynamic weekly-digest schedules. Claims
 * due rows from the shared `ScheduleIndex` and fans them out to the
 * framework's dispatch endpoint with bounded concurrency.
 *
 * `flowstate.ready()` is awaited on every request because the ScheduleIndex
 * implementation is installed lazily when the active profile resolves its
 * pool (the index shares the stores' pg pool). On a cold lambda where this
 * route is the first request to hit the box, the impl is uninitialised and
 * `claimDue` would no-op — so we force initialisation before delegating.
 *
 * Logs one line on entry and one line per dispatched row so operators
 * can confirm the cron is firing in production. The handler itself
 * does not log otherwise — a tick with no due rows is silent at
 * application level (Vercel still records the 204 in the Cron Jobs
 * tab).
 */
import { createScheduleTickHandler } from "@flow-state-dev/vercel/schedules";
import { scheduleIndex } from "@/lib/schedule-index";
import { flowstate } from "@/lib/flowstate";

const handler = createScheduleTickHandler({
  flowKind: "weekly-digest",
  index: scheduleIndex,
  onDispatch: (row, status) => {
    console.log(
      `[schedule-tick] dispatched ${row.userId}/${row.key} → ${status}`,
    );
  },
});

export async function GET(req: Request): Promise<Response> {
  const startedAt = Date.now();
  console.log("[schedule-tick] tick fired");
  await flowstate.ready();
  const res = await handler(req);
  console.log(
    `[schedule-tick] completed status=${res.status} duration=${Date.now() - startedAt}ms`,
  );
  return res;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
