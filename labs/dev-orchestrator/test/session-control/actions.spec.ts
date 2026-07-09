/**
 * Business-logic tests for the session-control actions, dispatched via
 * `runAction` directly against shared in-memory stores — no MCP/HTTP
 * transport involved (see mcp.spec.ts for the transport-level proof).
 * Mirrors test/flow/spec-stage.spec.ts's pattern: real runtime, fake
 * external deps, two separate `runAction` calls sharing one `stores` so the
 * user-scoped registry resource persists between registerSession and
 * reportStatus exactly as it would across two separate MCP `tools/call`s.
 *
 * `runAction` takes `userId` directly (bypassing the transport-level
 * `resolvePrincipal`), so every call here passes the same fixed userId the
 * flow's own resolver would produce — see registry.ts for why that's what
 * makes the registry persist across calls at all.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores, runAction } from "@flow-state-dev/server";
import { LinearStatusClient, type LinearTransport } from "../../src/signals/linear";
import { buildSessionControlFlow } from "../../src/session-control/flow";
import { noModelResolver } from "../../src/no-model-resolver";
import type { RegisterSessionOutput, ReportStatusOutput } from "../../src/session-control/schemas";

const USER_ID = "session-control";

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

function buildHarness() {
  const { client: board, setCalls } = fakeLinear();
  const flow = buildSessionControlFlow({ board });
  const stores = createInMemoryStores();
  const runtimeConfig = { modelResolver: noModelResolver };
  return { flow, stores, runtimeConfig, setCalls };
}

describe("registerSession", () => {
  it("first sight binds sessionId to issue and returns a capability token", async () => {
    const { flow, stores, runtimeConfig } = buildHarness();
    const result = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeUndefined();
    const output = result.output as RegisterSessionOutput;
    expect(output.capabilityToken.length).toBeGreaterThan(0);
  });

  it("re-registering the same sessionId for the same issue is idempotent and keeps the same token", async () => {
    const { flow, stores, runtimeConfig } = buildHarness();
    const first = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    const second = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(second.error).toBeUndefined();
    expect((second.output as RegisterSessionOutput).capabilityToken).toBe(
      (first.output as RegisterSessionOutput).capabilityToken,
    );
  });

  it("rejects re-registering the same sessionId under a different issue", async () => {
    const { flow, stores, runtimeConfig } = buildHarness();
    await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    const result = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-2", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toMatch(/already registered to issue "FIX-1"/);
  });
});

describe("reportStatus", () => {
  it("rejects a sessionId that was never registered", async () => {
    const { flow, stores, runtimeConfig } = buildHarness();
    const result = await runAction({
      flow,
      actionName: "reportStatus",
      input: { sessionId: "unknown", capabilityToken: "whatever", status: "working" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toMatch(/not registered/);
  });

  it("rejects a mismatched capability token and does not touch the board", async () => {
    const { flow, stores, runtimeConfig, setCalls } = buildHarness();
    await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });

    const result = await runAction({
      flow,
      actionName: "reportStatus",
      input: { sessionId: "s1", capabilityToken: "wrong-token", status: "done" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeDefined();
    expect((result.error as Error).message).toMatch(/Invalid capability token/);
    expect(setCalls).toHaveLength(0);
  });

  it("valid token: updates the registry and asserts the mapped board state", async () => {
    const { flow, stores, runtimeConfig, setCalls } = buildHarness();
    const registered = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    const { capabilityToken } = registered.output as RegisterSessionOutput;

    const result = await runAction({
      flow,
      actionName: "reportStatus",
      input: { sessionId: "s1", capabilityToken, status: "done" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeUndefined();
    expect((result.output as ReportStatusOutput).acknowledged).toBe(true);
    expect(setCalls).toEqual(["In Spec Review"]);
  });

  it("a status with no mapped board state updates the registry but makes no board write", async () => {
    const { flow, stores, runtimeConfig, setCalls } = buildHarness();
    const registered = await runAction({
      flow,
      actionName: "registerSession",
      input: { sessionId: "s1", issue: "FIX-1", stage: "spec" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    const { capabilityToken } = registered.output as RegisterSessionOutput;

    const result = await runAction({
      flow,
      actionName: "reportStatus",
      input: { sessionId: "s1", capabilityToken, status: "working" },
      userId: USER_ID,
      stores,
      runtimeConfig,
    });
    expect(result.error).toBeUndefined();
    expect(setCalls).toHaveLength(0);
  });
});
