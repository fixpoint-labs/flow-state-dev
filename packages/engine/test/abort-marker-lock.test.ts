/**
 * FIX-1026: the filesystem adapter's abort marker must be written under the
 * same per-id lock as the record it belongs to — and every writer that touches
 * a request's files, `delete` included, must take that lock.
 *
 * `setFieldsIfStatus` promises the status check and the write are one step.
 * The filesystem adapter keeps the flag in a marker file beside the record, so
 * a marker written after the lock is released is not covered by that promise:
 * a terminal write or a `delete` can land in between, leaving a marker on a
 * request that has already finished — or an orphan marker with no record at
 * all, which would cancel a later run that reuses the id.
 *
 * Moving the marker write inside the merge was only half of that. `delete`
 * took no lock at all, so it could still land *inside* another writer's
 * read-modify-write and be undone by it. The two interleave tests below park
 * a writer mid-callback and issue the delete into that window deliberately,
 * rather than firing both and hoping the scheduler produces the race.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import { createFilesystemRecordStore } from "../src/stores/filesystem/shared";
import type { RequestRecord, RequestStore } from "../src/stores/types";

/**
 * A promise plus its resolver, for parking execution at a chosen point so an
 * interleave is deterministic instead of timing-dependent.
 */
function createGate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function makeRecord(requestId: string, status: RequestRecord["status"]): RequestRecord {
  const now = Date.now();
  return {
    id: requestId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    flowKind: "marker-flow",
    actionName: "run",
    userId: "u_marker",
    source: "http",
    status,
    startedAtMs: now
  };
}

