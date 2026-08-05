/**
 * CAS retry driver for resource state.
 *
 * This is the resource-state twin of `runWithCAS` (`./cas.ts`) and deliberately
 * **not** a caller of it. The two drive the same load → mutate → persist shape,
 * but resource state has three semantics scope state does not — deletion,
 * create-if-absent, and cancellation — and `runWithCAS`'s decisions about all
 * three are wrong here. Each divergence below names the failure the shared
 * driver would produce, so the next reader can see why there are two drivers
 * rather than one with flags:
 *
 * | Case | Here | `runWithCAS` would |
 * |---|---|---|
 * | Conflict, live row at a newer version | Refresh, re-run the mutator, retry with backoff | same — the one row that transfers |
 * | Conflict, **no live row**, and we held a live version | **Terminal** {@link ResourceDeletedError} | Falls back to the container's stale cached state (`cas.ts:158-159`) and retries; the tombstone's version matches, so the write lands — **resurrecting a deleted resource** |
 * | No live row and we never held one (`version === 0`) | **Not an error** — a verified no-op. The key was never persisted, and nothing was taken away | n/a — the shared driver has no absent/deleted distinction to get wrong |
 * | Conflict, **create-if-absent** | **Terminal** {@link ResourceAlreadyExistsError} | Refreshes to the winner's version and retries, **overwriting the winner** |
 * | `signal` aborted | Stop before backoff **and** before persisting | No signal; `wait()` (`cas.ts:96-104`) is an unabortable timer — **persists after cancellation** |
 * | Retry budget exhausted | {@link ConcurrentModificationError} | same |
 * | Mutator output equals the cached state | Suppress **only against a re-read, verified version** | Returns `committed: false` *before* `persist` (`cas.ts:143-145`, ahead of the only version check at `:147`) — **silently drops a deliberate write** |
 * | Single-field literal patch | Stays on CAS — there is no hint surface here | `state-container.ts:155-157` routes a commutative hint to `runCommutative`, which persists at `expectedVersion: "any"` (`:189-193`) — **no version check at all** |
 *
 * The no-op and commutative rows are the subtle ones. A no-op decided against an
 * unverified snapshot *is* a lost update: a context that reads `{mode:"old"}`,
 * loses to a writer of `{mode:"new"}`, then deliberately writes `{mode:"old"}`
 * would be told "no-op" while the other value stands. So `committed: false`
 * from this driver means *verified no-op* and nothing else, which is the
 * invariant the `resource_change` notification gate rests on.
 *
 * **Absent is not deleted, and the distinction is load-bearing.** "No live row"
 * covers two situations that must not report the same thing: a row we held a
 * live version for and lost, versus a key that was never persisted at all — a
 * declared resource living so far on its schema default, being touched for the
 * first time. Collapsing them makes the most ordinary write there is throw
 * `ResourceDeletedError` about a row that never existed, which is precisely the
 * "report what didn't happen" failure this store exists to stop. The container's
 * version discriminates: `0` means this context never observed a live row.
 *
 * **Do not reach for the commutative path.** `createScopeStateOps` lives in
 * `state-container.ts` and its ops are named `patchState` / `setState` /
 * `updateState` — the same names as the registry's resource ops, one module
 * away. It is the natural thing to import and the wrong one. The same goes for
 * `createScopePersist` (`scope-persist.ts:60`), which downgrades
 * `expectedVersion` to `"any"` for commutative hints.
 */

import type { CASOptions, JsonObject, StateContainer } from "@flow-state-dev/core/types";
import { cloneValue, deepEqual } from "@flow-state-dev/core/helpers";
import {
  ConcurrentModificationError,
  ResourceAlreadyExistsError,
  ResourceDeletedError
} from "../errors/flow-error";

// Re-exported here for the same reason `cas.ts` re-exports
// `ConcurrentModificationError`: these are part of this driver's contract, and
// a caller that catches one should not have to reach into the errors module to
// name it. `stores/index.ts` and the package root re-export them onward.
export { ResourceAlreadyExistsError, ResourceDeletedError };
import type { ExpectedVersion, SetResult, VersionedResourceState } from "./types";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 10;

