import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryActiveRequestRegistry } from "../src/stores/memory/active-request-registry";
import { createFilesystemActiveRequestRegistry } from "../src/stores/filesystem/active-request-registry";
import type { ActiveRequestEntry, ActiveRequestRegistry } from "../src/stores/types";

function makeEntry(overrides?: Partial<ActiveRequestEntry>): ActiveRequestEntry {
  return {
    requestId: "req_test_1",
    flowKind: "chat",
    actionName: "run",
    userId: "user_1",
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    ...overrides
  };
}

function runRegistryTests(
  name: string,
  createRegistry: () => Promise<{ registry: ActiveRequestRegistry; cleanup?: () => Promise<void> }>
) {
  describe(name, () => {
    let registry: ActiveRequestRegistry;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const result = await createRegistry();
      registry = result.registry;
      cleanup = result.cleanup;
    });

    afterEach(async () => {
      await cleanup?.();
    });

    it("registers and retrieves an entry", async () => {
      const entry = makeEntry();
      await registry.register(entry);

      const retrieved = await registry.get("req_test_1");
      expect(retrieved).toBeDefined();
      expect(retrieved!.requestId).toBe("req_test_1");
      expect(retrieved!.flowKind).toBe("chat");
      expect(retrieved!.actionName).toBe("run");
    });

    it("heartbeat updates lastHeartbeatAt", async () => {
      const entry = makeEntry({ lastHeartbeatAt: 1000 });
      await registry.register(entry);

      await registry.heartbeat("req_test_1");

      const updated = await registry.get("req_test_1");
      expect(updated!.lastHeartbeatAt).toBeGreaterThan(1000);
    });

    it("deregister removes entry", async () => {
      await registry.register(makeEntry());
      await registry.deregister("req_test_1");

      const result = await registry.get("req_test_1");
      expect(result).toBeUndefined();
    });

    it("deregister on non-existent entry is a no-op", async () => {
      // Should not throw
      await registry.deregister("nonexistent");
    });

    it("double deregister is safe", async () => {
      await registry.register(makeEntry());
      await registry.deregister("req_test_1");
      await registry.deregister("req_test_1");

      expect(await registry.get("req_test_1")).toBeUndefined();
    });

    it("listStale returns entries older than threshold", async () => {
      const old = makeEntry({
        requestId: "req_old",
        lastHeartbeatAt: Date.now() - 60_000
      });
      const recent = makeEntry({
        requestId: "req_recent",
        lastHeartbeatAt: Date.now()
      });

      await registry.register(old);
      await registry.register(recent);

      const stale = await registry.listStale(30_000);
      expect(stale).toHaveLength(1);
      expect(stale[0].requestId).toBe("req_old");
    });

    it("listStale does NOT return entries within threshold", async () => {
      await registry.register(makeEntry({
        lastHeartbeatAt: Date.now()
      }));

      const stale = await registry.listStale(30_000);
      expect(stale).toHaveLength(0);
    });

    it("listAll returns all entries", async () => {
      await registry.register(makeEntry({ requestId: "req_1" }));
      await registry.register(makeEntry({ requestId: "req_2" }));

      const all = await registry.listAll();
      expect(all).toHaveLength(2);
    });

    it("handles multiple concurrent requests", async () => {
      await registry.register(makeEntry({ requestId: "req_a", actionName: "run" }));
      await registry.register(makeEntry({ requestId: "req_b", actionName: "submit" }));

      const a = await registry.get("req_a");
      const b = await registry.get("req_b");
      expect(a!.actionName).toBe("run");
      expect(b!.actionName).toBe("submit");

      await registry.deregister("req_a");
      expect(await registry.get("req_a")).toBeUndefined();
      expect(await registry.get("req_b")).toBeDefined();
    });
  });
}

runRegistryTests("InMemoryActiveRequestRegistry", async () => ({
  registry: createInMemoryActiveRequestRegistry()
}));

runRegistryTests("FilesystemActiveRequestRegistry", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "fsd-registry-"));
  return {
    registry: createFilesystemActiveRequestRegistry({ directory: tempDir }),
    cleanup: () => rm(tempDir, { recursive: true, force: true })
  };
});
