/**
 * Smoke tests for the kitchen-sink app's MCP env shorthand. Exhaustive logic
 * tests for the manager, capability, and filter live in @flow-state-dev/tools/mcp.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("kitchen-sink mcp shorthand", () => {
  let prior: string | undefined;

  beforeEach(() => {
    prior = process.env.LINEAR_MCP_API_KEY;
    delete process.env.LINEAR_MCP_API_KEY;
    // Force lib/mcp to re-evaluate with the current env on each import.
    vi.resetModules();
  });

  afterEach(() => {
    setEnv("LINEAR_MCP_API_KEY", prior);
  });

  it("exports null when LINEAR_MCP_API_KEY is unset", async () => {
    const mod = await import("../lib/mcp");
    expect(mod.mcpCapability).toBeNull();
  });

  it("exports a named capability when LINEAR_MCP_API_KEY is set", async () => {
    setEnv("LINEAR_MCP_API_KEY", "test-key");
    vi.resetModules();
    const mod = await import("../lib/mcp");
    expect(mod.mcpCapability).not.toBeNull();
    expect((mod.mcpCapability as any).name).toBe("mcp");
  });
});
