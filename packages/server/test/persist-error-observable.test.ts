import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import { createFilesystemStores } from "../src/stores";
import type { PersistErrorInfo } from "../src/stores/types";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";

/**
 * FIX-406 6B: filesystem store write failures must surface through an
 * `onPersistError` observable so operators can alert on them — not just land
 * in `console.error`.
 */
describe("filesystem store onPersistError observable", () => {
  let scratch: string;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), "fsd-persist-err-"));
    // Silence the safety-net log so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    consoleErrorSpy.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  });

  it("fires onPersistError with { store, id, error } when an event write fails", async () => {
    // Point the store's rootDir at a path *under an existing file* so the
    // adapter's mkdir/write throws ENOTDIR deterministically.
    const blockingFile = path.join(scratch, "not-a-dir");
    await writeFile(blockingFile, "x", "utf8");
    const rootDir = path.join(blockingFile, "requests");

    const received: PersistErrorInfo[] = [];
    const store = createFilesystemRequestStore({
      rootDir,
      onPersistError: (info) => received.push(info)
    });

    const event = {
      type: "request.created",
      status: "in_progress",
      stream: "events",
      requestId: "req_err",
      sequence_number: 0,
      ts: Date.now(),
      id: "evt_0"
    } as unknown as RequestStreamEvent;

    store.persistEvents("req_err", [event]);
    await expect(store.flushEvents("req_err")).rejects.toBeInstanceOf(Error);

    expect(received).toHaveLength(1);
    expect(received[0]?.store).toBe("request");
    expect(received[0]?.id).toBe("req_err");
    expect(received[0]?.error).toBeInstanceOf(Error);
  });

  it("still logs when no onPersistError handler is configured", async () => {
    const blockingFile = path.join(scratch, "blocker");
    await writeFile(blockingFile, "x", "utf8");
    const store = createFilesystemRequestStore({
      rootDir: path.join(blockingFile, "requests")
    });

    const event = {
      type: "request.created",
      status: "in_progress",
      stream: "events",
      requestId: "req_log",
      sequence_number: 0,
      ts: Date.now(),
      id: "evt_0"
    } as unknown as RequestStreamEvent;

    store.persistEvents("req_log", [event]);
    await expect(store.flushEvents("req_log")).rejects.toBeInstanceOf(Error);

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("threads onPersistError from the createFilesystemStores factory", async () => {
    const blockingFile = path.join(scratch, "blocker2");
    await writeFile(blockingFile, "x", "utf8");

    const received: PersistErrorInfo[] = [];
    const stores = createFilesystemStores({
      rootDir: path.join(blockingFile, "data"),
      onPersistError: (info) => received.push(info)
    });

    const event = {
      type: "request.created",
      status: "in_progress",
      stream: "events",
      requestId: "req_factory",
      sequence_number: 0,
      ts: Date.now(),
      id: "evt_0"
    } as unknown as RequestStreamEvent;

    stores.request.persistEvents("req_factory", [event]);
    await expect(stores.request.flushEvents("req_factory")).rejects.toBeInstanceOf(Error);

    expect(received.some((info) => info.store === "request" && info.id === "req_factory")).toBe(true);
  });
});
