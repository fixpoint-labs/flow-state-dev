/**
 * Policy tests for the resource CAS driver — one per row of the driver-policy
 * table, plus the two rows that say what it must NOT inherit.
 *
 * Every case here is a divergence from `runWithCAS`. That matters for how they
 * are written: a driver that simply called the shared one would pass a
 * happy-path CAS suite completely, so each test is built around the specific
 * interleaving where the shared policy produces the wrong answer — a delete
 * between read and write, a create that loses, a cancellation mid-backoff, a
 * deep-equal write against a cache somebody else has moved.
 */
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@flow-state-dev/core/types";
import { runResourceCAS } from "../../src/stores/resource-cas";
import { createStateContainer } from "../../src/stores/state-container";
import {
  ConcurrentModificationError,
  ResourceAlreadyExistsError,
  ResourceDeletedError
} from "../../src/errors/flow-error";
import type { ExpectedVersion, SetResult } from "../../src/stores/types";
import {
  checkWriteVersion,
  type ResourceStateRow
} from "../../src/stores/resource-state-predicate";

/** Project the local row shape onto the store's, for the shared predicate. */
function asRow(
  row: { state: JsonObject; version: number; deleted: boolean } | undefined
): ResourceStateRow | undefined {
  return row === undefined
    ? undefined
    : { state: row.state, version: row.version, lifecycle: row.deleted ? "deleted" : "live" };
}

/**
 * A single versioned key with the store semantics sub-PR a defined: reads see
 * live rows only, a delete retains the version and drops the payload, and
 * `expectedVersion: 0` means "no live row".
 */
function makeKey(initial?: { state: JsonObject; version: number }) {
  let row: { state: JsonObject; version: number; deleted: boolean } | undefined =
    initial === undefined
      ? undefined
      : { state: initial.state, version: initial.version, deleted: false };

  return {
    /** Another writer commits a value, bumping the version. */
    writeBehindOurBack(state: JsonObject): void {
      row = { state, version: (row?.version ?? 0) + 1, deleted: false };
    },
    /** Another writer deletes it: tombstone, version retained, payload dropped. */
    deleteBehindOurBack(): void {
      if (row !== undefined) row = { ...row, state: {}, deleted: true };
    },
    snapshot: () => (row === undefined || row.deleted ? undefined : { ...row.state }),
    version: () => row?.version ?? 0,
    persist: async (
      next: JsonObject,
      expectedVersion: ExpectedVersion
    ): Promise<SetResult<JsonObject>> => {
      // The REAL store predicate, not a re-implementation of it. A fake that
      // encoded conflict semantics slightly differently could not detect a
      // divergence from the adapters — which is the whole thing these tests
      // are meant to be able to see.
      const conflict = checkWriteVersion(asRow(row), expectedVersion);
      if (conflict !== undefined) return conflict;
      row = { state: next, version: (row?.version ?? 0) + 1, deleted: false };
      return { ok: true, version: row.version };
    },
    reread: async () =>
      row === undefined || row.deleted
        ? undefined
        : { state: { ...row.state }, version: row.version }
  };
}

const noRetries = { maxRetries: 0, baseDelayMs: 0 };
const fastRetries = { maxRetries: 3, baseDelayMs: 0 };

