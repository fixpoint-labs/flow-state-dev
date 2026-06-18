/**
 * Durable runtime construction for the orchestrator driver.
 *
 * The driver is a long-lived process that calls `runAction` / `continueRequest`
 * itself (no HTTP server), so it builds the stores and the checkpoint durability
 * provider directly — the same shape `suspension-resume.test.ts` uses, but
 * SQLite-backed so suspension records and checkpoints survive a restart. One
 * database file per babysat issue keeps the POC's "single babysit per issue"
 * model simple and inspectable.
 */
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { createCheckpointDurabilityProvider } from "@flow-state-dev/server";
import type { DurabilityProvider } from "@flow-state-dev/server";

/** The durable runtime the driver loop operates on. */
export interface OrchestratorRuntime {
  stores: ReturnType<typeof createSQLiteStores>;
  provider: DurabilityProvider;
  /** Close the SQLite connection. */
  close(): void;
}

/**
 * Build SQLite-backed stores plus a checkpoint durability provider over them.
 * `filename` may be a path or `:memory:`; schema DDL auto-initializes on first
 * open.
 */
export function createOrchestratorRuntime(filename: string): OrchestratorRuntime {
  const stores = createSQLiteStores({ filename });
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  return { stores, provider, close: () => stores.close() };
}
