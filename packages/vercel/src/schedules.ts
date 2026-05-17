/**
 * Vercel-side helpers for the `@flow-state-dev/scheduled` transport.
 *
 *  - `createGetToPostCronShim` — turns Vercel Cron's GET hit into the
 *    POST `…/schedules/<id>/dispatch` call the framework expects.
 *  - `createScheduleTickHandler` — runs once per cron beat against a
 *    `ScheduleIndex`, claims due rows, and dispatches them with
 *    bounded concurrency.
 *
 * Both handlers authenticate inbound requests via `Authorization:
 * Bearer <secret>` (constant-time compare) and forward the same
 * bearer to the dispatch endpoint.
 *
 * Runtime dependencies stay zero — only `@flow-state-dev/scheduled`
 * type imports cross the boundary. The bundle Vercel ships for the
 * cron route stays tiny.
 */

import { timingSafeEqual } from "node:crypto";
import type { ScheduleIndex, ScheduleIndexRow } from "@flow-state-dev/scheduled";

/** Options for `createGetToPostCronShim`. */
export interface CreateGetToPostCronShimOptions {
  /** Flow kind (singular) the schedule dispatches against. */
  flowKind: string;
  /** Schedule resource id mounted under `…/schedules/<id>/dispatch`. */
  scheduleId: string;
  /**
   * Base URL of the deployment. Defaults to
   * `process.env.NEXT_PUBLIC_BASE_URL`.
   */
  baseUrl?: string;
  /**
   * Shared secret expected on `Authorization: Bearer <secret>` and
   * forwarded to the dispatch POST. Defaults to
   * `process.env.CRON_SECRET`.
   */
  secret?: string;
}

/**
 * Build a Web-Fetch-style handler that accepts Vercel Cron's GET and
 * forwards as a POST to the framework's scheduled-dispatch endpoint.
 */
