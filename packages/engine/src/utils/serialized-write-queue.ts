/**
 * A general-purpose utility for serialized async writes.
 *
 * Backends without native concurrency control (filesystem, in-memory with async I/O)
 * use this internally. Backends with native concurrency control (Postgres, Redis)
 * do not need it.
 */

export interface SerializedWriteQueue {
  /**
   * Enqueue a write operation. Returns immediately (non-blocking).
   * The operation will execute after all previously enqueued operations complete.
   */
  enqueue(fn: () => Promise<void>): void;

  /**
   * Wait for all currently enqueued operations to complete.
   * Does NOT prevent new operations from being enqueued during drain.
   */
  drain(): Promise<void>;

  /**
   * Number of operations currently queued (including the one in-flight).
   */
  readonly pending: number;

  /**
   * Whether an operation is currently executing.
   */
  readonly active: boolean;
}

export type SerializedWriteQueueOptions = {
  /**
   * Called when an enqueued operation throws. The error is logged
   * but does NOT propagate — subsequent operations continue executing.
   * Default: console.error
   */
  onError?: (error: Error, context?: string) => void;
  /**
   * Optional label for logging/debugging.
   */
  label?: string;
};

export function createSerializedWriteQueue(
  options?: SerializedWriteQueueOptions
): SerializedWriteQueue {
  const onError = options?.onError ?? ((err: Error) => console.error(err));
  const label = options?.label;

  const queue: Array<() => Promise<void>> = [];
  let processing = false;
  let drainResolvers: Array<() => void> = [];

  function notifyDrainWaiters(): void {
    if (queue.length === 0 && !processing) {
      const resolvers = drainResolvers;
      drainResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  async function processQueue(): Promise<void> {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const fn = queue.shift()!;
      try {
        await fn();
      } catch (err) {
        onError(
          err instanceof Error ? err : new Error(String(err)),
          label
        );
      }
    }

    processing = false;
    notifyDrainWaiters();
  }

  return {
    enqueue(fn: () => Promise<void>): void {
      queue.push(fn);
      void processQueue();
    },

    drain(): Promise<void> {
      if (queue.length === 0 && !processing) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        drainResolvers.push(resolve);
      });
    },

    get pending(): number {
      return queue.length + (processing ? 1 : 0);
    },

    get active(): boolean {
      return processing;
    }
  };
}
