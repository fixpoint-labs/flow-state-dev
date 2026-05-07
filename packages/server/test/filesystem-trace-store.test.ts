import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemTraceStore,
  type TraceEvent,
  type TraceStore
} from "../src/stores";
import { createTraceStoreConformanceTests } from "../src/testing";

const trackedRootDirs: string[] = [];

async function freshRootDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsd-trace-"));
  trackedRootDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of trackedRootDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

createTraceStoreConformanceTests({
  name: "FilesystemTraceStore",
  createStore: async (options) => {
    const rootDir = await freshRootDir();
    return createFilesystemTraceStore({
      rootDir,
      maxRequests: options?.maxRequests
    });
  }
});

function makeEvent(
  requestId: string,
  sequenceNumber: number,
  ts: number
): TraceEvent {
  return {
    requestId,
    sequenceNumber,
    ts,
    type: "trace.item.added",
    item: {
      type: "block_debug",
      itemId: `item_${sequenceNumber}`,
      ts,
      blockName: "test"
    } as unknown as TraceEvent["item"]
  };
}

describe("FilesystemTraceStore (backend-specific)", () => {
  let rootDir: string;
  let store: TraceStore;

  beforeEach(async () => {
    rootDir = await freshRootDir();
    store = createFilesystemTraceStore({ rootDir });
  });

  it("persists events across instance reconstruction", async () => {
    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    await store.appendEvent("r1", makeEvent("r1", 2, 101));
    await store.appendEvent("r2", makeEvent("r2", 1, 102));
    await store.flush("r1");
    await store.flush("r2");

    // Discard the instance and rebuild against the same rootDir.
    const reopened = createFilesystemTraceStore({ rootDir });
    expect(await reopened.listRequestIds()).toEqual(["r1", "r2"]);
    const r1Events = await reopened.getEvents("r1");
    expect(r1Events.map((e) => e.sequenceNumber)).toEqual([1, 2]);
    const r2Events = await reopened.getEvents("r2");
    expect(r2Events.map((e) => e.sequenceNumber)).toEqual([1]);
  });

  it("writes a stable JSON shape to _roster.json", async () => {
    await store.appendEvent("req-with/slash", makeEvent("req-with/slash", 1, 100));
    const raw = await readFile(path.join(rootDir, "_roster.json"), "utf8");
    const parsed = JSON.parse(raw) as Array<{ requestId: string; insertedAt: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.requestId).toBe("req-with/slash");
    expect(typeof parsed[0]!.insertedAt).toBe("number");
  });

  it("encodes URL-unsafe characters in the .ndjson filename", async () => {
    const id = "req with/slash";
    await store.appendEvent(id, makeEvent(id, 1, 100));
    const filePath = path.join(rootDir, `${encodeURIComponent(id)}.ndjson`);
    const raw = await readFile(filePath, "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(1);
  });

  it("ignores orphan .ndjson files not present in the roster", async () => {
    await writeFile(path.join(rootDir, "orphan.ndjson"), '{"orphan":true}\n', "utf8");
    expect(await store.listRequestIds()).toEqual([]);
    expect(await store.getEvents("orphan")).toEqual([]);
  });

  it("treats a malformed roster file as empty and recovers on next write", async () => {
    await writeFile(path.join(rootDir, "_roster.json"), "{not json", "utf8");
    expect(await store.listRequestIds()).toEqual([]);

    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    expect(await store.listRequestIds()).toEqual(["r1"]);

    const rebuilt = createFilesystemTraceStore({ rootDir });
    expect(await rebuilt.listRequestIds()).toEqual(["r1"]);
  });

  it("skips corrupted lines on getEvents", async () => {
    await store.appendEvent("r1", makeEvent("r1", 1, 100));
    await store.appendEvent("r1", makeEvent("r1", 2, 101));
    await store.flush("r1");

    // Inject a corrupted line by rewriting the file directly.
    const filePath = path.join(rootDir, `${encodeURIComponent("r1")}.ndjson`);
    const original = await readFile(filePath, "utf8");
    await writeFile(filePath, `${original}{corrupt\n`, "utf8");

    const events = await store.getEvents("r1");
    expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2]);
  });

  it("evicts request files from disk when maxRequests is exceeded", async () => {
    const small = createFilesystemTraceStore({ rootDir, maxRequests: 2 });
    await small.appendEvent("r1", makeEvent("r1", 1, 100));
    await small.appendEvent("r2", makeEvent("r2", 1, 101));
    await small.appendEvent("r3", makeEvent("r3", 1, 102));

    expect(await small.listRequestIds()).toEqual(["r2", "r3"]);
    // Reopening must agree — eviction must have written through to disk.
    const reopened = createFilesystemTraceStore({ rootDir, maxRequests: 2 });
    expect(await reopened.listRequestIds()).toEqual(["r2", "r3"]);
    expect(await reopened.getEvents("r1")).toEqual([]);
  });

  it("coalesces concurrent appends into a single write", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.appendEvent("r1", makeEvent("r1", i + 1, 100 + i))
      )
    );
    const events = await store.getEvents("r1");
    expect(events).toHaveLength(10);
    expect(events.map((e) => e.sequenceNumber).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ]);
  });
});
