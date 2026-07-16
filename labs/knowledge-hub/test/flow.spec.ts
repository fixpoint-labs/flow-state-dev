// Flow smoke test (FIX-882): the knowledge-hub flow registers and its capture →
// read-back round-trip runs through the real `runAction` engine, plus the
// fail-closed auth guarantee (behaviour 10) — with KH_MCP_SECRET unset the
// flow's `resolvePrincipal` throws, so every HTTP transport is closed, while the
// in-process CLI/testFlow path (which supplies the principal directly) is
// unaffected.

import { describe, expect, it, vi } from "vitest";
import { testFlow } from "@flow-state-dev/testing";
import knowledgeHubFlow from "../src/flow";

describe("knowledge-hub flow", () => {
  it("captures an activity and reads it back", async () => {
    const stores = undefined; // fresh in-memory store per testFlow call is fine here
    const capture = await testFlow({
      flow: knowledgeHubFlow,
      action: "logActivity",
      userId: "cli-user",
      input: { kind: "thought", content: "hello hub", context: "smoke test", contextId: "kctx_smoke" },
      stores,
    });
    expect(capture.status).toBe("completed");
    expect(capture.output).toMatchObject({ deduplicated: false });
  });

  it("fails closed over HTTP: resolvePrincipal throws when KH_MCP_SECRET is unset (behaviour 10)", async () => {
    const prevSecret = process.env.KH_MCP_SECRET;
    delete process.env.KH_MCP_SECRET;
    vi.resetModules();
    try {
      const freshFlow = (await import("../src/flow")).default;
      const resolver = freshFlow.authentication?.resolvePrincipal;
      expect(resolver).toBeDefined();
      expect(() =>
        resolver!({
          source: "mcp",
          envelope: { flowKind: "knowledge-hub", action: "logActivity", input: {} },
        })
      ).toThrow(/KH_MCP_SECRET/);
    } finally {
      if (prevSecret === undefined) delete process.env.KH_MCP_SECRET;
      else process.env.KH_MCP_SECRET = prevSecret;
      vi.resetModules();
    }
  });
});