describe("resource CAS driver — conflict policy", () => {
  it("retries and merges when the conflict is a live row at a newer version", async () => {
    const key = makeKey({ state: { a: 1 }, version: 1 });
    const container = createStateContainer<JsonObject>({ a: 1 }, 1);
    let attempts = 0;

    const result = await runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: (current) => {
        attempts += 1;
        // First pass runs against our stale view; a competing writer lands
        // between the read and the persist, so the retry must re-run against
        // the winner's state rather than re-apply the first merge.
        if (attempts === 1) key.writeBehindOurBack({ a: 1, theirs: true });
        return { ...current, ours: true };
      }
    });

    expect(attempts).toBe(2);
    expect(result.committed).toBe(true);
    // Both writers' fields survive — the merge the whole issue is about.
    expect(key.snapshot()).toEqual({ a: 1, theirs: true, ours: true });
  });

  it("is terminal when the row was deleted — never resurrects it", async () => {
    const key = makeKey({ state: { a: 1 }, version: 1 });
    const container = createStateContainer<JsonObject>({ a: 1 }, 1);
    let attempts = 0;

    await expect(
      runResourceCAS({
        key: "spine",
        container,
        intent: "mutate",
        options: fastRetries,
        persist: key.persist,
        reread: key.reread,
        mutator: (current) => {
          attempts += 1;
          if (attempts === 1) key.deleteBehindOurBack();
          return { ...current, ours: true };
        }
      })
    ).rejects.toBeInstanceOf(ResourceDeletedError);

    // The shared driver falls back to the container's cached state on a
    // conflict with no current value and retries; the tombstone's version then
    // matches and the write lands, bringing the resource back from a pre-delete
    // snapshot. Assert on the store, because that resurrection is invisible in
    // the return value.
    expect(key.snapshot()).toBeUndefined();
    expect(attempts).toBe(1);
  });

  it("is terminal when a create loses its race, against a DIFFERENT winning state", async () => {
    const key = makeKey();
    const container = createStateContainer<JsonObject>({}, 0);
    key.writeBehindOurBack({ owner: "winner" });

    await expect(
      runResourceCAS({
        key: "tasks/t1",
        container,
        intent: "create",
        options: fastRetries,
        persist: key.persist,
        reread: key.reread,
        mutator: () => ({ owner: "loser" })
      })
    ).rejects.toBeInstanceOf(ResourceAlreadyExistsError);

    expect(key.snapshot()).toEqual({ owner: "winner" });
  });

  it("carries the winner's row on the already-exists refusal", async () => {
    // The first-touch APIs (`getOrCreate`, `upsert`) turn a lost create into a
    // read of the winner. They can only do that without a second round trip if
    // the refusal carries what the store already reported on the conflict.
    const key = makeKey();
    const container = createStateContainer<JsonObject>({}, 0);
    key.writeBehindOurBack({ owner: "winner" });

    const err = await runResourceCAS({
      key: "tasks/t1",
      container,
      intent: "create",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: () => ({ owner: "loser" })
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ResourceAlreadyExistsError);
    expect((err as ResourceAlreadyExistsError).currentValue).toEqual({ owner: "winner" });
    expect((err as ResourceAlreadyExistsError).currentVersion).toBe(1);
  });

  it("is terminal when a create loses its race, against an IDENTICAL winning state", async () => {
    // The identical-state variant is the one a shared driver fails differently:
    // it refreshes to the winner's version, finds the mutator's output equal,
    // and reports a silent no-op — so the loser believes it created the item.
    const key = makeKey();
    const container = createStateContainer<JsonObject>({}, 0);
    key.writeBehindOurBack({ shape: "same" });

    await expect(
      runResourceCAS({
        key: "tasks/t1",
        container,
        intent: "create",
        options: fastRetries,
        persist: key.persist,
        reread: key.reread,
        mutator: () => ({ shape: "same" })
      })
    ).rejects.toBeInstanceOf(ResourceAlreadyExistsError);
  });

  it("throws ConcurrentModificationError when the retry budget is exhausted", async () => {
    const key = makeKey({ state: { n: 0 }, version: 1 });
    const container = createStateContainer<JsonObject>({ n: 0 }, 1);

    await expect(
      runResourceCAS({
        key: "spine",
        container,
        intent: "mutate",
        options: { maxRetries: 2, baseDelayMs: 0 },
        persist: key.persist,
        reread: key.reread,
        // A writer lands before every one of our attempts.
        mutator: (current) => {
          key.writeBehindOurBack({ ...current, bumped: key.version() });
          return { ...current, ours: true };
        }
      })
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });
});