describe("FilesystemRequestStore — abort marker is written under the record lock", () => {
  let rootDir: string;
  let store: RequestStore;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "fsd-marker-"));
    store = createFilesystemRequestStore({ rootDir });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("serializes a concurrent terminal write against the conditional write", async () => {
    const requestId = "req_marker_race";
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // Fire both without awaiting the first: the terminal write and the
    // conditional write contend for the same per-id lock. Whichever order the
    // lock grants, the two must not interleave — the marker may only exist if
    // the predicate genuinely held against the record as written.
    const [, conditional] = await Promise.all([
      store.set(requestId, makeRecord(requestId, "completed"), "any"),
      store.setFieldsIfStatus(
        requestId,
        { abortRequested: true },
        ["in_progress"],
        Date.now()
      )
    ]);

    const record = await store.get(requestId);
    const marked = await store.isAbortRequested(requestId);

    // The marker and the applied result must agree. A marker written outside
    // the lock can land after the terminal write and leave `marked` true on a
    // record the predicate no longer matched.
    expect(marked).toBe(conditional.applied);
    if (!conditional.applied) {
      expect(record?.status).toBe("completed");
      expect(record?.abortRequested).not.toBe(true);
    }
  });

  it("leaves no marker behind when the request is deleted", async () => {
    const requestId = "req_marker_deleted";
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");
    await store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    expect(await store.isAbortRequested(requestId)).toBe(true);

    await store.delete(requestId);

    // An orphan marker would report a cancellation for a request that no longer
    // exists, and would cancel a later run that reused the id.
    expect(await store.isAbortRequested(requestId)).toBe(false);
    expect(readdirSync(rootDir).filter((f) => f.endsWith(".abort"))).toEqual([]);
  });

  /**
   * Write a record file directly, carrying `abortRequested` INLINE — the shape
   * a record persisted before the flag moved off `set`'s write surface has.
   * The store's own `set` strips the field, so this is the only way to produce
   * one.
   */
  function writeLegacyRecord(requestId: string, status: RequestRecord["status"]): void {
    writeFileSync(
      path.join(rootDir, `${encodeURIComponent(requestId)}.json`),
      JSON.stringify({ ...makeRecord(requestId, status), abortRequested: true })
    );
  }

  it("an applied clear survives a re-read of a legacy inline record", async () => {
    const requestId = "req_marker_clear_legacy";
    writeLegacyRecord(requestId, "in_progress");

    // Record the cancellation, then withdraw it.
    await store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    const cleared = await store.setFieldsIfStatus(
      requestId,
      { abortRequested: false },
      ["in_progress"],
      Date.now()
    );
    expect(cleared.applied).toBe(true);

    // Removing the marker is not enough while the record still carries the
    // flag inline: the next read would treat the inline copy as authoritative
    // and the withdrawn cancellation would come back.
    expect(await store.isAbortRequested(requestId)).toBe(false);
    expect((await store.get(requestId))?.abortRequested).not.toBe(true);
    // ...and it must stay withdrawn across repeated reads.
    expect(await store.isAbortRequested(requestId)).toBe(false);
  });

  it("reading a legacy inline record does not create a marker", async () => {
    const requestId = "req_marker_read_only";
    writeLegacyRecord(requestId, "in_progress");

    // The dual-read reports the flag...
    expect((await store.get(requestId))?.abortRequested).toBe(true);

    // ...but a read must not mutate storage. Migration belongs on the write
    // path (see the legacy full-write case below), which keeps the locked
    // read-modify-write off `get` — the O(items) call the marker exists to
    // keep off the poll in the first place.
    expect(existsSync(path.join(rootDir, `${encodeURIComponent(requestId)}.abort`))).toBe(false);
    expect(readdirSync(rootDir).filter((f) => f.endsWith(".abort"))).toEqual([]);
  });

  it("preserves legacy inline abort intent across a full-record write", async () => {
    const requestId = "req_legacy_full_write";
    // Cancelled before the upgrade: the intent is inline on the record and
    // there is no marker, because markers did not exist when it was written.
    writeLegacyRecord(requestId, "suspended");
    expect((await store.get(requestId))?.abortRequested).toBe(true);

    // A normal full-record write — the shape all six full-record writers
    // perform, none of which knows the flag exists. `set` may not clear stored
    // intent in either direction; a legacy record is still stored intent.
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // Two assertions, and they discriminate different halves. This one only
    // requires that the intent survive somewhere readable...
    expect((await store.get(requestId))?.abortRequested).toBe(true);
    // ...this one requires it to have moved to the marker, which is the half
    // that matters: the cross-process poll is a bare `stat` and never parses
    // the record, so intent left inline is intent the poll cannot deliver.
    expect(await store.isAbortRequested(requestId)).toBe(true);
  });

  it("preserves legacy inline abort intent across a conditional write of another field", async () => {
    const requestId = "req_legacy_conditional_other_field";
    // Cancelled before the upgrade: intent is inline, no marker exists.
    writeLegacyRecord(requestId, "in_progress");
    expect((await store.get(requestId))?.abortRequested).toBe(true);

    // A conditional write that never mentions `abortRequested`. The verb is
    // deliberately general — its field set is a parameter, not an abort-shaped
    // `markAborted()` — so a caller writing any other field is exactly what it
    // is for. Such a write skips the marker branch but still strips the inline
    // copy on the way out, which is the whole loss: nothing moved the intent
    // to the marker first.
    const applied = await store.setFieldsIfStatus(
      requestId,
      { interruptedAt: Date.now() },
      ["in_progress"],
      Date.now()
    );
    expect(applied.applied).toBe(true);

    // Same two halves as the full-record case above, and they discriminate
    // differently. This one only asks that the intent survive somewhere
    // readable...
    expect((await store.get(requestId))?.abortRequested).toBe(true);
    // ...this one asks that it reached the marker, which is the half that
    // decides whether the cancellation can still be delivered: the
    // cross-process poll is a bare `stat` and never parses the record.
    expect(await store.isAbortRequested(requestId)).toBe(true);
  });

  it("does not lose legacy inline intent to a write that overlaps the migration", async () => {
    const requestId = "req_legacy_overlap";
    writeLegacyRecord(requestId, "suspended");
    expect((await store.get(requestId))?.abortRequested).toBe(true);

    // Park writer A inside its migration, at the marker write. The migration
    // runs within the same lock hold as the write it belongs to, so this is
    // the whole window: a second writer can only be ahead of A if it took the
    // lock first, and then A's own migration would see the record it left.
    const entered = createGate();
    const parked = createGate();
    const seam = store as unknown as {
      writeAbortMarker: (id: string, requested: boolean) => Promise<void>;
    };
    const originalWriteMarker = seam.writeAbortMarker.bind(store);
    seam.writeAbortMarker = async (id: string, requested: boolean) => {
      entered.open();
      await parked.wait;
      await originalWriteMarker(id, requested);
    };

    const writeA = store.set(requestId, makeRecord(requestId, "in_progress"), "any");
    await entered.wait; // A holds the lock, mid-migration

    // B is an ordinary second full-record write — the shape that does the
    // damage, because it strips the inline flag without knowing the flag
    // exists. It must queue behind A rather than slip past it.
    const writeB = store.set(requestId, makeRecord(requestId, "in_progress"), "any");
    parked.open();
    await Promise.all([writeA, writeB]);

    // Both writes reported success and no I/O failed — this loss is silent.
    // The cancellation must still reach the cross-process poll, which consults
    // the marker and nothing else.
    expect(await store.isAbortRequested(requestId)).toBe(true);
    expect((await store.get(requestId))?.abortRequested).toBe(true);
  });

  it("fails the write loudly rather than stripping intent it could not migrate", async () => {
    const requestId = "req_legacy_retry";
    writeLegacyRecord(requestId, "suspended");

    // Fail the migration's marker write exactly once. That write is the
    // fallible step: the record it migrates from is handed to it by the lock
    // the write already holds, so there is no separate read to fail.
    const seam = store as unknown as {
      writeAbortMarker: (id: string, requested: boolean) => Promise<void>;
    };
    const originalWriteMarker = seam.writeAbortMarker.bind(store);
    let failNextMarker = true;
    seam.writeAbortMarker = async (id: string, requested: boolean) => {
      if (failNextMarker && id === requestId) {
        failNextMarker = false;
        throw Object.assign(new Error("EIO: simulated marker failure"), {
          code: "EIO"
        });
      }
      await originalWriteMarker(id, requested);
    };

    // Fail-closed: the migration runs before the record is replaced, so a
    // failure leaves the inline copy intact instead of stripping a
    // cancellation it could not move.
    await expect(
      store.set(requestId, makeRecord(requestId, "in_progress"), "any")
    ).rejects.toThrow("simulated marker failure");
    expect((await store.get(requestId))?.abortRequested).toBe(true);

    // And the next write must still migrate. A failure that were remembered —
    // as "checked" or as a cached rejection — would leave the request
    // permanently unable to move its intent to the marker, where the
    // cross-process poll is the only reader that matters.
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");
    expect(await store.isAbortRequested(requestId)).toBe(true);
  });

  it("does not resurrect a deleted record when the delete lands mid-callback", async () => {
    const requestId = "req_marker_delete_interleave";
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // Park inside the locked merge, at the marker write — the exact window the
    // finding names. Reaching through to the private method is deliberate: it
    // is the only seam that suspends execution *inside* the callback while the
    // lock is held, and staging this by racing two calls would be the timing
    // hack this test exists to avoid.
    const parked = createGate();
    const entered = createGate();
    const seam = store as unknown as {
      writeAbortMarker: (id: string, requested: boolean) => Promise<void>;
    };
    const originalWriteMarker = seam.writeAbortMarker.bind(store);
    seam.writeAbortMarker = async (id: string, requested: boolean) => {
      entered.open();
      await parked.wait;
      await originalWriteMarker(id, requested);
    };

    const conditional = store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    await entered.wait; // the merge now holds the per-id lock

    const deletion = store.delete(requestId); // must queue behind that lock
    parked.open();
    await Promise.all([conditional, deletion]);

    // The delete is the last writer, so it wins. A delete that bypassed the
    // lock would have removed the record while the merge was parked, and the
    // merge's own `writeRecord` would then have brought the record back — with
    // a marker attached that no live request owns.
    expect(await store.get(requestId)).toBeUndefined();
    expect(await store.isAbortRequested(requestId)).toBe(false);
    expect(readdirSync(rootDir).filter((f) => f.endsWith(".abort"))).toEqual([]);
  });

  /**
   * `set` must claim its place in the per-id queue when it is CALLED, not
   * after an `await`. The legacy migration used to run as its own locked
   * operation ahead of the write, which released the lock in between — long
   * enough for a delete issued afterwards to run to completion and for the
   * trailing write to put the record straight back.
   */
  it("does not resurrect a record deleted while the legacy migration held the lock", async () => {
    const requestId = "req_migrate_delete_resurrect";
    writeLegacyRecord(requestId, "in_progress");

    // Park the migration at its marker write, where it holds the per-id lock.
    const entered = createGate();
    const parked = createGate();
    const seam = store as unknown as {
      writeAbortMarker: (id: string, requested: boolean) => Promise<void>;
    };
    const originalWriteMarker = seam.writeAbortMarker.bind(store);
    seam.writeAbortMarker = async (id: string, requested: boolean) => {
      entered.open();
      await parked.wait;
      await originalWriteMarker(id, requested);
    };

    const writeA = store.set(requestId, makeRecord(requestId, "in_progress"), "any");
    await entered.wait; // A is inside the lock, migrating

    // Issued while A holds the lock, so it queues behind it. The lock is a
    // FIFO chain, so the order is fixed here rather than raced: migration →
    // delete → whatever A does next.
    const deletion = store.delete(requestId);
    parked.open();
    await Promise.all([writeA, deletion]);

    // The delete was issued last and reported success, so it is the final
    // writer. A `set` that only reached for the lock after its migration
    // released it lands third and recreates the request — a record that no
    // caller asked to exist, and (since the delete swept the marker) one
    // whose accepted cancellation is gone with it.
    expect(await store.get(requestId)).toBeUndefined();
    expect(await store.isAbortRequested(requestId)).toBe(false);
    expect(readdirSync(rootDir).filter((f) => f.endsWith(".abort"))).toEqual([]);
  });

  it("lets a delete issued after an ordinary set be the final writer", async () => {
    const requestId = "req_set_then_delete";
    await store.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // No parking and no legacy record: the plainest possible statement of the
    // ordering, and the one every caller relies on. Both calls are issued in
    // program order without awaiting the first, which is how the request
    // executor's terminal write and a cleanup delete actually overlap.
    const writeA = store.set(requestId, makeRecord(requestId, "completed"), "any");
    const deletion = store.delete(requestId);
    await Promise.all([writeA, deletion]);

    expect(await store.get(requestId)).toBeUndefined();
    expect(readdirSync(rootDir)).toEqual([]);
  });

  it("does not create a marker for a request that does not exist", async () => {
    const result = await store.setFieldsIfStatus(
      "req_marker_absent",
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    expect(result).toEqual({ applied: false, status: undefined });
    expect(await store.isAbortRequested("req_marker_absent")).toBe(false);
    expect(existsSync(path.join(rootDir, "req_marker_absent.abort"))).toBe(false);
  });

  it("does not create a marker when the predicate misses on a terminal record", async () => {
    const requestId = "req_marker_terminal";
    await store.set(requestId, makeRecord(requestId, "completed"), "any");

    const result = await store.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    expect(result).toEqual({ applied: false, status: "completed" });
    expect(await store.isAbortRequested(requestId)).toBe(false);
  });
});

