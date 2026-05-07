import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemStores,
  createInMemoryStores,
  resolveTraceMaxRequests,
  type TraceEvent
} from "../src/stores";

const trackedRootDirs: string[] = [];

afterEach(async () => {
  for (const dir of trackedRootDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function freshRootDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fsd-trace-defaults-"));
  trackedRootDirs.push(dir);
  return dir;
}

function makeEvent(requestId: string, sequenceNumber: number): TraceEvent {
  return {
    requestId,
    sequenceNumber,
    ts: 0,
    type: "trace.item.added",
    item: {
      type: "block_debug",
      itemId: `item_${sequenceNumber}`,
      ts: 0,
      blockName: "test"
    } as unknown as TraceEvent["item"]
  };
}

describe("resolveTraceMaxRequests", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("returns the development default when NODE_ENV=development", () => {
    process.env.NODE_ENV = "development";
    expect(resolveTraceMaxRequests()).toBe(1000);
  });

  it("returns the production default for any other NODE_ENV", () => {
    process.env.NODE_ENV = "production";
    expect(resolveTraceMaxRequests()).toBe(50);
    process.env.NODE_ENV = "test";
    expect(resolveTraceMaxRequests()).toBe(50);
    delete process.env.NODE_ENV;
    expect(resolveTraceMaxRequests()).toBe(50);
  });

  it("honors an explicit override regardless of NODE_ENV", () => {
    process.env.NODE_ENV = "development";
    expect(resolveTraceMaxRequests(7)).toBe(7);
    process.env.NODE_ENV = "production";
    expect(resolveTraceMaxRequests(7)).toBe(7);
  });
});

describe("createInMemoryStores trace defaults", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("retains up to 1000 requests in development and evicts the 1001st", async () => {
    process.env.NODE_ENV = "development";
    const stores = createInMemoryStores();
    for (let i = 0; i < 1001; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    const ids = await stores.traces.listRequestIds();
    expect(ids.length).toBe(1000);
    expect(ids).not.toContain("r0");
    expect(ids).toContain("r1000");
  });

  it("retains only 50 requests in production", async () => {
    process.env.NODE_ENV = "production";
    const stores = createInMemoryStores();
    for (let i = 0; i < 60; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(50);
  });

  it("honors an explicit traceStore.maxRequests override", async () => {
    process.env.NODE_ENV = "development";
    const stores = createInMemoryStores({ traceStore: { maxRequests: 3 } });
    for (let i = 0; i < 5; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(3);
  });
});

describe("createFilesystemStores trace defaults", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("retains up to 1000 requests in development and evicts the 1001st", async () => {
    process.env.NODE_ENV = "development";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({ rootDir });
    for (let i = 0; i < 1001; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    const ids = await stores.traces.listRequestIds();
    expect(ids.length).toBe(1000);
    expect(ids).not.toContain("r0");
    expect(ids).toContain("r1000");
  });

  it("falls back to 50 in production and evicts the oldest", async () => {
    process.env.NODE_ENV = "production";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({ rootDir });
    for (let i = 0; i < 60; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    const ids = await stores.traces.listRequestIds();
    expect(ids.length).toBe(50);
    expect(ids).not.toContain("r0");
    expect(ids).toContain("r59");
  });

  it("honors an explicit override even in development", async () => {
    process.env.NODE_ENV = "development";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({
      rootDir,
      traceStore: { maxRequests: 4 }
    });
    for (let i = 0; i < 6; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(4);
  });

  it("writes events to {rootDir}/traces/", async () => {
    process.env.NODE_ENV = "development";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({ rootDir });
    await stores.traces.appendEvent("r1", makeEvent("r1", 1));
    // Re-open against the same rootDir using a fresh registry: data must persist.
    const reopened = createFilesystemStores({ rootDir });
    expect(await reopened.traces.listRequestIds()).toContain("r1");
  });
});
