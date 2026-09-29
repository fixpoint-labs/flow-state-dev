/**
 * Retention reused-id conformance on the SQLite stores: a request id freed by
 * retention must not carry its previous run's stream events to a new owner.
 */
import { createRequestRetentionConformanceTests } from "@flow-state-dev/engine/testing";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src/index";

createRequestRetentionConformanceTests({
  name: "SQLite stores",
  createStores: () => createSQLiteStores({ filename: ":memory:" }),
  cleanup: (stores: StoreRegistry) => {
    (stores as SQLiteStoreRegistry).close();
  }
});
