/**
 * The one Vercel Cron route for every schedule of every flow (`vercel.json`).
 * Each call runs the app's schedule tick through `vercelScheduler`'s route,
 * which checks `CRON_SECRET` and dispatches each due schedule back to this
 * deployment. Off Vercel the local cron fires them and nothing calls this.
 */
import { scheduler } from "@/lib/flowstate";

export const GET = scheduler.route;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
