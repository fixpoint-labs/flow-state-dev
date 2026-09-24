/**
 * `ScheduleIndex` — opt-in store-adapter interface that mirrors schedule
 * rows for due-row scanning. Store packages (Postgres, SQLite) implement
 * it as a small table keyed by `(cell, key)`. The tick handler in
 * `@flow-state-dev/vercel/schedules` calls `claimDue` once per cron beat
 * to atomically read + advance due rows, then POSTs them to the
 * scheduled-actions dispatch endpoint.
 *
 * The collection of schedule resources stays the source of truth. The
 * index is a derived read-model populated by `defineScheduleCollection`
 * via the `onInstanceCreated/Updated/Deleted` hooks on
 * `defineResourceCollection`.
 *
 * Contract: at-most-once. `claimDue` advances rows before returning
 * them; a dispatch that fails after the row has been advanced is dropped
 * (logged via `onDispatch`) — at-most-once is the explicit framework
 * contract for scheduled actions.
 */

/**
 * A single row in the schedule index. `key` is the collection-relative
 * key (no leading collection prefix). `nextFireAt` is the next fire
 * time in milliseconds since epoch.
 *
 * A row is identified by `(cell, key)` — the same address as the schedule
 * it mirrors — so one schedule is always exactly one row. `userId` is who
 * the schedule runs as, and is data, not identity: one person holds several
 * rows with one key when they have schedules in several storage cells (a
 * hired seat per organization, and their own app-wide cell).
 */
export interface ScheduleIndexRow {
  /**
   * The storage cell the schedule is persisted in. With `key`, the row's
   * identity. Filled by `defineScheduleCollection` from the engine's own
   * derivation (`CollectionHookContext.cell`). Opaque: store and compare it,
   * never parse it.
   */
  cell: string;
  /** Who the schedule runs as. */
  userId: string;
  /**
   * The organization this schedule fires into (FIX-1442).
   *
   * The TARGET's organization, captured from the execution that created the
   * row — not the organization of whichever scheduler gateway later fires it,
   * and not whatever organization the target user happens to be acting as at
   * fire time. A schedule is a standing instruction from one organization, so
   * that is the binding it keeps.
   *
   * Optional on the type only because a row written before this existed has
   * none. Such a row is quarantined rather than dispatched — see
   * `createResourceCollectionScheduleResolver`.
   */
  orgId?: string;
  key: string;
  cron: string;
  timezone?: string;
  nextFireAt: number;
}

/**
 * Schedule index adapter. Implementations live in store packages
 * (e.g. `createPostgresScheduleIndex`, `createSQLiteScheduleIndex`).
 *
 * All methods are async-shaped to allow remote implementations even
 * when a particular backend is synchronous (e.g. better-sqlite3).
 */
export interface ScheduleIndex {
  /**
   * Insert or update a schedule row. Idempotent on primary key
   * `(cell, key)`. The caller passes the freshly-computed
   * `nextFireAt` — implementations do not parse cron themselves.
   */
  upsert(row: ScheduleIndexRow): Promise<void>;

  /**
   * Atomically claim all rows whose `nextFireAt <= now` AND advance
   * them to the next fire time (using `cron-parser`) in a single
   * transaction. Returns the rows that were claimed, carrying the
   * pre-advance `nextFireAt` so the caller can log/observe what
   * fired.
   *
   * Rows whose cron expressions fail to parse are skipped (the row
   * is left at its current `nextFireAt`, a warning is logged) so a
   * single bad row does not block the rest of the batch.
   *
   * `limit` defaults to 100.
   */
  claimDue(now: number, limit?: number): Promise<ScheduleIndexRow[]>;

  /**
   * Remove the row for `(cell, key)`. No-op when the row does not exist.
   * Never touches another cell's row with the same key.
   */
  remove(id: { cell: string; key: string }): Promise<void>;
}
