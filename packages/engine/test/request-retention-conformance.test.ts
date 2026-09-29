/**
 * Retention reused-id conformance for the memory stores. SQLite and Postgres
 * run the same cases in their own packages. The filesystem store's delete is
 * covered by the store-level delete conformance cases.
 */
import { createInMemoryStores } from "../src";
import { createRequestRetentionConformanceTests } from "../src/testing";

createRequestRetentionConformanceTests({
  name: "memory stores",
  createStores: () => createInMemoryStores()
});
