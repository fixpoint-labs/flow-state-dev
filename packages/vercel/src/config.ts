/**
 * Vercel route configuration exports.
 *
 * Re-export these from your Next.js route file so Vercel picks up the correct
 * runtime settings. Vercel reads these as static exports at build time.
 *
 * ```ts
 * // app/api/fsd/[...path]/route.ts
 * export { runtime, maxDuration, dynamic } from '@flow-state-dev/vercel/config';
 * ```
 */

/** Use Node.js runtime for full API compatibility (streams, pg, fs). */
export const runtime = "nodejs";

/** Maximum function execution time in seconds. 300s covers most agent workflows. */
export const maxDuration = 300;

/** Prevent Next.js from statically optimizing or caching SSE routes. */
export const dynamic = "force-dynamic";
