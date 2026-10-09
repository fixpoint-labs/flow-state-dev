/**
 * A park writes its gate to the request's item log: the in-memory and the
 * filesystem request stores (the SQLite and Postgres adapters run the same
 * harness in their own packages).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "../src";
import { createParkedGateConformanceTests } from "../src/testing";

const dirs: string[] = [];

createParkedGateConformanceTests({ name: "in-memory", createStores: () => createInMemoryStores() });
createParkedGateConformanceTests({
  name: "filesystem",
  createStores: async () => {
    const dir = await mkdtemp(join(tmpdir(), "fsd-parked-gate-"));
    dirs.push(dir);
    return createFilesystemStores({ rootDir: dir, developmentOnly: true });
  }
});

afterAll(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