/**
 * The half of the fix that lives below the request store. `delete` was the one
 * mutating verb on the shared filesystem record store that took no per-id
 * lock, so it could land inside another writer's read-modify-write and be
 * silently undone by that writer's trailing `writeRecord`.
 */
describe("FilesystemRecordStore — delete takes the per-id write lock", () => {
  type Row = { id: string; updatedAt: number; version: number };

  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(path.join(tmpdir(), "fsd-record-lock-"));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("does not let a delete land inside another writer's read-modify-write", async () => {
    const store = createFilesystemRecordStore<Row, Record<string, never>>({
      rootDir
    });
    await store.set("r1", { id: "r1", updatedAt: Date.now(), version: 0 }, "any");

    // The merge callback is the test's own, so the window is exact — no
    // reliance on scheduling, and no private access needed here.
    const parked = createGate();
    const entered = createGate();

    const update = store.update("r1", async (current) => {
      entered.open();
      await parked.wait;
      return { ...current, version: current.version + 1 };
    });

    await entered.wait; // the merge holds the lock
    const deletion = store.delete("r1");
    parked.open();
    await Promise.all([update, deletion]);

    // Deleted last, so it stays deleted. Without the lock the delete removes
    // the file while the merge is parked, and the merge's `writeRecord` then
    // writes the record straight back — a delete that reported success and
    // left the record on disk.
    expect(await store.get("r1")).toBeUndefined();
  });

  /**
   * The queue tracks each operation with a promise derived from the caller's,
   * purely for ordering. A locked operation that rejects therefore leaves TWO
   * rejected promises: the caller's (handled) and the tracking one (nobody's).
   * Node reports the second as an unhandled rejection and, on the default
   * `--unhandled-rejections=throw`, takes the process down — so a store write
   * that failed cleanly would kill the host it failed on.
   *
   * This only became reachable once fallible I/O moved inside the lock (the
   * abort marker write, and the migration hook beside it).
   */
  it("does not leak an unhandled rejection when a locked operation fails", async () => {
    const store = createFilesystemRecordStore<Row, Record<string, never>>({
      rootDir
    });
    await store.set("r1", { id: "r1", updatedAt: Date.now(), version: 0 }, "any");

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        store.update("r1", () => {
          throw Object.assign(new Error("EIO: simulated merge failure"), {
            code: "EIO"
          });
        })
      ).rejects.toThrow("simulated merge failure");

      // Node flags unhandled rejections a macrotask after the microtask queue
      // drains, so the check has to outlive both.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(
        unhandled.map((reason) =>
          reason instanceof Error ? reason.message : String(reason)
        )
      ).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    // And the failure must not poison the queue for the next writer.
    const after = await store.set(
      "r1",
      { id: "r1", updatedAt: Date.now(), version: 1 },
      "any"
    );
    expect(after.ok).toBe(true);
  });
});
