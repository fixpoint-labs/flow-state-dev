/**
 * Wake-store conformance (FIX-2078 D1) on the SQLite wake store.
 */
import { afterAll } from "vitest";
import { createWakeStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/index";

const open: SQLiteStoreRegistry[] = [];

createWakeStoreConformanceTests({
  name: "SQLite",
  createStore: () => {
    const registry = createSQLiteStores({ filename: ":memory:" });
    open.push(registry);
    return registry.wakes!;
  }
});

afterAll(() => {
  for (const registry of open.splice(0)) registry.close();
});
