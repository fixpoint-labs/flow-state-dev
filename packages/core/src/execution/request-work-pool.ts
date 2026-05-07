/**
 * Request-scoped pool for background work tasks dispatched by sequencer DSL
 * (`.work()`, `.workIf()`, `.forEachBackground()`). The interface is defined in
 * core so sequencer code can push tasks; the implementation lives in
 * `@flow-state-dev/server`. The server's request executor constructs one pool
 * per request, attaches it to `BlockContext._requestWorkPool`, and drains it
 * exactly once before the SSE stream closes.
 *
 * This replaces the old per-sequencer auto-await — inner sequencers no longer
 * block their parent on their own background work. See
 * `apps/docs/docs/advanced/sequencer-side-chains.md` for the user-facing model.
 */

/**
 * Per-task metadata captured at `.work()` time. `scopeId` lets `.waitForWork()`
 * drain only the calling sequencer's tasks; `name` is preserved for
 * diagnostic logging when a pooled task fails.
 */
export interface RequestWorkTaskMeta {
  /** Human-readable task name. */
  name: string;
  /** Logical scope ID of the dispatching sequencer instance. `.waitForWork()`
   *  drains by this ID so a sequencer's explicit barrier only waits on its
   *  own queued tasks, not unrelated siblings'. */
  scopeId: string;
}

/**
 * Settled-result shape returned by `drainScope` / `drainAll`.
 */
export interface RequestWorkPoolResult {
  completed: Array<{ meta: RequestWorkTaskMeta; value: unknown }>;
  failed: Array<{ meta: RequestWorkTaskMeta; reason: unknown }>;
}

export interface RequestWorkPoolDrainOptions {
  /** Throw the first failure instead of returning a settled result. */
  failOnError?: boolean;
}

export interface RequestWorkPoolDrainAllOptions {
  /** Abort wait if signalled. In-flight tasks observe this signal via their
   *  own `ctx.signal` and either complete or short-circuit. */
  signal?: AbortSignal;
  /** Notified each time the pool's pending-task count changes during the
   *  drain — used by the request executor to emit `backgroundTasks: N`
   *  status updates. */
  onPendingChange?: (count: number) => void;
}

/**
 * Per-request background work pool. Tasks are already running when registered;
 * the pool tracks settlement and exposes scope-bounded and full drains.
 */
export interface RequestWorkPool {
  /** Register an in-flight task. The promise must already be running. */
  addTask(task: { promise: Promise<unknown>; meta: RequestWorkTaskMeta }): void;

  /** True iff at least one tracked task with the given scopeId has not settled. */
  hasPendingForScope(scopeId: string): boolean;

  /**
   * Await every task tagged with the given scopeId. Tasks are removed from the
   * pool as they settle, so calling drainScope twice on the same scopeId
   * returns an empty result the second time.
   */
  drainScope(
    scopeId: string,
    options?: RequestWorkPoolDrainOptions
  ): Promise<RequestWorkPoolResult>;

  /**
   * Await every pending task in the pool. Called once by the request executor
   * before terminal status. Skipped on abort/disconnect/error paths.
   */
  drainAll(options?: RequestWorkPoolDrainAllOptions): Promise<RequestWorkPoolResult>;

  /** Snapshot of currently pending tasks, regardless of scope. */
  pendingCount(): number;
}

/**
 * Read the per-request work pool off a `BlockContext`. Centralised so the
 * field name and the underscore-prefixed cast pattern live in one spot.
 * Returns `undefined` in unit-test contexts where no pool was constructed
 * (sequencer DSL falls back to per-sequencer auto-await in that case).
 */
export function getRequestWorkPool(
  ctx: { _requestWorkPool?: RequestWorkPool } | object
): RequestWorkPool | undefined {
  return (ctx as { _requestWorkPool?: RequestWorkPool })._requestWorkPool;
}
