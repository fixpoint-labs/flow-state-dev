import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemTraceStore,
  type TraceStore
} from "../src/stores";
import {
  createTraceStoreConformanceTests,
  makeTraceEvent
} from "../src/testing";

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

describe("FilesystemTraceStore (backend-specific)", () => {
  let rootDir: string;
  let store: TraceStore;

  beforeEach(async () => {
    rootDir = await freshRootDir();
    store = createFilesystemTraceStore({ rootDir });
  });

  it("persists events across instance reconstruction", async () => {
    await store.appendEvent("r1", makeTraceEvent("r1", 1));
    await store.appendEvent("r1", makeTraceEvent("r1", 2));
    await store.appendEvent("r2", makeTraceEvent("r2", 1));
    await store.flush("r1");
    await store.flush("r2");

    const reopened = createFilesystemTraceStore({ rootDir });
    expect(await reopened.listRequestIds()).toEqual(["r1", "r2"]);
    const r1Events = await reopened.getEvents("r1");
    expect(r1Events.map((e) => e.sequenceNumber)).toEqual([1, 2]);
    const r2Events = await reopened.getEvents("r2");
    expect(r2Events.map((e) => e.sequenceNumber)).toEqual([1]);
  });

  it("writes a stable JSON shape to _roster.json", async () => {
    await store.appendEvent("req-with/slash", makeTraceEvent("req-with/slash", 1));
    const raw = await readFile(path.join(rootDir, "_roster.json"), "utf8");
    const parsed = JSON.parse(raw) as Array<{ requestId: string; insertedAt: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.requestId).toBe("req-with/slash");
    expect(typeof parsed[0]!.insertedAt).toBe("number");
  });

  it("encodes URL-unsafe characters in the .ndjson filename", async () => {
    const id = "req with/slash";
    await store.appendEvent(id, makeTraceEvent(id, 1));
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

    await store.appendEvent("r1", makeTraceEvent("r1", 1));
    expect(await store.listRequestIds()).toEqual(["r1"]);

    const rebuilt = createFilesystemTraceStore({ rootDir });
    expect(await rebuilt.listRequestIds()).toEqual(["r1"]);
  });

  it("skips corrupted lines on getEvents", async () => {
    await store.appendEvent("r1", makeTraceEvent("r1", 1));
    await store.appendEvent("r1", makeTraceEvent("r1", 2));
    await store.flush("r1");

    const filePath = path.join(rootDir, `${encodeURIComponent("r1")}.ndjson`);
    const original = await readFile(filePath, "utf8");
    await writeFile(filePath, `${original}{corrupt\n`, "utf8");

    const events = await store.getEvents("r1");
    expect(events.map((e) => e.sequenceNumber)).toEqual([1, 2]);
  });

  it("evicts request files from disk when maxRequests is exceeded", async () => {
    const small = createFilesystemTraceStore({ rootDir, maxRequests: 2 });
    await small.appendEvent("r1", makeTraceEvent("r1", 1));
    await small.appendEvent("r2", makeTraceEvent("r2", 1));
    await small.appendEvent("r3", makeTraceEvent("r3", 1));

    expect(await small.listRequestIds()).toEqual(["r2", "r3"]);
    const reopened = createFilesystemTraceStore({ rootDir, maxRequests: 2 });
    expect(await reopened.listRequestIds()).toEqual(["r2", "r3"]);
    expect(await reopened.getEvents("r1")).toEqual([]);
  });

  it("coalesces concurrent appends into a single write", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.appendEvent("r1", makeTraceEvent("r1", i + 1))
      )
    );
    const events = await store.getEvents("r1");
    expect(events).toHaveLength(10);
    expect(events.map((e) => e.sequenceNumber).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10
    ]);
  });
});
