/**
 * Conformance tests for RequestListOptions.orderBy (FIX-685 Slice C) across
 * the server-internal request stores (memory, filesystem). `orderBy:
 * "startedAtMs"` must order by start time independent of later metadata
 * writes, and must apply before limit so a windowed read selects the
 * most-recently-started requests.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRequestStore } from "../src/stores/memory/request-store";
import { createFilesystemRequestStore } from "../src/stores/filesystem/request-store";
import type { RequestRecord, RequestStore } from "../src/stores/types";

function record(id: string, startedAtMs: number, updatedAt: number): RequestRecord {
  return {
    id,
    flowKind: "flow-a",
    actionName: "run",
    userId: "u1",
    sessionId: "s1",
    status: "completed",
    startedAtMs,
    state: {},
    version: 1,
    createdAt: startedAtMs,
    updatedAt
  };
}

function runOrderByTests(name: string, make: () => Promise<{ store: RequestStore; cleanup?: () => Promise<void> }>) {
  describe(name, () => {
    let cleanup: (() => Promise<void>) | undefined;
    afterEach(async () => {
      await cleanup?.();
      cleanup = undefined;
    });

    async function setup(): Promise<RequestStore> {
      const r = await make();
      cleanup = r.cleanup;
      return r.store;
    }

    it("orderBy startedAtMs orders by start time, not last update", async () => {
      const store = await setup();
      await store.set("req_old", record("req_old", 100, 999), "any");
      await store.set("req_new", record("req_new", 500, 200), "any");

      const byStarted = await store.list({ sessionId: "s1", orderBy: "startedAtMs" });
      expect(byStarted.map((r) => r.id)).toEqual(["req_new", "req_old"]);

      const byUpdated = await store.list({ sessionId: "s1" });
      expect(byUpdated.map((r) => r.id)).toEqual(["req_old", "req_new"]);
    });

    it("orderBy startedAtMs applies before limit", async () => {
      const store = await setup();
      for (let n = 1; n <= 3; n++) {
        await store.set(`req_${n}`, record(`req_${n}`, n * 100, n * 100), "any");
      }
      const windowed = await store.list({ sessionId: "s1", orderBy: "startedAtMs", limit: 2 });
      expect(windowed.map((r) => r.id)).toEqual(["req_3", "req_2"]);
    });
  });
}

runOrderByTests("InMemoryRequestStore", async () => ({ store: new InMemoryRequestStore() }));

runOrderByTests("FilesystemRequestStore", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "fsd-req-orderby-"));
  return {
    store: createFilesystemRequestStore({ rootDir }),
    cleanup: async () => {
      await rm(rootDir, { recursive: true, force: true });
    }
  };
});
