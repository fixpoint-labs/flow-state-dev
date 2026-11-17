// FIX-2752.
/**
 * `vercelScheduler()`: the scheduler adapter for an app on Vercel, where no
 * process stays up to run the engine's local cron.
 *
 * Pass it to `createFlowState({ scheduler })` and mount its `route` where one
 * Vercel Cron entry calls it (`export const GET = scheduler.route`). Each call
 * runs the app's one schedule tick, which fires every due schedule, static and
 * dynamic, of every flow. The tick dispatches each fire over the network to the
 * deployment the cron call reached, so each fire is its own function
 * invocation rather than a share of the tick's.
 *
 * The route authenticates the cron call with `Authorization: Bearer <secret>`
 * (constant-time compare; an empty secret refuses every call). It answers 500
 * when the tick rejects (a schedule index's claim threw), so the next beat
 * retries with those schedules still pending.
 */
import { timingSafeEqual } from "node:crypto";
import type { SchedulerAdapter, ScheduleTicker } from "@flow-state-dev/engine/host";

/** Options for {@link vercelScheduler}. */
export interface VercelSchedulerOptions {
  /**
   * The secret Vercel Cron sends as `Authorization: Bearer <secret>`. Default
   * `process.env.CRON_SECRET`, read on each call. Each fire the tick sends
   * carries the same secret to the dispatch endpoint.
   */
  secret?: string;
}

/** A {@link SchedulerAdapter} with the route Vercel Cron calls. */
export interface VercelScheduler extends SchedulerAdapter {
  /**
   * The cron route's handler: authenticate the call, run the tick once, and
   * answer 200 with how many fires it sent. 401 for a missing or wrong
   * secret, 500 when the tick rejects or the scheduler was never passed to
   * `createFlowState`. Unbound: export it directly as the route's `GET`.
   */
  route(req: Request): Promise<Response>;
}

/** Build the Vercel scheduler adapter. See the module header. */
export function vercelScheduler(options: VercelSchedulerOptions = {}): VercelScheduler {
  let ticker: ScheduleTicker | undefined;
  return {
    start(given) {
      ticker = given;
      return {
        stop: async () => {
          if (ticker === given) ticker = undefined;
        }
      };
    },
    route: async (req) => {
      const secret = options.secret ?? process.env.CRON_SECRET ?? "";
      if (!authorize(req, secret)) return new Response("Unauthorized", { status: 401 });
      if (ticker === undefined) {
        return new Response("Server misconfigured: pass this scheduler to createFlowState({ scheduler })", { status: 500 });
      }
      try {
        const report = await ticker.tick({ baseUrl: new URL(req.url).origin, secret });
        return Response.json({ dispatched: report.dispatched.length });
      } catch (err) {
        console.error("[flow-state] schedule tick failed; the next cron call retries", err);
        return new Response("Schedule tick failed", { status: 500 });
      }
    }
  };
}

/**
 * Constant-time bearer authorization. An empty configured secret rejects
 * unconditionally, so a missing env var never opens the route.
 */
function authorize(req: Request, secret: string): boolean {
  if (secret.length === 0) return false;
  const header = req.headers.get("authorization");
  if (header === null) return false;
  return bearerEquals(header, `Bearer ${secret}`);
}

/**
 * Constant-time string compare. Always runs `timingSafeEqual` against a
 * same-length buffer so a length mismatch does not return faster than a
 * content mismatch, which would let a caller probing input lengths recover
 * the expected token's length.
 */
function bearerEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const ref = Buffer.alloc(bb.length, 0);
  ab.copy(ref, 0, 0, Math.min(ab.length, ref.length));
  const match = timingSafeEqual(ref, bb);
  return ab.length === bb.length && match;
}
