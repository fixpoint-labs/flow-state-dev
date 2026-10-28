/**
 * Wake-store conformance (FIX-2078 D1) for the stores the engine ships:
 * memory and filesystem. SQLite and Postgres run the same cases in their own
 * packages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { createFilesystemWakeStore } from "../src/stores/filesystem/wake-store";
import { createInMemoryWakeStore } from "../src/stores/memory/wake-store";
import { createWakeStoreConformanceTests } from "../src/testing";

createWakeStoreConformanceTests({
  name: "memory",
  createStore: () => createInMemoryWakeStore()
});

const tempDirs: string[] = [];

createWakeStoreConformanceTests({
  name: "filesystem",
  createStore: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-wakes-"));
    tempDirs.push(dir);
    return createFilesystemWakeStore(dir);
  }
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
