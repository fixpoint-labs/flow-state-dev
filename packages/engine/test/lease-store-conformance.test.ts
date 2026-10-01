/**
 * Lease-store conformance for the stores the engine ships: memory and
 * filesystem. SQLite and Postgres run the same cases in their own packages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { createFilesystemLeaseStore } from "../src/stores/filesystem/lease-store";
import { createInMemoryLeaseStore } from "../src/stores/memory/lease-store";
import { createLeaseStoreConformanceTests } from "../src/testing";

createLeaseStoreConformanceTests({
  name: "memory",
  createStore: () => createInMemoryLeaseStore()
});

const tempDirs: string[] = [];

createLeaseStoreConformanceTests({
  name: "filesystem",
  createStore: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-leases-"));
    tempDirs.push(dir);
    return createFilesystemLeaseStore(dir);
  }
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
