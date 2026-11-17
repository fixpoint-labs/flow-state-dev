/**
 * `@flow-state-dev/store-sqlite`: what an app author imports. `sqliteStores`
 * is the adapter `createFlowState({ stores })` takes, and
 * `createSQLiteScheduleIndex` (or `sqliteScheduleIndex`, on a file of its own)
 * backs scheduled flows' dynamic schedules.
 *
 * The registry factory, the per-store constructors and the schema helpers are
 * for host and adapter authors, on `@flow-state-dev/store-sqlite/host`.
 */
export { sqliteStores, type SQLiteStoreOptions } from "./registry";
export { createSQLiteScheduleIndex, sqliteScheduleIndex } from "./schedule-index";
