/**
 * `findBy` over a real SQLite registry, through `createFlowState`: the shared
 * cross-store cases, plus the ones only a store with index verbs answers (a
 * built index is read without scanning the collection).
 */
import { createFindByConformanceTests } from "@flow-state-dev/engine/testing";
import { createSQLiteStores } from "../src/host";

createFindByConformanceTests({
  name: "SQLite stores",
  indexes: true,
  createStores: () => createSQLiteStores({ filename: ":memory:" }),
  cleanup: (stores) => (stores as ReturnType<typeof createSQLiteStores>).close(),
});
