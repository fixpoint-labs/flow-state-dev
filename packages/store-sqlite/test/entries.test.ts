/**
 * The package root is for app authors: the adapter factory `createFlowState`
 * takes and the schedule index. Everything a host or adapter author builds
 * with (the registry factory, the per-store constructors, the schema helpers)
 * is one import away on `@flow-state-dev/store-sqlite/host`.
 */
import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as host from "../src/host";

const HOST_RUNTIME_NAMES = [
  "applyConnectionPragmas",
  "createSQLiteActiveRequestRegistry",
  "createSQLiteCheckpointStore",
  "createSQLiteLeaseStore",
  "createSQLiteOrgStore",
  "createSQLiteRequestStore",
  "createSQLiteSessionStore",
  "createSQLiteStores",
  "createSQLiteSuspensionStore",
  "createSQLiteTraceStore",
  "createSQLiteUserStore",
  "createSQLiteWakeStore",
  "initializeSchema",
  "initializeSchemaDDL"
];

describe("@flow-state-dev/store-sqlite entries", () => {
  it("roots the adapter factory and the schedule index, and nothing else", () => {
    expect(Object.keys(root).sort()).toEqual(["createSQLiteScheduleIndex", "sqliteStores"]);
  });

  it("carries every other runtime name on ./host", () => {
    expect(Object.keys(host).sort()).toEqual(HOST_RUNTIME_NAMES);
  });
});
