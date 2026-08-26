/**
 * The custom-store shapes the advisory write-back seam is written against
 * (FIX-964).
 *
 * Each wraps a real, conforming backing and breaks exactly one thing, so a test
 * that goes green here has exercised the substrate's own write path rather than
 * a mock's idea of it. They live in one module because the seam is tested at two
 * altitudes — the seam directly, and `dispatchAndExecuteBlock` around it — and a
 * fixture that encodes the defect has to mean the same thing in both.
 */
import type { TaskCollectionRef } from "../../src/tasks";

/**
 * A store that takes `(id, output)` and so never sees the options object —
 * the documented `taskBoard({ collection })` extension point implemented the
 * way the interface reads, before FIX-951's prose around it.
 *
 * Written as a delegating wrapper rather than a from-scratch fake on purpose:
 * everything about it except the dropped argument is a real, conforming
 * backing.
 */
export function dropsTheGuards(inner: TaskCollectionRef): TaskCollectionRef {
  return {
    ...inner,
    complete: (id, output) => inner.complete(id, output),
    fail: (id, error) => inner.fail(id, error),
  };
}

/** A store that is simply down. Nothing to do with the guards. */
export function unreachable(inner: TaskCollectionRef, message: string): TaskCollectionRef {
  return {
    ...inner,
    complete: () => Promise.reject(new Error(message)),
    fail: () => Promise.reject(new Error(message)),
  };
}

/**
 * A store whose write COMMITS and then throws on the way out — the shape both
 * built-in backings already have, where `emit` runs after the commit and
 * outside the write's `try`, so a failing `onChange` rejects `complete()` with
 * the task already durably terminal.
 *
 * This is FIX-963's case, not this seam's, and telling it apart from "someone
 * else had already settled it" is the whole reason the snapshot is taken before
 * the write instead of inferred after it.
 */
export function commitsThenThrows(inner: TaskCollectionRef, message: string): TaskCollectionRef {
  return {
    ...inner,
    complete: async (id, output, options) => {
      await inner.complete(id, output, options);
      throw new Error(message);
    },
  };
}