describe("resource CAS driver — cancellation", () => {
  it("does not persist after the signal aborts mid-retry", async () => {
    const key = makeKey({ state: { a: 1 }, version: 1 });
    const container = createStateContainer<JsonObject>({ a: 1 }, 1);
    const controller = new AbortController();
    const persist = vi.fn(key.persist);

    // A competing write lands before we start, so our first attempt conflicts
    // and the driver enters its backoff.
    key.writeBehindOurBack({ a: 2 });

    const running = runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      signal: controller.signal,
      // A real backoff delay, so the abort has to interrupt the wait rather
      // than merely be observed after it. `runWithCAS`'s `wait()` is an
      // unabortable timer that resolves regardless, and the attempt after it
      // would persist.
      options: { maxRetries: 3, baseDelayMs: 200 },
      persist,
      reread: key.reread,
      mutator: (current) => ({ ...current, ours: true })
    });

    // Cancel while the driver is parked in that 200ms backoff.
    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();

    await expect(running).rejects.toThrow();

    // One losing attempt, and nothing after the abort — asserted on the store,
    // because a write that lands after cancellation is otherwise invisible.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(key.snapshot()).toEqual({ a: 2 });
  });

  it("abandons the backoff promptly rather than sleeping it out", async () => {
    // The loop-top abort check already prevents a post-cancellation write, so
    // "does it persist?" cannot distinguish an abortable wait from an
    // unabortable one — both stop. What the abortable wait actually buys is
    // that a cancelled action doesn't hold its request open for the remainder
    // of a backoff it knows is pointless, so THAT is what this pins.
    const key = makeKey({ state: { a: 1 }, version: 1 });
    const container = createStateContainer<JsonObject>({ a: 1 }, 1);
    const controller = new AbortController();
    key.writeBehindOurBack({ a: 2 });

    const started = Date.now();
    const running = runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      signal: controller.signal,
      options: { maxRetries: 3, baseDelayMs: 3000 },
      persist: key.persist,
      reread: key.reread,
      mutator: (current) => ({ ...current, ours: true })
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    await expect(running).rejects.toThrow();

    // Generous margin against the 3s backoff: an unabortable timer cannot
    // return here in under a second.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not persist at all when the signal is already aborted", async () => {
    const key = makeKey({ state: { a: 1 }, version: 1 });
    const container = createStateContainer<JsonObject>({ a: 1 }, 1);
    const persist = vi.fn(key.persist);

    await expect(
      runResourceCAS({
        key: "spine",
        container,
        intent: "mutate",
        signal: AbortSignal.abort(),
        options: noRetries,
        persist,
        reread: key.reread,
        mutator: (current) => ({ ...current, ours: true })
      })
    ).rejects.toThrow();

    expect(persist).not.toHaveBeenCalled();
  });
});

