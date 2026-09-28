/**
 * The session stream's conformance suite on SQLite. The suite is the engine's;
 * this file supplies the backends. The shared pair is two registries over one
 * database file: two servers on one database, which is the arrangement the
 * stream exists to serve.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { createSessionStreamConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

const open: SQLiteStoreRegistry[] = [];
const dirs: string[] = [];

function track(registry: SQLiteStoreRegistry): SQLiteStoreRegistry {
  open.push(registry);
  return registry;
}

createSessionStreamConformanceTests({
  name: "SQLite",
  createStores: () => track(createSQLiteStores({ filename: ":memory:" })),
  createSharedPair: async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsd-sqlite-session-stream-"));
    dirs.push(dir);
    const filename = join(dir, "test.db");
    return {
      a: track(createSQLiteStores({ filename })),
      b: track(createSQLiteStores({ filename }))
    };
  },
  itemsReadableWhileRunning: true
});

// After the file rather than after each case: a request's last writes can land
// just after its case ends, and a handle closed under them only adds noise.
afterAll(() => {
  for (const registry of open.splice(0)) registry.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
