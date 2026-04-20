/**
 * Recommended Vercel route configuration values.
 *
 * Next.js reads `runtime`, `maxDuration`, and `dynamic` via static analysis —
 * they must be **literal declarations** in your route file. Re-exporting from
 * this module (`export { runtime } from '...'`) will NOT work.
 *
 * Copy these values into your route file:
 *
 * ```ts
 * // app/api/fsd/[[...path]]/route.ts
 * export const runtime = "nodejs";
 * export const maxDuration = 300;
 * export const dynamic = "force-dynamic";
 * ```
 *
 * This module is exported for programmatic access (e.g. custom middleware,
 * test assertions, or non-Next.js adapters).
 */

/** Use Node.js runtime for full API compatibility (streams, pg, fs). */
export const runtime = "nodejs";

/** Maximum function execution time in seconds. 300s covers most agent workflows. */
export const maxDuration = 300;

/** Prevent Next.js from statically optimizing or caching SSE routes. */
export const dynamic = "force-dynamic";
