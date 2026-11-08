/**
 * Engine's root carries the store adapters an app hands `createFlowState`
 * (`inMemoryStores`, `filesystemStores`). The registry factories and the
 * per-store constructors a host or adapter author builds with are on
 * `@flow-state-dev/engine/host`, the same rule the store packages follow.
 */
import { describe, expect, it } from "vitest";
import * as root from "../src";
import * as host from "../src/host";

const STORE_NAME = /^(create(InMemory|Filesystem)\w*(Store|Stores|Registry)|inMemoryStores|filesystemStores)$/;

const MOVED = [
  "createFilesystemContentStore",
  "createFilesystemOrgStore",
  "createFilesystemRequestStore",
  "createFilesystemResourceStateStore",
  "createFilesystemSessionStore",
  "createFilesystemStores",
  "createFilesystemTraceStore",
  "createFilesystemUserStore",
  "createFilesystemWakeStore",
  "createInMemoryContentStore",
  "createInMemoryLeaseStore",
  "createInMemoryOrgStore",
  "createInMemoryRequestStore",
  "createInMemoryResourceStateStore",
  "createInMemorySessionStore",
  "createInMemoryStores",
  "createInMemorySuspensionStore",
  "createInMemoryTraceStore",
  "createInMemoryUserStore",
  "createInMemoryWakeStore"
];

describe("engine's store names", () => {
  it("roots only the two adapters an app hands createFlowState", () => {
    expect(Object.keys(root).filter((n) => STORE_NAME.test(n)).sort()).toEqual(["filesystemStores", "inMemoryStores"]);
  });

  it("carries the registry factories and per-store constructors on engine/host", () => {
    const onHost = Object.keys(host).filter((n) => STORE_NAME.test(n)).sort();
    expect(onHost).toEqual(MOVED);
  });
});
