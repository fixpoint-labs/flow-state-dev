import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFilesystemStores,
  createInMemoryStores,
  type ProjectRecord,
  type RequestRecord,
  type SessionRecord,
  type UserRecord
} from "../src";

function now() {
  return Date.now();
}

function makeSessionRecord(
  id: string,
  flowKind: string,
  userId: string
): SessionRecord {
  const ts = now();
  return {
    id,
    flowKind,
    userId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    journal: [],
    items: [],
    messages: {
      ui: [],
      llm: []
    }
  };
}

function makeRequestRecord(
  id: string,
  flowKind: string,
  actionName: string,
  userId: string,
  sessionId?: string
): RequestRecord {
  const ts = now();
  return {
    id,
    flowKind,
    actionName,
    userId,
    sessionId,
    status: "in_progress",
    startedAtMs: ts,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

function makeUserRecord(id: string): UserRecord {
  const ts = now();
  return {
    id,
    userId: id,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

function makeProjectRecord(id: string, userId: string): ProjectRecord {
  const ts = now();
  return {
    id,
    projectId: id,
    userId,
    state: {},
    version: 0,
    createdAt: ts,
    updatedAt: ts
  };
}

describe("store adapters", () => {
  it("supports in-memory store CRUD and filtering", async () => {
    const stores = createInMemoryStores();

    await stores.session.set(
      "sess_a",
      makeSessionRecord("sess_a", "flow-a", "user_1")
    );
    await stores.session.set(
      "sess_b",
      makeSessionRecord("sess_b", "flow-b", "user_2")
    );

    await stores.request.set(
      "req_a",
      makeRequestRecord("req_a", "flow-a", "run", "user_1", "sess_a")
    );
    await stores.user.set("user_1", makeUserRecord("user_1"));
    await stores.project.set("proj_1", makeProjectRecord("proj_1", "user_1"));

    const flowASessions = await stores.session.list({ flowKind: "flow-a" });
    const user1Requests = await stores.request.list({ userId: "user_1" });
    const userProjects = await stores.project.list({ userId: "user_1" });

    expect(flowASessions).toHaveLength(1);
    expect(flowASessions[0]?.id).toBe("sess_a");
    expect(user1Requests).toHaveLength(1);
    expect(user1Requests[0]?.id).toBe("req_a");
    expect(userProjects).toHaveLength(1);
    expect((await stores.user.get("user_1"))?.userId).toBe("user_1");

    await stores.session.delete("sess_b");
    expect(await stores.session.get("sess_b")).toBeUndefined();
  });

  it("supports filesystem store persistence and list operations", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-server-store-"));

    try {
      const stores = createFilesystemStores({ rootDir });

      await stores.session.set(
        "sess_fs",
        makeSessionRecord("sess_fs", "flow-fs", "user_fs")
      );
      await stores.request.set(
        "req_fs",
        makeRequestRecord("req_fs", "flow-fs", "run", "user_fs", "sess_fs")
      );
      await stores.user.set("user_fs", makeUserRecord("user_fs"));
      await stores.project.set(
        "proj_fs",
        makeProjectRecord("proj_fs", "user_fs")
      );

      expect((await stores.session.get("sess_fs"))?.id).toBe("sess_fs");
      expect((await stores.request.get("req_fs"))?.id).toBe("req_fs");
      expect((await stores.user.get("user_fs"))?.id).toBe("user_fs");
      expect((await stores.project.get("proj_fs"))?.id).toBe("proj_fs");

      expect(await stores.session.list({ flowKind: "flow-fs" })).toHaveLength(1);
      expect(await stores.request.list({ sessionId: "sess_fs" })).toHaveLength(1);
      expect(await stores.project.list({ userId: "user_fs" })).toHaveLength(1);

      await stores.request.delete("req_fs");
      expect(await stores.request.get("req_fs")).toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
