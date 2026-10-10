/**
 * A park writes its gate to the request's item log, on the SQLite stores.
 */
import { afterAll } from "vitest";
import { createParkedGateConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/index";

const open: SQLiteStoreRegistry[] = [];

createParkedGateConformanceTests({
  name: "SQLite",
  createStores: () => {
    const registry = createSQLiteStores({ filename: ":memory:" });
    open.push(registry);
    return registry;
  }
});

afterAll(() => {
  for (const registry of open.splice(0)) registry.close();
});
