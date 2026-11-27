/**
 * The read across an owner's sessions, store half, on the stores the engine
 * ships: memory and filesystem, each built by its registry factory, which
 * hands the resource-state store the session store it joins to. SQLite and
 * Postgres run the same cases in their own packages.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFilesystemStores, createInMemoryStores } from "../src/stores";
import { createInMemoryResourceStateStore } from "../src/stores/memory/resource-state-store";
import { createFilesystemResourceStateStore } from "../src/stores/filesystem/resource-state-store";
import { FlowStateConfigError } from "../src/errors/flow-error";
import { createAcrossSessionsConformanceTests } from "../src/testing";

createAcrossSessionsConformanceTests({
  name: "memory",
  createStore: () => {
    const stores = createInMemoryStores();
    return { resourceState: stores.resourceState, sessions: stores.session };
  }
});

const tempDirs: string[] = [];

createAcrossSessionsConformanceTests({
  name: "filesystem",
  createStore: async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-across-sessions-"));
    tempDirs.push(dir);
    const stores = createFilesystemStores({ rootDir: dir, developmentOnly: true });
    return { resourceState: stores.resourceState, sessions: stores.session };
  }
});

describe("a resource-state store built without the session store it joins to", () => {
  const query = { owner: { userId: "alice", tenantId: undefined, orgId: "acme" }, keyPrefix: "notes/", limit: 10 };

  it("refuses the read with a config error naming the option, rather than answering nothing (memory)", async () => {
    const store = createInMemoryResourceStateStore();
    await expect(store.listAcrossSessions!(query)).rejects.toThrow(FlowStateConfigError);
    await expect(store.listAcrossSessions!(query)).rejects.toThrow(/sessions/);
  });

  it("refuses the read with a config error naming the option, rather than answering nothing (filesystem)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fsd-across-sessions-bare-"));
    tempDirs.push(dir);
    await expect(createFilesystemResourceStateStore(dir).listAcrossSessions!(query)).rejects.toThrow(/sessions/);
  });
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
