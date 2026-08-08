/**
 * Scope-store CAS conformance for the two in-repo adapters (FIX-1007).
 *
 * The SQLite and Postgres adapters run the same suite from their own packages,
 * which is what keeps their restated write predicates honest against these
 * two.
 *
 * Neither adapter here gets a `createSharedPair`: the in-memory store has no
 * cross-connection notion, and the filesystem store's guarantee is explicitly
 * a per-id lock held on the store *instance* — two instances over one
 * directory race by design, and that limitation is documented on the store
 * contract rather than fixed here.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import {
  createFilesystemSessionStore,
  createInMemorySessionStore
} from "../src";
import { createScopeStoreConformanceTests } from "../src/testing";

const tempDirs: string[] = [];

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

createScopeStoreConformanceTests({
  name: "InMemorySessionStore",
  createStore: () => createInMemorySessionStore()
});

createScopeStoreConformanceTests({
  name: "FilesystemSessionStore",
  createStore: async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-scope-cas-"));
    tempDirs.push(rootDir);
    return createFilesystemSessionStore({ rootDir });
  }
});