/**
 * What the caller is trying to do, which decides the expected version and how
 * a conflict is classified.
 *
 * - `mutate` — read-modify-write. Writes at the version the container holds; a
 *   conflict against a live row retries, against a tombstone is terminal.
 * - `create` — create-if-absent. Writes at `0` ("no live row"); any conflict is
 *   terminal, because the loser must not overwrite the winner.
 * - `replace` — deliberate unconditional overwrite (`create({ replace: true })`).
 *   Writes at `"any"`, so it cannot conflict.
 */
export type ResourceCASIntent = "mutate" | "create" | "replace";

/**
 * Single-attempt persist bridge into the store. Returns the store's
 * `SetResult` unchanged — no retry, no interpretation. The driver owns both.
 */
export type ResourceCASPersist = (
  next: JsonObject,
  expectedVersion: ExpectedVersion
) => Promise<SetResult<JsonObject>>;

/** Re-read the key's live row, used to verify a deep-equal no-op. */
export type ResourceCASReread = () => Promise<VersionedResourceState | undefined>;

export type RunResourceCASOptions = {
  /** Resource storage key. Carried for error identity only. */
  key: string;
  /** Per-key cache of the state and version this context last observed. */
  container: StateContainer<JsonObject>;
  /**
   * The op's REAL mutator, re-run against refreshed state on every retry.
   *
   * This is why the driver sits at the registry's read/mutate seam rather than
   * at the persister: by the time a value reaches the store the caller's intent
   * is gone, so a retry there could only re-write a stale materialized object
   * and would clobber a concurrent writer's field.
   */
  mutator: (current: JsonObject) => JsonObject | Promise<JsonObject>;
  persist: ResourceCASPersist;
  reread: ResourceCASReread;
  intent: ResourceCASIntent;
  /** Cancellation. Checked before persisting and before any backoff wait. */
  signal?: AbortSignal;
  options?: CASOptions;
};

export type ResourceCASResult = {
  state: JsonObject;
  /**
   * The state the returned outcome was computed against — the basis of the
   * attempt that actually committed, not the caller's pre-race snapshot.
   *
   * These differ exactly when a retry happened: attempt 1 runs against what the
   * caller had cached, and after a conflict the driver refreshes and re-runs
   * the mutator against the winner's state. The value that lands is therefore
   * built on the winner's, and reporting the caller's original snapshot as the
   * "previous state" describes a transition that never occurred — a hook
   * diffing prev against next would see the winner's fields appear as though
   * this mutation made them.
   */
  previousState: JsonObject;
  /**
   * `true` when a write actually landed. `false` means a **verified** no-op —
   * the mutator's output equalled the stored value at a version this driver
   * re-read and confirmed. Never means "we didn't check".
   */
  committed: boolean;
  /** The version now stored for this key. */
  version: number;
};

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Resource write aborted");
  }
}

/**
 * Backoff that loses to cancellation.
 *
 * What this buys, stated precisely, because it is narrower than it looks: the
 * loop-top abort check is what stops a cancelled action from *persisting*, and
 * it would do that even behind an unabortable timer. This function is why a
 * cancelled action stops **promptly** instead of holding the request open for
 * the rest of a backoff it already knows is pointless. `runWithCAS`'s `wait()`
 * (`cas.ts:96-104`) has no signal, so it always sleeps the full delay first.
 */
function abortableWait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Resource write aborted")
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Drive one version-checked resource write to completion.
 *
 * @throws {ResourceDeletedError} a `mutate` lost to a concurrent delete (terminal)
 * @throws {ResourceAlreadyExistsError} a `create` lost its race (terminal)
 * @throws {ConcurrentModificationError} the retry budget was exhausted
 */
