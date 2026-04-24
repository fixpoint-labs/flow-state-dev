/**
 * Vercel-safe `pg.Pool` defaults for use with `@flow-state-dev/store-postgres`.
 *
 * Background: Vercel keeps Node function instances warm across requests, while
 * auto-suspending databases (Neon, Supabase direct-connect, RDS with auto-pause)
 * drop TCP sockets after ~5 minutes idle. A `pg.Pool` that caches those dead
 * sockets hands them back on the next cold request and `pg` emits
 * "Connection terminated unexpectedly" until the caller refreshes.
 *
 * These defaults close that race: a short idle timeout ensures dead sockets
 * can't outlive the auto-suspend window, a longer connection timeout covers
 * wake-up latency, `max: 1` matches serverless one-request-per-instance
 * concurrency, and `allowExitOnIdle` lets the runtime freeze cleanly.
 *
 * This module is a zero-runtime config bag — it uses `import type` only, so
 * importing it does not add `pg` to the bundle for apps that don't use Postgres.
 */

import type { PoolConfig } from "pg";

/**
 * Drop-in `pg.PoolConfig` defaults tuned for running on Vercel against an
 * auto-suspending Postgres endpoint. Pass through
 * `@flow-state-dev/store-postgres`' `poolOptions` input:
 *
 * ```ts
 * import { createPostgresStores } from "@flow-state-dev/store-postgres";
 * import { vercelPgPoolOptions } from "@flow-state-dev/vercel/pg";
 *
 * const stores = await createPostgresStores({
 *   connectionString: process.env.DATABASE_URL,
 *   poolOptions: process.env.VERCEL ? vercelPgPoolOptions : undefined,
 * });
 * ```
 *
 * Spread to customize: `{ ...vercelPgPoolOptions, statement_timeout: 30_000 }`.
 */
export const vercelPgPoolOptions: PoolConfig = {
  /** Close idle sockets well before the database's auto-suspend window so dead
   *  sockets can't be cached across a suspend boundary. */
  idleTimeoutMillis: 10_000,
  /** Give the database time to wake from auto-suspend on the first connection
   *  after idle. Typical wake-up latency is 1–3s; 15s leaves plenty of headroom. */
  connectionTimeoutMillis: 15_000,
  /** Serverless function instances serve one request at a time. A larger pool
   *  just caches more sockets that can go stale during the function freeze. */
  max: 1,
  /** Let the Node runtime freeze cleanly when all sockets are idle. */
  allowExitOnIdle: true
};
