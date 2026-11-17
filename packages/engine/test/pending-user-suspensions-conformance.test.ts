// FIX-2770.
/**
 * The pending-asks read's conformance on the stores the engine ships: memory
 * and filesystem, each built by its registry factory, which hands the
 * suspension store the request store it joins to. SQLite and Postgres run the
 * same cases in their own packages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "../src/stores";
import { createInMemorySuspensionStore } from "../src/stores/memory/suspension-store";
import { createFilesystemSuspensionStore } from "../src/stores/filesystem/suspension-store";
import { FlowStateConfigError } from "../src/errors/flow-error";
import { createPendingUserSuspensionsConformanceTests } from "../src/testing";

createPendingUserSuspensionsConformanceTests({
  name: "memory",
  createStore: () => {
    const stores = createInMemoryStores();
    return { suspensions: stores.suspensions, requests: stores.request };
  }
});

const tempDirs: string[] = [];

createPendingUserSuspensionsConformanceTests({
  name: "filesystem",
  createStore: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-pending-asks-"));
    tempDirs.push(dir);
    const stores = createFilesystemStores({ rootDir: dir, developmentOnly: true });
    return { suspensions: stores.suspensions, requests: stores.request };
  }
});

describe("a suspension store built without the request store it joins to", () => {
  const query = { userId: "alice", tenantId: undefined, orgId: "acme", flowKinds: ["worker"], now: 0, limit: 200 };

  it("refuses the read with a config error naming the option, rather than answering nothing (memory)", async () => {
    await expect(createInMemorySuspensionStore().listPendingForUser(query)).rejects.toThrow(FlowStateConfigError);
    await expect(createInMemorySuspensionStore().listPendingForUser(query)).rejects.toThrow(/requests/);
  });

  it("refuses the read with a config error naming the option, rather than answering nothing (filesystem)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-pending-asks-bare-"));
    tempDirs.push(dir);
    await expect(createFilesystemSuspensionStore(dir).listPendingForUser(query)).rejects.toThrow(/requests/);
  });
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
