/**
 * SQLite adapter compliance with the shared scope-store CAS contract
 * (FIX-1007).
 *
 * The suite is the engine's; this file only supplies the backends. The
 * cross-connection pair matters more here than anywhere else: `better-sqlite3`
 * is synchronous, so nothing yields between two statements inside one process
 * and the interleaving that breaks a non-atomic create-if-absent cannot occur
 * in-process. Two registries over one database file is what actually tests it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScopeStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

const open: SQLiteStoreRegistry[] = [];

function track(registry: SQLiteStoreRegistry): SQLiteStoreRegistry {
  open.push(registry);
  return registry;
}

createScopeStoreConformanceTests({
  name: "SQLiteSessionStore",
  createStore: () => track(createSQLiteStores({ filename: ":memory:" })).session,
  cleanup: () => {
    for (const registry of open.splice(0)) registry.close();
  },
  createSharedPair: async () => {
    const dir = mkdtempSync(join(tmpdir(), "fsd-sqlite-scope-cas-"));
    const filename = join(dir, "test.db");
    const a = createSQLiteStores({ filename });
    const b = createSQLiteStores({ filename });
    return {
      a: a.session,
      b: b.session,
      cleanup: () => {
        a.close();
        b.close();
        rmSync(dir, { recursive: true, force: true });
      }
    };
  }
});