export async function runResourceCAS({
  key,
  container,
  mutator,
  persist,
  reread,
  intent,
  signal,
  options
}: RunResourceCASOptions): Promise<ResourceCASResult> {
  const maxRetries = Math.max(0, options?.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelayMs = Math.max(0, options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);

  let attempt = 0;
  while (attempt <= maxRetries) {
    throwIfAborted(signal);

    // Hand the mutator a CLONE, never the container's internal reference.
    // `MemoryStateContainer.read()` returns `this.state` directly
    // (`state-container.ts:61-70`) and the registry passes what it reads into a
    // user-supplied updater — so without this an in-place mutation would edit
    // the very object the deep-equal check below compares against, making the
    // check trivially true and suppressing the write.
    // The pre-mutation state for THIS attempt. `commit` replaces the
    // container's reference rather than mutating it, and the mutator only ever
    // sees the clone below, so this stays a faithful snapshot of the basis.
    const basis = container.read() as JsonObject;
    const current = cloneValue(container.read()) as JsonObject;
    const expectedVersion: ExpectedVersion =
      intent === "create" ? 0 : intent === "replace" ? "any" : container.getVersion();

    const next = await mutator(current);

    // The mutator may have awaited; cancellation could have arrived while it ran.
    throwIfAborted(signal);

    // Verified no-op (and only verified). Compare against the container's own
    // untouched copy, not the clone the mutator just held.
    if (intent === "mutate" && deepEqual(container.read(), next)) {
      const fresh = await reread();
      if (fresh === undefined) {
        // No live row. That is two different situations and they must not
        // report the same thing:
        //
        //  - We held a live version and it is gone → our write lost to a
        //    delete, and saying so is accurate.
        //  - We never held one (`version === 0`) → the key was never
        //    persisted. A declared resource that exists only through its
        //    schema default is here on its first touch, and the mutator asked
        //    for no change. Store and cache agree there is no live row, so
        //    nothing is written and nothing was taken away. Calling that a
        //    deletion reports an event that never happened, to a caller doing
        //    the most ordinary thing there is.
        if (container.getVersion() === 0) {
          return {
            state: container.read() as JsonObject,
            previousState: basis,
            committed: false,
            version: 0
          };
        }
        throw new ResourceDeletedError(key);
      }
      if (fresh.version === container.getVersion()) {
        // Genuinely nothing to do: the value we hold IS the stored value, at a
        // version we just confirmed.
        return {
          state: container.read() as JsonObject,
          previousState: basis,
          committed: false,
          version: fresh.version
        };
      }
      // Somebody moved the key. Our "equal" was equal to a stale cache, so this
      // is a conflict — refresh and let the mutator run again against the truth.
      container.commit(fresh.state, fresh.version);
      attempt += 1;
      if (attempt > maxRetries) break;
      await abortableWait(baseDelayMs * Math.pow(2, attempt - 1), signal);
      continue;
    }

    const result = await persist(next, expectedVersion);

    if (result.ok) {
      return {
        state: container.commit(next, result.version) as JsonObject,
        previousState: basis,
        committed: true,
        version: result.version
      };
    }

    // --- Conflict policy: the reason this driver exists. ---

    if (intent === "create") {
      // Terminal. Retrying would overwrite whoever won. The winner's row rides
      // along on the error so the first-touch APIs can turn this into a "get"
      // without a second read.
      throw new ResourceAlreadyExistsError(key, {
        value: result.conflict.currentValue,
        version: result.conflict.currentVersion
      });
    }

    if (result.conflict.currentValue === undefined) {
      // No live row, and reaching here means we asked for a positive version:
      // `expectedVersion: 0` is satisfied by the absence of one, so it could
      // not have conflicted this way. So the row we held really was deleted.
      // Terminal — and specifically NOT `runWithCAS`'s
      // `result.currentState ?? container.read()`, which would re-run the
      // mutator over a pre-delete snapshot and write it back over a tombstone
      // whose version now matches.
      throw new ResourceDeletedError(key);
    }

    container.commit(result.conflict.currentValue, result.conflict.currentVersion);

    attempt += 1;
    if (attempt > maxRetries) break;

    await abortableWait(baseDelayMs * Math.pow(2, attempt - 1), signal);
  }

  throw new ConcurrentModificationError(
    `Resource "${key}" update failed due to concurrent modifications`,
    maxRetries + 1
  );
}
