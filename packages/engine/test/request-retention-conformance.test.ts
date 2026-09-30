/**
 * Retention reused-id conformance for the stores the engine ships: memory and
 * filesystem. SQLite and Postgres run the same cases in their own packages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFilesystemStores, createInMemoryStores } from "../src";
import { createRequestRetentionConformanceTests } from "../src/testing";

createRequestRetentionConformanceTests({
  name: "memory stores",
  createStores: () => createInMemoryStores()
});

const tempDirs: string[] = [];

createRequestRetentionConformanceTests({
  name: "filesystem stores",
  createStores: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-retention-"));
    tempDirs.push(dir);
    return createFilesystemStores({ rootDir: dir, developmentOnly: true });
  },
  cleanup: async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
