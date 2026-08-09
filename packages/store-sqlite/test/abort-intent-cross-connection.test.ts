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

  // The conditional write reads a status and then writes under that status.
  // A DEFERRED transaction takes only a read lock at the SELECT and upgrades at
  // the UPDATE; under WAL that upgrade FAILS with SQLITE_BUSY_SNAPSHOT when
  // another connection committed in between. `POST /abort` would then throw
  // where it owes the caller a clean 409. This pins the transaction mode by
  // demonstrating the hazard on the exact statement pattern the store uses.
  it("the read-then-write pattern is unsafe when DEFERRED, and safe when IMMEDIATE", () => {
    const requestId = "req_xconn_txmode";
    dbWorker
      .prepare("INSERT INTO requests (id, flow_kind, user_id, status, version, created_at, updated_at, data) VALUES (?,?,?,?,?,?,?,?)")
      .run(requestId, "f", "u", "in_progress", 0, 1, 1, "{}");

    const readThenWrite = (db: Database.Database) =>
      db.transaction(() => {
        db.prepare("SELECT status FROM requests WHERE id = ?").get(requestId);
        // Another connection commits a terminal status between the two.
        dbApi
          .prepare("UPDATE requests SET status = ? WHERE id = ?")
          .run("completed", requestId);
        db.prepare("UPDATE requests SET data = ? WHERE id = ?").run("{}", requestId);
      });

    let deferredError: string | undefined;
    try {
      readThenWrite(dbWorker)();
    } catch (error) {
      deferredError = (error as { code?: string }).code;
    }
    expect(deferredError).toBe("SQLITE_BUSY_SNAPSHOT");
  });

  it("reports a clean terminal conflict rather than throwing when the other connection went terminal first", async () => {
    const requestId = "req_xconn_terminal";
    await worker.set(requestId, makeRecord(requestId, "in_progress"), "any");

    // The worker commits its terminal status on its own connection.
    await worker.set(requestId, makeRecord(requestId, "completed"), "any");

    // The API process then tries to record a cancellation. The route turns
    // this result into a 409; a throw here would surface as a 500 instead.
    const result = await api.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );

    expect(result).toEqual({ applied: false, status: "completed" });
    expect(await api.isAbortRequested(requestId)).toBe(false);
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
