/**
 * Per-request side-chain pool implementation. Sequencer DSL pushes
 * `.sideChain()` / `.sideChainIf()` / `.forEachSideChain()` tasks here; the request
 * executor in `runAction.ts` drains the pool to quiescence before terminal
 * status, on every terminal path.
 *
 * The interface lives in `@flow-state-dev/core` so sequencer code can push
 * without a `core → server` dependency violation; the implementation lives
 * here.
 */
import type {
  RequestSideChainPool,
  RequestSideChainPoolDrainAllOptions,
  RequestSideChainPoolDrainOptions,
  RequestSideChainPoolDrainToQuiescenceOptions,
  RequestSideChainPoolResult,
  RequestSideChainTaskMeta
} from "@flow-state-dev/core";

interface PoolEntry {
  meta: RequestSideChainTaskMeta;
  promise: Promise<unknown>;
  /** Settles to true the moment the underlying promise resolves or rejects. */
  settled: boolean;
}

class RequestSideChainPoolImpl implements RequestSideChainPool {
  private readonly entries: PoolEntry[] = [];
  /** Every failure a drain returned, kept across drains (see `failures`). */
  private readonly kept: RequestSideChainPoolResult["failed"] = [];
  /**
   * Scope drains still awaiting their entries. A scope drain takes its
   * entries out of the pool first, so a caller that stops waiting (a
   * `.waitForSideChain({ timeoutMs })` that timed out) would leave them
   * where no other drain sees them; `drainToQuiescence` waits for these too.
   */
  private readonly scopeDrains = new Set<Promise<RequestSideChainPoolResult>>();
  private pending = 0;
  /** Listener installed by an active `drainAll` for status emission. */
  private drainListener: ((count: number) => void) | undefined;

  addTask(task: { promise: Promise<unknown>; meta: RequestSideChainTaskMeta }): void {
    const entry: PoolEntry = {
      meta: task.meta,
      promise: task.promise,
      settled: false
    };
    this.entries.push(entry);
    this.pending += 1;
    this.notifyDrainListener();

    // Track settlement for pendingCount accounting. Both branches mark the
    // entry settled and decrement; the original promise's actual resolution
    // is awaited separately by drainScope/drainAll, which report the real
    // outcome.
    const onSettle = (): void => {
      if (entry.settled) return;
      entry.settled = true;
      this.pending -= 1;
      this.notifyDrainListener();
    };
    task.promise.then(onSettle, onSettle);
  }

  hasPendingForScope(scopeId: string): boolean {
    for (const entry of this.entries) {
      if (!entry.settled && entry.meta.scopeId === scopeId) return true;
    }
    return false;
  }

