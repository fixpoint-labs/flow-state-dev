/**
 * Bounded async queue used by `RequestStore.subscribeToEvents`
 * implementations. Producers `push` non-blocking and learn synchronously
 * whether the queue is full; consumers `shift` await the next item.
 * Closing the queue resolves any waiting consumer with `undefined`.
 *
 * Purpose-built for the subscription contract — the "overflow" return
 * value lets the caller convert a full queue into the documented
 * `StoreSubscriptionError("backpressure_overflow")` failure.
 */
export type BoundedQueuePushResult = "ok" | "overflow";

export class BoundedQueue<T> {
  private readonly buffer: T[] = [];
  private readonly capacity: number;
  private waiter: ((value: T | undefined) => void) | undefined;
  private closed = false;

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`BoundedQueue capacity must be a positive integer (got ${capacity})`);
    }
    this.capacity = capacity;
  }

  /** Push an item. Returns "overflow" when the queue is full or closed. */
  push(item: T): BoundedQueuePushResult {
    if (this.closed) return "overflow";
    if (this.waiter !== undefined) {
      const resolve = this.waiter;
      this.waiter = undefined;
      resolve(item);
      return "ok";
    }
    if (this.buffer.length >= this.capacity) {
      return "overflow";
    }
    this.buffer.push(item);
    return "ok";
  }

  /**
   * Resolve to the next available item, or `undefined` when the queue is
   * closed or the abort signal fires. The signal does not race the
   * caller's `for await` loop body — it only wakes a parked `shift`.
   */
  async shift(signal?: AbortSignal): Promise<T | undefined> {
    if (this.buffer.length > 0) {
      return this.buffer.shift();
    }
    if (this.closed) return undefined;
    if (signal?.aborted) return undefined;

    return new Promise<T | undefined>((resolve) => {
      const onAbort = () => {
        if (this.waiter === resolve) {
          this.waiter = undefined;
        }
        signal?.removeEventListener("abort", onAbort);
        resolve(undefined);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiter = (value) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
    });
  }

  /** Closes the queue and resolves any parked consumer with `undefined`. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiter = this.waiter;
    if (waiter !== undefined) {
      this.waiter = undefined;
      waiter(undefined);
    }
  }

  get size(): number {
    return this.buffer.length;
  }
}
