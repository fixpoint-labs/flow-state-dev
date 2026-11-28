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

describe("a session deleted and made again, for someone else, while a page is read (memory)", () => {
  it("never answers the new session's rows under the old one's owner", async () => {
    const { session: sessions } = createInMemoryStores();
    const record = (userId: string, createdAt: number) =>
      ({ id: "s", flowKind: "f", flowId: "f", userId, orgId: "acme", state: {}, version: 0, createdAt, updatedAt: createdAt, journal: [] }) as never;
    await sessions.set("s", record("alice", 1), "absent");
    const store = createInMemoryResourceStateStore({
      sessions: {
        // The listing answers alice's session; before its rows are read, it is
        // deleted and made again for bob, who writes his own.
        list: async (options) => {
          const listed = await sessions.list(options);
          await sessions.delete("s");
          await sessions.set("s", record("bob", 2), "absent");
          await store.set("session", "s", "notes/bobs", { text: "bob's" }, "any");
          return listed;
        },
        get: (key) => sessions.get(key)
      }
    });
    const rows = await store.listAcrossSessions!({ owner: { userId: "alice", tenantId: undefined, orgId: "acme" }, keyPrefix: "notes/", limit: 10 });
    expect(rows).toEqual([]);
  });
});

afterAll(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});
