import { afterEach, describe, expect, it } from "vitest";
import type {
  ProjectRecord,
  RequestRecord,
  SessionRecord,
  UserRecord
} from "@flow-state-dev/server";
import { createSQLiteStores, type SQLiteStoreRegistry } from "../src";

function now() {
  return Date.now();
}

function makeSessionRecord(
  id: string,
  flowKind: string,
  userId: string,
  overrides?: Partial<SessionRecord>
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
    ...overrides
  };
}

function makeRequestRecord(
  id: string,
  flowKind: string,
  actionName: string,
  userId: string,
  sessionId?: string,
  overrides?: Partial<RequestRecord>
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
    updatedAt: ts,
    ...overrides
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

describe("SQLite store adapter", () => {
  let stores: SQLiteStoreRegistry;

  afterEach(() => {
    stores?.close();
  });

  function freshStores(): SQLiteStoreRegistry {
    stores = createSQLiteStores({ filename: ":memory:" });
    return stores;
  }

  // --- Schema ---

  it("initializes schema idempotently", () => {
    const s = freshStores();
    // calling createSQLiteStores again on same DB would re-run CREATE IF NOT EXISTS
    // but we can verify tables exist by running operations
    expect(s.session).toBeDefined();
    expect(s.request).toBeDefined();
    expect(s.user).toBeDefined();
    expect(s.project).toBeDefined();
    expect(s.activeRequests).toBeDefined();
  });

  // --- Session Store ---

  describe("session store", () => {
    it("set then get returns the record", async () => {
      const s = freshStores();
      const record = makeSessionRecord("sess_1", "flow-a", "user_1");
      await s.session.set("sess_1", record);

      const result = await s.session.get("sess_1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("sess_1");
      expect(result!.flowKind).toBe("flow-a");
      expect(result!.userId).toBe("user_1");
      expect(result!.journal).toEqual([]);
    });

    it("get non-existent returns undefined", async () => {
      const s = freshStores();
      expect(await s.session.get("nope")).toBeUndefined();
    });

    it("upsert updates record", async () => {
      const s = freshStores();
      const record = makeSessionRecord("sess_1", "flow-a", "user_1");
      await s.session.set("sess_1", record);

      const updated = { ...record, version: 1, updatedAt: now() + 100 };
      await s.session.set("sess_1", updated);

      const result = await s.session.get("sess_1");
      expect(result!.version).toBe(1);
    });

    it("delete removes record", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"));
      await s.session.delete("sess_1");
      expect(await s.session.get("sess_1")).toBeUndefined();
    });

    it("delete non-existent is a no-op", async () => {
      const s = freshStores();
      await s.session.delete("nope"); // should not throw
    });

    it("list returns all records sorted by updatedAt desc", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1", { updatedAt: 100 }));
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2", { updatedAt: 300 }));
      await s.session.set("sess_3", makeSessionRecord("sess_3", "flow-a", "user_1", { updatedAt: 200 }));

      const all = await s.session.list();
      expect(all).toHaveLength(3);
      expect(all[0]!.id).toBe("sess_2");
      expect(all[1]!.id).toBe("sess_3");
      expect(all[2]!.id).toBe("sess_1");
    });

    it("list filters by flowKind", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"));
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"));

      const result = await s.session.list({ flowKind: "flow-a" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list filters by userId", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"));
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-b", "user_2"));

      const result = await s.session.list({ userId: "user_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("sess_1");
    });

    it("list with limit and offset", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1", { updatedAt: 100 }));
      await s.session.set("sess_2", makeSessionRecord("sess_2", "flow-a", "user_1", { updatedAt: 200 }));
      await s.session.set("sess_3", makeSessionRecord("sess_3", "flow-a", "user_1", { updatedAt: 300 }));

      const page = await s.session.list({ limit: 1, offset: 1 });
      expect(page).toHaveLength(1);
      expect(page[0]!.id).toBe("sess_2");
    });

    it("list with offset beyond total returns empty", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"));
      expect(await s.session.list({ offset: 100 })).toHaveLength(0);
    });

    it("list with limit 0 returns empty", async () => {
      const s = freshStores();
      await s.session.set("sess_1", makeSessionRecord("sess_1", "flow-a", "user_1"));
      expect(await s.session.list({ limit: 0 })).toHaveLength(0);
    });
  });

  // --- Request Store ---

  describe("request store", () => {
    it("set then get returns the record", async () => {
      const s = freshStores();
      const record = makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1");
      await s.request.set("req_1", record);

      const result = await s.request.get("req_1");
      expect(result).toBeDefined();
      expect(result!.id).toBe("req_1");
      expect(result!.actionName).toBe("run");
      expect(result!.status).toBe("in_progress");
    });

    it("filters by flowKind", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"));
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-b", "run", "user_1"));

      expect(await s.request.list({ flowKind: "flow-a" })).toHaveLength(1);
    });

    it("filters by sessionId", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", "sess_1"));
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", "sess_2"));

      const result = await s.request.list({ sessionId: "sess_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("filters by userId", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"));
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_2"));

      expect(await s.request.list({ userId: "user_1" })).toHaveLength(1);
    });

    it("filters by status", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "completed" }));
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }));

      const result = await s.request.list({ status: "completed" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
    });

    it("filters by status interrupted", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1", undefined, { status: "interrupted", interruptedAt: Date.now() }));
      await s.request.set("req_2", makeRequestRecord("req_2", "flow-a", "run", "user_1", undefined, { status: "in_progress" }));

      const result = await s.request.list({ status: "interrupted" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("req_1");
      expect(result[0]!.interruptedAt).toBeDefined();
    });

    it("delete removes and is no-op for non-existent", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"));
      await s.request.delete("req_1");
      expect(await s.request.get("req_1")).toBeUndefined();
      await s.request.delete("nope"); // should not throw
    });

    it("persistItems updates items on the record", async () => {
      const s = freshStores();
      await s.request.set("req_1", makeRequestRecord("req_1", "flow-a", "run", "user_1"));

      const items = [
        { kind: "text" as const, content: "hello", sequenceNumber: 1 }
      ];
      s.request.persistItems("req_1", items);
      await s.request.flushItems("req_1");

      // Allow microtask to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const result = await s.request.get("req_1");
      expect(result!.items).toBeDefined();
      expect(result!.items).toHaveLength(1);
      expect((result!.items![0] as { content: string }).content).toBe("hello");
    });
  });

  // --- User Store ---

  describe("user store", () => {
    it("CRUD operations", async () => {
      const s = freshStores();
      await s.user.set("user_1", makeUserRecord("user_1"));

      const result = await s.user.get("user_1");
      expect(result).toBeDefined();
      expect(result!.userId).toBe("user_1");

      await s.user.delete("user_1");
      expect(await s.user.get("user_1")).toBeUndefined();
    });

    it("list returns all sorted by updatedAt desc", async () => {
      const s = freshStores();
      await s.user.set("u1", { ...makeUserRecord("u1"), updatedAt: 100 });
      await s.user.set("u2", { ...makeUserRecord("u2"), updatedAt: 300 });

      const all = await s.user.list();
      expect(all).toHaveLength(2);
      expect(all[0]!.id).toBe("u2");
    });
  });

  // --- Project Store ---

  describe("project store", () => {
    it("CRUD operations", async () => {
      const s = freshStores();
      await s.project.set("proj_1", makeProjectRecord("proj_1", "user_1"));

      const result = await s.project.get("proj_1");
      expect(result).toBeDefined();
      expect(result!.projectId).toBe("proj_1");
      expect(result!.userId).toBe("user_1");

      await s.project.delete("proj_1");
      expect(await s.project.get("proj_1")).toBeUndefined();
    });

    it("list filters by userId", async () => {
      const s = freshStores();
      await s.project.set("proj_1", makeProjectRecord("proj_1", "user_1"));
      await s.project.set("proj_2", makeProjectRecord("proj_2", "user_2"));

      const result = await s.project.list({ userId: "user_1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("proj_1");
    });
  });

  // --- Active Request Registry ---

  describe("active request registry", () => {
    it("register then get returns the entry", async () => {
      const s = freshStores();
      const entry = {
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      };
      await s.activeRequests.register(entry);

      const result = await s.activeRequests.get("req_1");
      expect(result).toBeDefined();
      expect(result!.requestId).toBe("req_1");
      expect(result!.flowKind).toBe("flow-a");
    });

    it("get non-existent returns undefined", async () => {
      const s = freshStores();
      expect(await s.activeRequests.get("nope")).toBeUndefined();
    });

    it("heartbeat updates lastHeartbeatAt", async () => {
      const s = freshStores();
      const startTime = Date.now() - 10000;
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: startTime,
        lastHeartbeatAt: startTime
      });

      await s.activeRequests.heartbeat("req_1");
      const result = await s.activeRequests.get("req_1");
      expect(result!.lastHeartbeatAt).toBeGreaterThan(startTime);
    });

    it("heartbeat for non-existent is a no-op", async () => {
      const s = freshStores();
      await s.activeRequests.heartbeat("nope"); // should not throw
    });

    it("deregister removes the entry", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      await s.activeRequests.deregister("req_1");
      expect(await s.activeRequests.get("req_1")).toBeUndefined();
    });

    it("listStale returns entries older than threshold", async () => {
      const s = freshStores();
      const oldTime = Date.now() - 60000;
      const recentTime = Date.now();

      await s.activeRequests.register({
        requestId: "stale_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: oldTime,
        lastHeartbeatAt: oldTime
      });
      await s.activeRequests.register({
        requestId: "fresh_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: recentTime,
        lastHeartbeatAt: recentTime
      });

      const stale = await s.activeRequests.listStale(30000);
      expect(stale).toHaveLength(1);
      expect(stale[0]!.requestId).toBe("stale_1");
    });

    it("listAll returns all entries", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        userId: "user_1",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });
      await s.activeRequests.register({
        requestId: "req_2",
        flowKind: "flow-b",
        actionName: "act",
        userId: "user_2",
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const all = await s.activeRequests.listAll();
      expect(all).toHaveLength(2);
    });

    it("register with optional fields round-trips correctly", async () => {
      const s = freshStores();
      await s.activeRequests.register({
        requestId: "req_1",
        flowKind: "flow-a",
        actionName: "run",
        sessionId: "sess_1",
        userId: "user_1",
        projectId: "proj_1",
        input: { message: "hello" },
        metadata: { source: "test" },
        startedAt: Date.now(),
        lastHeartbeatAt: Date.now()
      });

      const result = await s.activeRequests.get("req_1");
      expect(result!.sessionId).toBe("sess_1");
      expect(result!.projectId).toBe("proj_1");
      expect(result!.input).toEqual({ message: "hello" });
      expect(result!.metadata).toEqual({ source: "test" });
    });
  });

  // --- Complex JSON round-trip ---

  it("complex nested JSON round-trips correctly", async () => {
    const s = freshStores();
    const record = makeSessionRecord("sess_complex", "flow-a", "user_1", {
      state: { nested: { deep: { value: 42 } }, arr: [1, 2, 3] } as Record<string, unknown>,
      resources: { "res-1": { name: "test", data: { x: 1 } } as Record<string, unknown> },
      resourceContent: { "res-1": "some content" },
      metadata: { tags: ["a", "b"], config: { key: "val" } }
    });

    await s.session.set("sess_complex", record);
    const result = await s.session.get("sess_complex");
    expect(result!.state).toEqual(record.state);
    expect(result!.resources).toEqual(record.resources);
    expect(result!.resourceContent).toEqual(record.resourceContent);
    expect(result!.metadata).toEqual(record.metadata);
  });

  // --- Drop-in replacement ---

  it("is a drop-in replacement for createInMemoryStores", async () => {
    const s = freshStores();

    // Same operations as the in-memory test in packages/server/test/stores.test.ts
    await s.session.set("sess_a", makeSessionRecord("sess_a", "flow-a", "user_1"));
    await s.session.set("sess_b", makeSessionRecord("sess_b", "flow-b", "user_2"));
    await s.request.set("req_a", makeRequestRecord("req_a", "flow-a", "run", "user_1", "sess_a"));
    await s.user.set("user_1", makeUserRecord("user_1"));
    await s.project.set("proj_1", makeProjectRecord("proj_1", "user_1"));

    const flowASessions = await s.session.list({ flowKind: "flow-a" });
    const user1Requests = await s.request.list({ userId: "user_1" });
    const userProjects = await s.project.list({ userId: "user_1" });

    expect(flowASessions).toHaveLength(1);
    expect(flowASessions[0]!.id).toBe("sess_a");
    expect(user1Requests).toHaveLength(1);
    expect(user1Requests[0]!.id).toBe("req_a");
    expect(userProjects).toHaveLength(1);
    expect((await s.user.get("user_1"))?.userId).toBe("user_1");

    await s.session.delete("sess_b");
    expect(await s.session.get("sess_b")).toBeUndefined();
  });

  // --- Request Event Persistence ---

  describe("request event persistence", () => {
    it("persists and retrieves events in sequence order", async () => {
      const s = freshStores();
      const requestId = "req_events_1";
      await s.request.set(requestId, makeRequestRecord(requestId, "flow-a", "ask", "user_1"));

      const events = [
        {
          stream: "request" as const,
          type: "request.created" as const,
          requestId,
          sequence_number: 1,
          status: "in_progress" as const,
          ts: 100
        },
        {
          stream: "request" as const,
          type: "item.added" as const,
          requestId,
          sequence_number: 2,
          ts: 101,
          item: { id: "item_0", type: "message" as const }
        },
        {
          stream: "request" as const,
          type: "request.completed" as const,
          requestId,
          sequence_number: 3,
          status: "completed" as const,
          ts: 102
        }
      ];

      s.request.persistEvents(requestId, events as any);

      // Allow microtask to flush
      await new Promise((r) => setTimeout(r, 10));

      const retrieved = await s.request.getEvents(requestId);
      expect(retrieved).toHaveLength(3);
      expect(retrieved.map((e: any) => e.sequence_number)).toEqual([1, 2, 3]);
      expect(retrieved[0]!.type).toBe("request.created");
      expect(retrieved[2]!.type).toBe("request.completed");
    });

    it("returns empty array for unknown request", async () => {
      const s = freshStores();
      const events = await s.request.getEvents("nonexistent");
      expect(events).toEqual([]);
    });

    it("overwrites events on re-persist", async () => {
      const s = freshStores();
      const requestId = "req_overwrite";
      await s.request.set(requestId, makeRequestRecord(requestId, "flow-a", "ask", "user_1"));

      s.request.persistEvents(requestId, [
        { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 }
      ] as any);

      // Wait for microtask
      await s.request.flushEvents(requestId);

      s.request.persistEvents(requestId, [
        { stream: "request", type: "request.created", requestId, sequence_number: 1, status: "in_progress", ts: 100 },
        { stream: "request", type: "request.completed", requestId, sequence_number: 2, status: "completed", ts: 200 }
      ] as any);

      await s.request.flushEvents(requestId);

      const events = await s.request.getEvents(requestId);
      expect(events).toHaveLength(2);
    });
  });
});
