/**
 * The package root is for app authors: the adapter factory `createFlowState`
 * takes and the schedule index. Everything a host or adapter author builds
 * with (the registry factory, the per-store constructors, the schema and
 * transaction helpers) is one import away on `@flow-state-dev/store-postgres/host`.
 * Importing either entry opens no connection.
 */
import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as host from "../src/host";

const HOST_RUNTIME_NAMES = [
  "createPgPoolTx",
  "createPostgresActiveRequestRegistry",
  "createPostgresCheckpointStore",
  "createPostgresContentStore",
  "createPostgresLeaseStore",
  "createPostgresOrgStore",
  "createPostgresRequestStore",
  "createPostgresResourceStateStore",
  "createPostgresSessionStore",
  "createPostgresStores",
  "createPostgresSuspensionStore",
  "createPostgresUserStore",
  "createPostgresWakeStore",
  "initializeSchema"
];

describe("@flow-state-dev/store-postgres entries", () => {
  it("roots the adapter factory and the schedule index, and nothing else", () => {
    expect(Object.keys(root).sort()).toEqual(["createPostgresScheduleIndex", "postgresStores"]);
  });

  it("carries every other runtime name on ./host", () => {
    expect(Object.keys(host).sort()).toEqual(HOST_RUNTIME_NAMES);
  });
});
