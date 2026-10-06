/**
 * Lease-store conformance on the SQLite lease store.
 */
import { afterAll } from "vitest";
import { createLeaseStoreConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/index";

const open: SQLiteStoreRegistry[] = [];

createLeaseStoreConformanceTests({
  name: "SQLite",
  createStore: () => {
    const registry = createSQLiteStores({ filename: ":memory:" });
    open.push(registry);
    return registry.leases;
  }
});

afterAll(() => {
  for (const registry of open.splice(0)) registry.close();
});