export function createGetToPostCronShim(
  opts: CreateGetToPostCronShimOptions
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const secret = resolveSecret(opts.secret);
    if (!authorize(req, secret)) return unauthorized();

    const base = resolveBaseUrl(opts.baseUrl);
    if (base === null) return new Response("Server misconfigured: missing baseUrl", { status: 500 });

    const url = `${trimTrailingSlash(base)}/api/flows/${encodeURIComponent(opts.flowKind)}/schedules/${encodeURIComponent(opts.scheduleId)}/dispatch`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` }
    });
    return new Response(null, { status: res.status });
  };
}

/** Options for `createScheduleTickHandler`. */
export interface CreateScheduleTickHandlerOptions {
  /** Flow kind (singular) the dispatcher targets. */
  flowKind: string;
  /** The schedule index to claim due rows from. */
  index: ScheduleIndex;
  /**
   * Base URL of the deployment. Defaults to
   * `process.env.NEXT_PUBLIC_BASE_URL`.
   */
  baseUrl?: string;
  /**
   * Shared secret for `Authorization: Bearer <secret>` on the incoming
   * cron call and on the outbound dispatch POSTs. Defaults to
   * `process.env.CRON_SECRET`.
   */
  secret?: string;
  /** Maximum rows claimed per tick. Default `100`. */
  maxPerTick?: number;
  /** Maximum in-flight dispatch POSTs. Default `10`. */
  concurrency?: number;
  /**
   * Optional observer for each dispatch attempt — fires with the
   * dispatched row and the HTTP status returned (or `0` when the POST
   * throws). The dispatcher never throws back to the cron caller.
   */
  onDispatch?: (row: ScheduleIndexRow, status: number) => void;
}

/**
 * Build a Web-Fetch-style handler that ticks the schedule index. On
 * each call it atomically claims due rows from the index (advancing
 * them in the same step) and POSTs each to the framework's
 * scheduled-dispatch endpoint with bounded concurrency.
 *
 * Failures to claim return 500 so the cron retries on the next beat
 * with the rows still pending. Failures to dispatch are logged via
 * `onDispatch` — the row has already been advanced (at-most-once
 * contract), so a failed POST is dropped, not retried.
 */
export function createScheduleTickHandler(
  opts: CreateScheduleTickHandlerOptions
): (req: Request) => Promise<Response> {
  const maxPerTick = opts.maxPerTick ?? 100;
  const concurrency = Math.max(1, opts.concurrency ?? 10);

  return async (req: Request): Promise<Response> => {
    const secret = resolveSecret(opts.secret);
    if (!authorize(req, secret)) return unauthorized();

    const base = resolveBaseUrl(opts.baseUrl);
    if (base === null) return new Response("Server misconfigured: missing baseUrl", { status: 500 });

    let due: ScheduleIndexRow[];
    try {
      due = await opts.index.claimDue(Date.now(), maxPerTick);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[flow-state/vercel/schedules] claimDue failed", err);
      return new Response("claimDue failed", { status: 500 });
    }

    if (due.length === 0) {
      return new Response(null, { status: 204 });
    }

    const baseUrl = trimTrailingSlash(base);
    const flowKind = encodeURIComponent(opts.flowKind);

    await runWithConcurrency(due, concurrency, async (row) => {
      const url = `${baseUrl}/api/flows/${flowKind}/schedules/${encodeURIComponent(row.userId)}/${encodeURIComponent(row.key)}/dispatch`;
      let status = 0;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json"
          },
          // `row.nextFireAt` is the pre-advance fire timestamp returned
          // by `claimDue`; passing it as `nominalFireTime` gives each
          // legitimate fire a unique idempotency dedupeKey. Without it
          // the framework's 60s cache collapses every dispatch for the
          // same scheduleId, silently dropping short-interval schedules.
          body: JSON.stringify({
            nominalFireTime: new Date(row.nextFireAt).toISOString()
          })
        });
        status = res.status;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[flow-state/vercel/schedules] dispatch failed for ${row.userId}/${row.key}`,
          err
        );
      }
      // Never let an observer throw kill the worker — Promise.allSettled
      // on the worker pool would swallow the rejection and every later
      // item assigned to this slot would be silently skipped.
      try {
        opts.onDispatch?.(row, status);
      } catch {
        /* swallow observer errors */
      }
    });

    return new Response(null, { status: 200 });
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Resolve the bearer secret from options or `CRON_SECRET`. */
function resolveSecret(secret: string | undefined): string {
  return secret ?? process.env.CRON_SECRET ?? "";
}

/** Resolve the base URL from options or `NEXT_PUBLIC_BASE_URL`. */
function resolveBaseUrl(baseUrl: string | undefined): string | null {
  const v = baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL;
  if (v === undefined || v.length === 0) return null;
  return v;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

/**
 * Constant-time bearer authorization. Empty configured secret rejects
 * unconditionally so a missing env var doesn't accidentally allow open
 * access.
 */
function authorize(req: Request, secret: string): boolean {
  if (secret.length === 0) return false;
  const header = req.headers.get("authorization");
  if (header === null) return false;
  const expected = `Bearer ${secret}`;
  return bearerEquals(header, expected);
}

/**
 * Constant-time string compare. Always runs `timingSafeEqual` against a
 * same-length buffer so a length mismatch does not return faster than a
 * content mismatch — otherwise an attacker probing input lengths could
 * recover the expected token length.
 */
function bearerEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  const ref = Buffer.alloc(bb.length, 0);
  ab.copy(ref, 0, 0, Math.min(ab.length, ref.length));
  const match = timingSafeEqual(ref, bb);
  return ab.length === bb.length && match;
}

/**
 * Run `task` over `items` with at most `concurrency` in flight at
 * once. Errors thrown by the task surface to the caller via
 * `Promise.allSettled` semantics — the task itself is responsible for
 * catching dispatch failures (see `createScheduleTickHandler`).
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, items.length);
  for (let i = 0; i < n; i++) {
    workers.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          await task(items[idx]);
        }
      })()
    );
  }
  await Promise.allSettled(workers);
}