describe("resource CAS driver — the no-op is verified, not assumed", () => {
  it("lands a write whose value equals a STALE cache", async () => {
    // The lost update this issue exists to stop, reached through the one path
    // that never checks a version. We read {mode:"old"}, somebody commits
    // {mode:"new"}, and we then deliberately write {mode:"old"} again.
    const key = makeKey({ state: { mode: "old" }, version: 1 });
    const container = createStateContainer<JsonObject>({ mode: "old" }, 1);
    key.writeBehindOurBack({ mode: "new" });

    const result = await runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: () => ({ mode: "old" })
    });

    // Assert on the STORE, not the return value: the naive short-circuit
    // returns the same `committed: false` a genuine no-op does, which is
    // exactly why the defect is invisible from the caller's side.
    expect(key.snapshot()).toEqual({ mode: "old" });
    expect(result.committed).toBe(true);
  });

  it("suppresses a same-value write when the cache is VERIFIED current", async () => {
    const key = makeKey({ state: { mode: "old" }, version: 1 });
    const container = createStateContainer<JsonObject>({ mode: "old" }, 1);
    const persist = vi.fn(key.persist);

    const result = await runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      options: fastRetries,
      persist,
      reread: key.reread,
      mutator: () => ({ mode: "old" })
    });

    expect(result.committed).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    // No version bump — this is what makes `committed: false` safe to gate a
    // change notification on.
    expect(key.version()).toBe(1);
  });

  it("is a no-op, NOT a deletion, when the key was never persisted", async () => {
    // The most ordinary path there is: a declared single resource that exists
    // so far only through its schema default, touched for the first time with a
    // write equal to that default. No row, no version — and nothing was taken
    // away, so reporting `resource_deleted` here would tell the caller about an
    // event that never happened. On the pre-CAS code this was a silent no-op.
    const key = makeKey(); // never written
    const container = createStateContainer<JsonObject>({ count: 0 }, 0);
    const persist = vi.fn(key.persist);

    const result = await runResourceCAS({
      key: "financialsData",
      container,
      intent: "mutate",
      options: fastRetries,
      persist,
      reread: key.reread,
      mutator: (current) => current
    });

    expect(result.committed).toBe(false);
    expect(result.version).toBe(0);
    expect(persist).not.toHaveBeenCalled();
    expect(key.snapshot()).toBeUndefined();
  });

  it("still creates the row when a never-persisted key's mutator DOES change it", async () => {
    // The companion to the case above: absent must mean "nothing to do" only
    // when the mutator asked for nothing. A real change still inserts.
    const key = makeKey();
    const container = createStateContainer<JsonObject>({ count: 0 }, 0);

    const result = await runResourceCAS({
      key: "financialsData",
      container,
      intent: "mutate",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: (current) => ({ ...current, count: 1 })
    });

    expect(result.committed).toBe(true);
    expect(key.snapshot()).toEqual({ count: 1 });
    expect(key.version()).toBe(1);
  });

  it("is terminal when a same-value write finds the row deleted", async () => {
    const key = makeKey({ state: { mode: "old" }, version: 1 });
    const container = createStateContainer<JsonObject>({ mode: "old" }, 1);
    key.deleteBehindOurBack();

    await expect(
      runResourceCAS({
        key: "spine",
        container,
        intent: "mutate",
        options: fastRetries,
        persist: key.persist,
        reread: key.reread,
        mutator: () => ({ mode: "old" })
      })
    ).rejects.toBeInstanceOf(ResourceDeletedError);
  });

  it("cannot be defeated by an updater mutating its argument in place", async () => {
    // `MemoryStateContainer.read()` hands out its internal reference. If the
    // driver passed that straight to a user-supplied updater, an in-place edit
    // would change the very object the deep-equal check compares against,
    // making every write look like a no-op.
    const key = makeKey({ state: { items: [] as unknown as JsonObject[] }, version: 1 });
    const container = createStateContainer<JsonObject>({ items: [] }, 1);

    const result = await runResourceCAS({
      key: "spine",
      container,
      intent: "mutate",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: (current) => {
        (current.items as unknown[]).push("added");
        return current;
      }
    });

    expect(result.committed).toBe(true);
    expect(key.snapshot()).toEqual({ items: ["added"] });
  });
});

describe("resource CAS driver — no commutative bypass", () => {
  it("version-checks a single-field literal patch instead of writing it blind", async () => {
    // `patchState({ oneField: literal })` is classified commutative for scope
    // state and persisted at `expectedVersion: "any"`. Inheriting that would
    // leave the most common resource write with no version check at all, and
    // would report a lost write as a silent `committed: false`.
    const key = makeKey({ state: { claimedBy: null }, version: 1 });
    const container = createStateContainer<JsonObject>({ claimedBy: null }, 1);
    const seen: ExpectedVersion[] = [];

    await runResourceCAS({
      key: "tasks/t1",
      container,
      intent: "mutate",
      options: fastRetries,
      reread: key.reread,
      persist: (next, expectedVersion) => {
        seen.push(expectedVersion);
        return key.persist(next, expectedVersion);
      },
      mutator: (current) => ({ ...current, claimedBy: "worker-a" })
    });

    expect(seen).toEqual([1]);
    expect(seen).not.toContain("any");
  });

  it("conflicts a single-field literal patch made against a stale version", async () => {
    const key = makeKey({ state: { claimedBy: null }, version: 1 });
    const container = createStateContainer<JsonObject>({ claimedBy: null }, 1);
    key.writeBehindOurBack({ claimedBy: "worker-b" });

    const result = await runResourceCAS({
      key: "tasks/t1",
      container,
      intent: "mutate",
      options: fastRetries,
      persist: key.persist,
      reread: key.reread,
      mutator: (current) => ({ ...current, note: "mine" })
    });

    // The retry re-ran against worker-b's state rather than overwriting it.
    expect(result.committed).toBe(true);
    expect(key.snapshot()).toEqual({ claimedBy: "worker-b", note: "mine" });
  });
});
