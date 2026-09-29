/**
 * Retention reused-id conformance on the SQLite stores: a request id freed by
 * retention must not carry its previous run's stream events to a new owner.
 */
import { afterAll } from "vitest";
import { createRequestRetentionConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/index";

const open: SQLiteStoreRegistry[] = [];

createRequestRetentionConformanceTests({
  name: "SQLite stores",
  createStores: () => {
    const registry = createSQLiteStores({ filename: ":memory:" });
    open.push(registry);
    return registry;
  }
});

// After the file rather than after the case, as the session stream suite does:
// a request's last writes can land just after its case ends.
afterAll(() => {
  for (const registry of open.splice(0)) registry.close();
});
