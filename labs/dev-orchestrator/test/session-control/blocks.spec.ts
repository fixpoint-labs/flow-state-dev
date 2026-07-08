/**
 * Business-logic tests for the session-control actions, run via `testBlock`
 * against the raw handlers (no MCP/HTTP transport involved — see mcp.spec.ts
 * for the transport-level proof). Covers the registration binding rule and
 * the capability-token authorization gate described in
 * docs/session-telemetry-mcp.md § Security.
 */
import { describe, expect, it } from "vitest";
import { testBlock } from "@flow-state-dev/testing";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import { createInMemorySessionRegistryStore } from "../../src/session-control/registry";
import { buildRegisterSession } from "../../src/session-control/blocks/register-session";
import { buildReportStatus } from "../../src/session-control/blocks/report-status";
import type { RegisterSessionOutput, ReportStatusOutput } from "../../src/session-control/schemas";

/** In-memory Linear fake — mirrors test/signals/linear.spec.ts's fakeTransport. */
function fakeLinear() {
  let state: string | null = null;
  const setCalls: string[] = [];
  const transport: LinearTransport = {
    async getIssueState() {
      return state;
    },
    async setIssueState(_issueId, stateName) {
      setCalls.push(stateName);
      state = stateName;
    },
    async comment() {},
  };
  return { client: new LinearStatusClient(transport), setCalls };
}

describe("registerSession", () => {
  it("first sight binds sessionId to issue and returns a capability token", async () => {
    const registry = createInMemorySessionRegistryStore();
    const block = buildRegisterSession(registry);
    const { output, error } = await testBlock(block, {
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
    });
    expect(error).toBeNull();
    const result = output as RegisterSessionOutput;
    expect(result.capabilityToken.length).toBeGreaterThan(0);

    const row = await registry.get("s1");
    expect(row?.issue).toBe("FIX-1");
    expect(row?.capabilityToken).toBe(result.capabilityToken);
  });

  it("re-registering the same sessionId for the same issue is idempotent and keeps the same token", async () => {
    const registry = createInMemorySessionRegistryStore();
    const block = buildRegisterSession(registry);
    const first = await testBlock(block, { input: { sessionId: "s1", issue: "FIX-1", stage: "spec" } });
    const second = await testBlock(block, { input: { sessionId: "s1", issue: "FIX-1", stage: "spec" } });
    expect(second.error).toBeNull();
    expect((second.output as RegisterSessionOutput).capabilityToken).toBe(
      (first.output as RegisterSessionOutput).capabilityToken,
    );
  });

  it("rejects re-registering the same sessionId under a different issue", async () => {
    const registry = createInMemorySessionRegistryStore();
    const block = buildRegisterSession(registry);
    await testBlock(block, { input: { sessionId: "s1", issue: "FIX-1", stage: "spec" } });
    const { error } = await testBlock(block, { input: { sessionId: "s1", issue: "FIX-2", stage: "spec" } });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/already registered to issue "FIX-1"/);
  });
});

describe("reportStatus", () => {
  it("rejects a sessionId that was never registered", async () => {
    const registry = createInMemorySessionRegistryStore();
    const { client: board } = fakeLinear();
    const block = buildReportStatus(registry, board);
    const { error } = await testBlock(block, {
      input: { sessionId: "unknown", capabilityToken: "whatever", status: "working" },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not registered/);
  });

  it("rejects a mismatched capability token and does not touch the board", async () => {
    const registry = createInMemorySessionRegistryStore();
    await testBlock(buildRegisterSession(registry), {
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
    });

    const { client: board, setCalls } = fakeLinear();
    const { error } = await testBlock(buildReportStatus(registry, board), {
      input: { sessionId: "s1", capabilityToken: "wrong-token", status: "done" },
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/Invalid capability token/);
    expect(setCalls).toHaveLength(0);
  });

  it("valid token: updates the registry and asserts the mapped board state", async () => {
    const registry = createInMemorySessionRegistryStore();
    const { output } = await testBlock(buildRegisterSession(registry), {
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
    });
    const { capabilityToken } = output as RegisterSessionOutput;

    const { client: board, setCalls } = fakeLinear();
    const { output: reportOutput, error } = await testBlock(buildReportStatus(registry, board), {
      input: { sessionId: "s1", capabilityToken, status: "done" },
    });
    expect(error).toBeNull();
    expect((reportOutput as ReportStatusOutput).acknowledged).toBe(true);
    expect(setCalls).toEqual(["In Spec Review"]);

    const row = await registry.get("s1");
    expect(row?.status).toBe("done");
  });

  it("a status with no mapped board state updates the registry but makes no board write", async () => {
    const registry = createInMemorySessionRegistryStore();
    const { output } = await testBlock(buildRegisterSession(registry), {
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
    });
    const { capabilityToken } = output as RegisterSessionOutput;

    const { client: board, setCalls } = fakeLinear();
    const { error } = await testBlock(buildReportStatus(registry, board), {
      input: { sessionId: "s1", capabilityToken, status: "working" },
    });
    expect(error).toBeNull();
    expect(setCalls).toHaveLength(0);

    const row = await registry.get("s1");
    expect(row?.status).toBe("working");
  });
});