  async drainScope(
    scopeId: string,
    options?: RequestSideChainPoolDrainOptions
  ): Promise<RequestSideChainPoolResult> {
    const matching: PoolEntry[] = [];
    // Keep entries with other scope IDs; remove the matching ones from the
    // pool so a subsequent drainAll does not re-await them.
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i]!;
      if (entry.meta.scopeId === scopeId) {
        matching.push(entry);
        this.entries.splice(i, 1);
      }
    }

    if (matching.length === 0) {
      return { completed: [], failed: [] };
    }

    // The keep runs as the entries settle, whether or not the caller still
    // waits. A caller that gave up can no longer throw or log what failed, so
    // then the pool keeps and logs it, `failOnError` or not.
    const drain: Promise<RequestSideChainPoolResult> = this.awaitEntries(matching).then((settled) => {
      this.scopeDrains.delete(drain);
      const abandoned = options?.abandoned?.aborted === true;
      if (options?.failOnError !== true || abandoned) this.kept.push(...settled.failed);
      if (abandoned) {
        for (const f of settled.failed) {
          // eslint-disable-next-line no-console
          console.error(
            `[runAction] Background work "${f.meta.name}" failed:`,
            (f.reason as { message?: string } | undefined)?.message ?? f.reason
          );
        }
      }
      return settled;
    });
    this.scopeDrains.add(drain);
    const result = await drain;
    if (options?.failOnError === true && result.failed.length > 0) {
      const reason = result.failed[0]!.reason;
      throw reason instanceof Error ? reason : new Error(String(reason));
    }
    return result;
  }

  async drainAll(options?: RequestSideChainPoolDrainAllOptions): Promise<RequestSideChainPoolResult> {
    if (this.entries.length === 0) {
      return { completed: [], failed: [] };
    }

    this.drainListener = options?.onPendingChange;
    // Fire one snapshot up front so consumers see the starting count.
    this.notifyDrainListener();

    try {
      const matching = this.entries.splice(0, this.entries.length);
      const result = await this.awaitEntries(matching, options?.signal);
      this.kept.push(...result.failed);
      return result;
    } finally {
      this.drainListener = undefined;
    }
  }

  async drainToQuiescence(
    options?: RequestSideChainPoolDrainToQuiescenceOptions
  ): Promise<RequestSideChainPoolResult> {
    const completed: RequestSideChainPoolResult["completed"] = [];
    const failed: RequestSideChainPoolResult["failed"] = [];

    // Unconditional first pass, then repeat until one consumes nothing.
    // `drainAll` returns an empty result the moment `entries` is empty, so
    // that is both the termination condition and a cheap no-op for a request
    // that never queued anything.
    // A pass that consumes nothing ends it only once no scope drain is still
    // awaiting entries it took out of the pool.
    for (;;) {
      const pass = await this.drainAll({ onPendingChange: options?.onPendingChange });
      if (pass.completed.length + pass.failed.length === 0) {
        if (this.scopeDrains.size === 0) return { completed, failed };
        await Promise.all([...this.scopeDrains]);
        continue;
      }
      completed.push(...pass.completed);
      failed.push(...pass.failed);
    }
  }

  pendingCount(): number {
    return this.pending;
  }

  failures(): ReadonlyArray<RequestSideChainPoolResult["failed"][number]> {
    return [...this.kept];
  }

  private notifyDrainListener(): void {
    const listener = this.drainListener;
    if (listener === undefined) return;
    try {
      listener(this.pending);
    } catch {
      // Listener errors must never affect task settlement.
    }
  }

  private async awaitEntries(
    entries: PoolEntry[],
    signal?: AbortSignal
  ): Promise<RequestSideChainPoolResult> {
    const settle = entries.map((entry) =>
      entry.promise.then(
        (value) => ({ status: "fulfilled" as const, meta: entry.meta, value }),
        (reason: unknown) => ({ status: "rejected" as const, meta: entry.meta, reason })
      )
    );

    let settled: Array<
      | { status: "fulfilled"; meta: RequestSideChainTaskMeta; value: unknown }
      | { status: "rejected"; meta: RequestSideChainTaskMeta; reason: unknown }
    >;

    if (signal === undefined) {
      settled = await Promise.all(settle);
    } else if (signal.aborted) {
      settled = entries.map((entry) => ({
        status: "rejected" as const,
        meta: entry.meta,
        reason: signal.reason ?? new Error("side-chain pool drain aborted")
      }));
    } else {
      settled = await new Promise((resolve) => {
        const onAbort = (): void => {
          // Stop waiting; in-flight tasks see the same signal via ctx.signal.
          resolve(
            entries.map((entry) => ({
              status: "rejected" as const,
              meta: entry.meta,
              reason: signal.reason ?? new Error("side-chain pool drain aborted")
            }))
          );
        };
        signal.addEventListener("abort", onAbort, { once: true });
        Promise.all(settle).then(
          (v) => {
            signal.removeEventListener("abort", onAbort);
            resolve(v);
          },
          () => {
            // settle entries swallow rejections per-task; this branch is unreachable.
            signal.removeEventListener("abort", onAbort);
            resolve([]);
          }
        );
      });
    }

    const completed: RequestSideChainPoolResult["completed"] = [];
    const failed: RequestSideChainPoolResult["failed"] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") completed.push({ meta: r.meta, value: r.value });
      else failed.push({ meta: r.meta, reason: r.reason });
    }

    return { completed, failed };
  }
}

/**
 * Construct a fresh per-request side-chain pool.
 */
export function createRequestSideChainPool(): RequestSideChainPool {
  return new RequestSideChainPoolImpl();
}
