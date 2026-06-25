/**
 * A keyed async gate — the per-string-key serializer the codebase otherwise
 * lacks. `withScopeLock` keys on object identity and `createSerializedWriteQueue`
 * is un-keyed and error-swallowing; neither fits a gate that must arbitrate
 * competing requests by a derived string key (a session id) and surface
 * reject / timeout outcomes to the caller.
 *
 * It backs the concurrency arbiter (FIX-837): `tryAcquire` is the atomic,
 * synchronous admission used by the `reject` policy, and `runExclusive` is the
 * FIFO serializer used by the `queue` policy. Distinct keys never contend;
 * each key behaves like an independent async mutex with a fair wait queue.
 *
 * Memory: an entry is created on first contention for a key and deleted the
 * moment the key goes fully idle (no holder, no waiters), so the map tracks
 * only currently-active keys. Every acquisition path releases through a
 * `finally`/lease, so an errored run frees its key just like a successful one.
 */

import { ConcurrencyQueueTimeoutError } from "../transports/errors";

/**
 * Opaque release handle returned by `tryAcquire`. Calling it releases the key
 * (and hands off to the next FIFO waiter, if any). Idempotent — a second call
 * is a no-op, so releasing twice cannot free a slot the key was re-acquired
 * for.
 */
export type GateLease = () => void;

export interface KeyedAsyncGate {
  /**
   * Atomic, synchronous admission. If the key is free, mark it held and return
   * a release lease; if a holder (or a queued waiter waiting to run) already
   * owns it, return `null`. Because the whole check-and-set is synchronous, two
   * concurrent callers can never both win. Used by the `reject` policy.
   */
  tryAcquire(key: string): GateLease | null;
  /**
   * Run `fn` exclusively for `key`, FIFO across concurrent callers. Resolves or
   * rejects with `fn`'s result. `waitTimeoutMs` bounds the wait for the key to
   * free up: if the slot isn't reached in time the call rejects with
   * `ConcurrencyQueueTimeoutError` and never runs `fn`. Used by the `queue`
   * policy.
   */
  runExclusive<T>(key: string, fn: () => Promise<T>, opts?: { waitTimeoutMs?: number }): Promise<T>;
  /** Number of keys currently tracked. Idle keys are pruned, so this reflects
   *  live contention — primarily for tests and diagnostics. */
  size(): number;
}

interface GateEntry {
  /** Whether the key is currently held by a holder. */
  locked: boolean;
  /** FIFO queue of waiters parked until the key frees up. */
  waiters: Array<() => void>;
  /**
   * Outstanding references (holder + waiters). The entry is deleted when this
   * reaches 0, so the map never retains idle keys.
   */
  refs: number;
}

export function createKeyedAsyncGate(): KeyedAsyncGate {
  const entries = new Map<string, GateEntry>();

  function ensure(key: string): GateEntry {
    let entry = entries.get(key);
    if (entry === undefined) {
      entry = { locked: false, waiters: [], refs: 0 };
      entries.set(key, entry);
    }
    return entry;
  }

  /** Drop an entry once it has no holder, no waiters, and no references. */
  function maybeDelete(key: string, entry: GateEntry): void {
    if (!entry.locked && entry.waiters.length === 0 && entry.refs === 0) {
      entries.delete(key);
    }
  }

  /**
   * Release the key. Hands the lock directly to the next FIFO waiter (keeping
   * `locked` true so a racing `tryAcquire` cannot steal the slot), or frees and
   * prunes the key when no one is waiting.
   */
  function release(key: string): void {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entry.refs -= 1;
    const next = entry.waiters.shift();
    if (next !== undefined) {
      // Hand off without ever unlocking: the woken waiter becomes the holder.
      next();
      return;
    }
    entry.locked = false;
    maybeDelete(key, entry);
  }

  return {
    tryAcquire(key: string): GateLease | null {
      const entry = entries.get(key);
      if (entry !== undefined && entry.locked) return null;
      const target = entry ?? ensure(key);
      target.locked = true;
      target.refs += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release(key);
      };
    },

    runExclusive<T>(
      key: string,
      fn: () => Promise<T>,
      opts?: { waitTimeoutMs?: number }
    ): Promise<T> {
      const entry = ensure(key);
      entry.refs += 1;

      const acquire = new Promise<void>((resolve, reject) => {
        const grant = (): void => {
          entry.locked = true;
          resolve();
        };

        if (!entry.locked) {
          // Free right now: take it synchronously.
          grant();
          return;
        }

        // Park behind any earlier waiters (FIFO).
        const waitTimeoutMs = opts?.waitTimeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onGranted = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          grant();
        };
        entry.waiters.push(onGranted);

        if (
          waitTimeoutMs !== undefined &&
          waitTimeoutMs !== Infinity &&
          waitTimeoutMs > 0
        ) {
          timer = setTimeout(() => {
            const idx = entry.waiters.indexOf(onGranted);
            if (idx !== -1) entry.waiters.splice(idx, 1);
            entry.refs -= 1;
            maybeDelete(key, entry);
            reject(new ConcurrencyQueueTimeoutError(key, waitTimeoutMs));
          }, waitTimeoutMs);
          // Don't keep the event loop alive solely for a queued wait.
          (timer as { unref?: () => void }).unref?.();
        }
      });

      return acquire.then(async () => {
        try {
          return await fn();
        } finally {
          release(key);
        }
      });
    },

    size(): number {
      return entries.size;
    }
  };
}
