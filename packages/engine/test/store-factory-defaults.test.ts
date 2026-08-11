import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFilesystemStores,
  createInMemoryStores,
  resolveTraceMaxRequests
} from "../src/stores";
import { makeTraceEvent } from "../src/testing";

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
      await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
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
      await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(50);
  });

  it("honors an explicit traceStore.maxRequests override", async () => {
    process.env.NODE_ENV = "development";
    const stores = createInMemoryStores({ traceStore: { maxRequests: 3 } });
    for (let i = 0; i < 5; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(3);
  });
});

describe("createFilesystemStores trace defaults", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  /**
   * Budget raised from the 5s default because this test has no headroom for a
   * loaded runner — not because it is slow.
   *
   * Measured: ~1269–1505ms locally, ~1408–1464ms on CI. CI is NOT slower at
   * this; the numbers matter because a comment recording only the failure would
   * send the next reader looking at runner disk speed, and that is not where the
   * problem is. The one observed failure was 5037ms — a ~3.5x spike over the
   * test's own CI median, in a job where turbo was executing a large fan of
   * package suites concurrently. So the shape is "grazed a 5s line under
   * contention", not "gradually got slower".
   *
   * The cost is filesystem I/O, not the 1001 iterations: the in-memory twin of
   * this test does the same loop in ~4ms. It is the trace store's O(N^2) event
   * persistence, which is a documented property of the filesystem adapter rather
   * than something this test can avoid — the 1001st record is the whole point,
   * since it is what proves the 1000-record eviction.
   *
   * 15s is ~10x the median and ~3x the worst observed, so a heavier fan-out than
   * the one that failed still passes. Lower it only alongside a change that
   * makes the persistence cheaper.
   */
  const LOADED_RUNNER_TIMEOUT_MS = 15_000;

  it(
    "retains up to 1000 requests in development and evicts the 1001st",
    async () => {
      process.env.NODE_ENV = "development";
      const rootDir = await freshRootDir();
      const stores = createFilesystemStores({ rootDir });
      for (let i = 0; i < 1001; i += 1) {
        await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
      }
      const ids = await stores.traces.listRequestIds();
      expect(ids.length).toBe(1000);
      expect(ids).not.toContain("r0");
      expect(ids).toContain("r1000");
    },
    LOADED_RUNNER_TIMEOUT_MS
  );

  it("falls back to 50 in production and evicts the oldest", async () => {
    process.env.NODE_ENV = "production";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({ rootDir });
    for (let i = 0; i < 60; i += 1) {
      await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
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
      await stores.traces.appendEvent(`r${i}`, makeTraceEvent(`r${i}`, 1));
    }
    expect((await stores.traces.listRequestIds()).length).toBe(4);
  });

  it("writes events to {rootDir}/traces/", async () => {
    process.env.NODE_ENV = "development";
    const rootDir = await freshRootDir();
    const stores = createFilesystemStores({ rootDir });
    await stores.traces.appendEvent("r1", makeTraceEvent("r1", 1));
    const reopened = createFilesystemStores({ rootDir });
    expect(await reopened.traces.listRequestIds()).toContain("r1");
  });
});
