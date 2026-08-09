/**
 * FIX-1026: `abortRequested` must leave `set`'s write surface across
 * CONNECTIONS, not just within one.
 *
 * SQLite is one of the two adapters the docs tell operators to use for
 * cross-process cancellation, so the interesting writer is a second connection
 * — a worker process holding a request-record snapshot while the API process
 * records a cancellation. A single-connection test cannot show this: it proves
 * only that one handle is self-consistent.
 *
 * The property under test is that the preservation is performed by the
 * DATABASE at write time. An implementation that reads the flag in JS and then
 * writes the blob has a window between the two statements that another
 * connection can commit into, and the full-record write then overwrites the
 * cancellation with the stale value it read.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSQLiteRequestStore } from "../src/request-store";
import { initializeSchemaDDL, applyConnectionPragmas } from "../src/schema";
import type { RequestRecord, RequestStore } from "@flow-state-dev/engine";

function makeRecord(requestId: string, status: RequestRecord["status"]): RequestRecord {
  const now = Date.now();
  return {
    id: requestId,
    state: {},
    version: 0,
    createdAt: now,
    updatedAt: now,
    flowKind: "xconn-flow",
    actionName: "run",
    userId: "u_xconn",
    source: "http",
    status,
    startedAtMs: now
  };
}

describe("SQLiteRequestStore — abort intent across connections", () => {
  let dir: string;
  let dbFile: string;
  let dbWorker: Database.Database;
  let dbApi: Database.Database;
  /** The process running the request. */
  let worker: RequestStore;
  /** The process that receives the cancellation. */
  let api: RequestStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "fsd-xconn-"));
    dbFile = path.join(dir, "store.db");

    dbWorker = new Database(dbFile);
    applyConnectionPragmas(dbWorker);
    initializeSchemaDDL(dbWorker);
    worker = createSQLiteRequestStore(dbWorker);

    dbApi = new Database(dbFile);
    applyConnectionPragmas(dbApi);
    api = createSQLiteRequestStore(dbApi);
  });

  afterEach(() => {
    dbWorker.close();
    dbApi.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a worker's full-record write does not erase a cancellation recorded on another connection", async () => {
    const requestId = "req_xconn_preserve";
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // The snapshot the worker holds for the life of the run, taken before any
    // cancellation exists.
    const staleSnapshot = await worker.get(requestId);
    expect(staleSnapshot?.abortRequested).not.toBe(true);

    // The API process records the cancellation on its own connection.
    const accepted = await api.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    expect(accepted).toEqual({ applied: true, status: "in_progress" });

    // The worker now writes its whole record back from that stale copy.
    await worker.set(
      requestId,
      { ...(staleSnapshot as RequestRecord), updatedAt: Date.now() },
      "any"
    );

    // Both connections must still see the cancellation.
    expect(await worker.isAbortRequested(requestId)).toBe(true);
    expect(await api.isAbortRequested(requestId)).toBe(true);
    expect((await worker.get(requestId))?.abortRequested).toBe(true);
  });

  it("a worker's full-record write cannot invent a cancellation the other connection never recorded", async () => {
    const requestId = "req_xconn_invent";
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");

    await worker.set(
      requestId,
      { ...makeRecord(requestId, "in_progress"), abortRequested: true },
      "any"
    );

    expect(await api.isAbortRequested(requestId)).toBe(false);
    expect(await worker.isAbortRequested(requestId)).toBe(false);
  });

  it("a cancellation recorded on one connection is visible to the other", async () => {
    const requestId = "req_xconn_visible";
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");

    await api.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    // This is the read the running process's heartbeat poll performs.
    expect(await worker.isAbortRequested(requestId)).toBe(true);
  });

  it("the stored flag keeps its JSON boolean type through a full-record write", async () => {
    const requestId = "req_xconn_type";
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");
    await api.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // Read the raw blob: a preservation that round-trips through
    // `json_extract` would store SQLite's integer 1 here, and every
    // `=== true` reader in the engine would then silently see `false`.
    const row = dbApi
      .prepare("SELECT data FROM requests WHERE id = ?")
      .get(requestId) as { data: string };
    expect(JSON.parse(row.data).abortRequested).toBe(true);
  });
});
