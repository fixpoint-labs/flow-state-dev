/**
 * FIX-1026: the filesystem adapter's abort marker must be written under the
 * same per-id lock as the record it belongs to.
 *
 * `setFieldsIfStatus` promises the status check and the write are one step.
 * The filesystem adapter keeps the flag in a marker file beside the record, so
 * a marker written after the lock is released is not covered by that promise:
 * a terminal write or a `delete` can land in between, leaving a marker on a
 * request that has already finished — or an orphan marker with no record at
 * all, which would cancel a later run that reuses the id.
 */
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import type { RequestRecord, RequestStore } from "../src/stores/types";

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
