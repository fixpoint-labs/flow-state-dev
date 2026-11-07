/**
 * `@flow-state-dev/store-postgres`: what an app author imports.
 * `postgresStores` is the adapter `createFlowState({ stores })` takes, and
 * `createPostgresScheduleIndex` backs scheduled flows' dynamic schedules.
 *
 * The registry factory, the per-store constructors and the schema and
 * transaction helpers are for host and adapter authors, on
 * `@flow-state-dev/store-postgres/host`.
 */
export { postgresStores } from "./registry";
export { createPostgresScheduleIndex } from "./schedule-index";
export type { PostgresStoreOptions, PoolConfig } from "./types";
