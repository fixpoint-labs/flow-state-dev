import { describe, it, expect, vi } from "vitest";
import { createMcpManager } from "../../src/mcp/manager";
import { createMockClientFactory, fakeMcpTool, linearConfig } from "./fixtures";

describe("createMcpManager", () => {
  describe("config + connection baseline", () => {
    it("returns empty tools when no servers configured", async () => {
      const manager = createMcpManager({ servers: [] });
      expect(manager.getServerConfigs()).toEqual([]);
      expect(await manager.getTools()).toEqual([]);
    });

    it("exposes the configured servers via getServerConfigs", () => {
      const manager = createMcpManager({ servers: [linearConfig] });
      expect(manager.getServerConfigs()).toEqual([linearConfig]);
    });

    it("does not connect until getTools is called (lazy)", async () => {
      const { factory } = createMockClientFactory({
        linear: { t: fakeMcpTool("t", "Test") },
      });
      const factorySpy = vi.fn(factory);

      const manager = createMcpManager({
        servers: [linearConfig],
        _createClient: factorySpy,
      });
      expect(factorySpy).toHaveBeenCalledTimes(0);

      await manager.getTools();
      expect(factorySpy).toHaveBeenCalledTimes(1);
    });

    it("tracks connected server names after first getTools", async () => {
      const { factory } = createMockClientFactory({
        linear: { t: fakeMcpTool("t", "Test") },
      });
      const manager = createMcpManager({ servers: [linearConfig], _createClient: factory });

      expect(manager.getConnectedServerNames()).toEqual([]);
      await manager.getTools();
      expect(manager.getConnectedServerNames()).toEqual(["linear"]);
    });
  });
});
