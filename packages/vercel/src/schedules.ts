/**
 * Vercel-side helper for the `@flow-state-dev/scheduled` transport.
 *
 *  - `createGetToPostCronShim` — turns Vercel Cron's GET hit into the
 *    POST `…/schedules/<id>/dispatch` call the framework expects.
 *
 * It authenticates inbound requests via `Authorization: Bearer <secret>`
 * (constant-time compare) and forwards the same bearer to the dispatch
 * endpoint.
 */

import { timingSafeEqual } from "node:crypto";

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
