import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  runAction,
  SuspensionRejectedError,
  SuspensionTimeoutError,
  resetSuspensionRegistry,
  getSuspension,
  getRequestSuspensions,
} from "../src";
import { parseFlowRoute } from "../src/routes/parseFlowRoute";
import { handleResumeRequest } from "../src/routes/resume-routes";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import type { OutputItem } from "@flow-state-dev/core/items";

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockStores() {
  return createInMemoryStores();
}

function createMockEmitter(requestId: string) {
  const items: OutputItem[] = [];
  const emitter = createResponseEmitter({ requestId });

  // Capture items as they're emitted.
  emitter.addEventObserver((event) => {
    if (event.type === "item.added" && "item" in event) {
      items.push((event as any).item);
    }
    if (event.type === "item.done" && "item" in event) {
      const idx = items.findIndex((i) => i.id === (event as any).item.id);
      if (idx >= 0) items[idx] = (event as any).item;
    }
  });

  return { emitter, items };
}

// ── Route parsing tests ────────────────────────────────────────────────────

describe("parseFlowRoute — resume route", () => {
  it("parses resume_request route", () => {
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "req_1", "resume"
    ]);

    expect(route).toEqual({
      kind: "resume_request",
      flowKind: "chat",
      sessionId: "sess_1",
      requestId: "req_1"
    });
  });

  it("does not match resume with wrong method", () => {
    const route = parseFlowRoute("GET", [
      "chat", "sessions", "sess_1", "requests", "req_1", "resume"
    ]);
    expect(route.kind).toBe("not_found");
  });

  it("does not match resume with missing segments", () => {
    const route = parseFlowRoute("POST", [
      "chat", "sessions", "sess_1", "requests", "resume"
    ]);
    expect(route.kind).not.toBe("resume_request");
  });
});

// ── Suspension registry tests ──────────────────────────────────────────────

describe("suspension registry", () => {
  beforeEach(() => resetSuspensionRegistry());
  afterEach(() => resetSuspensionRegistry());

  it("registers and retrieves a suspension", async () => {
    const { registerSuspension } = await import("../src/suspension/suspension-registry");

    registerSuspension({
      suspensionId: "sus_1",
      requestId: "req_1",
      reason: "test",
      createdAt: Date.now(),
      resolve: () => {},
      reject: () => {},
      status: "pending"
    });

    expect(getSuspension("sus_1")).toBeDefined();
    expect(getSuspension("sus_1")?.reason).toBe("test");
    expect(getRequestSuspensions("req_1")).toEqual(["sus_1"]);
  });

  it("cleans up all suspensions for a request", async () => {
    const { registerSuspension, cleanupRequestSuspensions } = await import("../src/suspension/suspension-registry");
    const rejected: string[] = [];

    registerSuspension({
      suspensionId: "sus_a",
      requestId: "req_2",
      reason: "first",
      createdAt: Date.now(),
      resolve: () => {},
      reject: () => rejected.push("sus_a"),
      status: "pending"
    });

    registerSuspension({
      suspensionId: "sus_b",
      requestId: "req_2",
      reason: "second",
      createdAt: Date.now(),
      resolve: () => {},
      reject: () => rejected.push("sus_b"),
      status: "pending"
    });

    cleanupRequestSuspensions("req_2");

    expect(getSuspension("sus_a")).toBeUndefined();
    expect(getSuspension("sus_b")).toBeUndefined();
    expect(getRequestSuspensions("req_2")).toEqual([]);
    expect(rejected).toEqual(["sus_a", "sus_b"]);
  });
});

// ── ctx.suspend() integration tests ────────────────────────────────────────

describe("ctx.suspend()", () => {
  beforeEach(() => resetSuspensionRegistry());
  afterEach(() => resetSuspensionRegistry());

  it("pauses execution and resumes on approval", async () => {
    const executionLog: string[] = [];

    const approvalHandler = handler({
      name: "approval-handler",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.object({ approved: z.boolean(), feedback: z.unknown() }),
      execute: async (input, ctx) => {
        executionLog.push("before-suspend");

        const result = await ctx.suspend({
          reason: "Please approve",
          data: { message: input.message }
        });

        executionLog.push("after-suspend");
        return { approved: result.action === "approve", feedback: result.data };
      }
    });

    const flow = defineFlow({
      kind: "suspend-test",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: approvalHandler
        }
      }
    })();

    const stores = createMockStores();
    const { emitter, items } = createMockEmitter("req_suspend_1");

    // Run the action in the background — it will pause at ctx.suspend().
    const actionPromise = runAction({
      flow,
      actionName: "run",
      input: { message: "deploy to prod?" },
      userId: "user_1",
      sessionId: "sess_1",
      requestId: "req_suspend_1",
      stores,
      responseEmitter: emitter
    });

    // Wait a tick for the suspension to register.
    await new Promise((r) => setTimeout(r, 50));

    expect(executionLog).toEqual(["before-suspend"]);

    // Find the pending suspension.
    const suspensionIds = getRequestSuspensions("req_suspend_1");
    expect(suspensionIds.length).toBe(1);

    const suspension = getSuspension(suspensionIds[0]);
    expect(suspension).toBeDefined();
    expect(suspension!.status).toBe("pending");
    expect(suspension!.reason).toBe("Please approve");

    // Verify a SuspensionItem was emitted.
    const suspensionItems = items.filter(
      (item) => item.type === "suspension"
    ) as SuspensionItem[];
    expect(suspensionItems.length).toBeGreaterThanOrEqual(1);
    expect(suspensionItems[0].suspensionStatus).toBe("pending");

    // Resume the suspension.
    suspension!.resolve({ action: "approve", data: { note: "looks good" } });

    const result = await actionPromise;

    expect(executionLog).toEqual(["before-suspend", "after-suspend"]);
    expect(result.output).toEqual({
      approved: true,
      feedback: { note: "looks good" }
    });
  });

  it("throws SuspensionRejectedError on rejection", async () => {
    const rejectHandler = handler({
      name: "reject-handler",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.suspend({ reason: "approve?" });
        return "should not reach here";
      }
    });

    const flow = defineFlow({
      kind: "reject-test",
      actions: {
        run: { inputSchema: z.any(), block: rejectHandler }
      }
    })();

    const stores = createMockStores();
    const { emitter } = createMockEmitter("req_reject_1");

    const actionPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      requestId: "req_reject_1",
      stores,
      responseEmitter: emitter
    });

    await new Promise((r) => setTimeout(r, 50));

    const suspensionIds = getRequestSuspensions("req_reject_1");
    const suspension = getSuspension(suspensionIds[0])!;
    suspension.resolve({ action: "reject" });

    const result = await actionPromise;
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("suspension_rejected");
  });

  it("throws SuspensionTimeoutError when timeout fires", async () => {
    vi.useFakeTimers();

    const timeoutHandler = handler({
      name: "timeout-handler",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.suspend({ reason: "approve?", timeoutMs: 5000 });
        return "should not reach here";
      }
    });

    const flow = defineFlow({
      kind: "timeout-test",
      actions: {
        run: { inputSchema: z.any(), block: timeoutHandler }
      }
    })();

    const stores = createMockStores();
    const { emitter } = createMockEmitter("req_timeout_1");

    const actionPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      requestId: "req_timeout_1",
      stores,
      responseEmitter: emitter
    });

    // Advance time past the timeout.
    await vi.advanceTimersByTimeAsync(5100);

    const result = await actionPromise;
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("suspension_timeout");

    vi.useRealTimers();
  });

  it("supports multiple concurrent suspensions within one request", async () => {
    const multiHandler = handler({
      name: "multi-suspend-handler",
      inputSchema: z.any(),
      outputSchema: z.object({ results: z.array(z.any()) }),
      execute: async (_input, ctx) => {
        // Launch two parallel suspensions.
        const [r1, r2] = await Promise.all([
          ctx.suspend({ reason: "first approval" }),
          ctx.suspend({ reason: "second approval" })
        ]);
        return { results: [r1.data, r2.data] };
      }
    });

    const flow = defineFlow({
      kind: "multi-test",
      actions: {
        run: { inputSchema: z.any(), block: multiHandler }
      }
    })();

    const stores = createMockStores();
    const { emitter } = createMockEmitter("req_multi_1");

    const actionPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "user_1",
      sessionId: "sess_1",
      requestId: "req_multi_1",
      stores,
      responseEmitter: emitter
    });

    await new Promise((r) => setTimeout(r, 50));

    const suspensionIds = getRequestSuspensions("req_multi_1");
    expect(suspensionIds.length).toBe(2);

    // Resolve both.
    for (const id of suspensionIds) {
      const sus = getSuspension(id)!;
      sus.resolve({ action: "approve", data: `data-${id}` });
    }

    const result = await actionPromise;
    expect(result.output).toBeDefined();
    expect((result.output as any).results.length).toBe(2);
  });
});

// ── Resume route handler tests ─────────────────────────────────────────────

describe("handleResumeRequest", () => {
  beforeEach(() => resetSuspensionRegistry());
  afterEach(() => resetSuspensionRegistry());

  it("returns 400 for missing suspensionId", async () => {
    const stores = createMockStores();

    // Create a request record.
    await stores.request.set("req_r1", {
      id: "req_r1",
      flowKind: "test",
      actionName: "run",
      userId: "u1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const response = await handleResumeRequest(
      new Request("http://localhost/api/flows/test/sessions/s1/requests/req_r1/resume", {
        method: "POST",
        body: JSON.stringify({ action: "approve" }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_r1" },
      { stores }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("suspensionId");
  });

  it("returns 400 for invalid action", async () => {
    const stores = createMockStores();
    await stores.request.set("req_r2", {
      id: "req_r2",
      flowKind: "test",
      actionName: "run",
      userId: "u1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const response = await handleResumeRequest(
      new Request("http://localhost/resume", {
        method: "POST",
        body: JSON.stringify({ suspensionId: "sus_x", action: "maybe" }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_r2" },
      { stores }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("action");
  });

  it("returns 404 for unknown request", async () => {
    const stores = createMockStores();

    const response = await handleResumeRequest(
      new Request("http://localhost/resume", {
        method: "POST",
        body: JSON.stringify({ suspensionId: "sus_x", action: "approve" }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_unknown" },
      { stores }
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 for unknown suspension", async () => {
    const stores = createMockStores();
    await stores.request.set("req_r3", {
      id: "req_r3",
      flowKind: "test",
      actionName: "run",
      userId: "u1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const response = await handleResumeRequest(
      new Request("http://localhost/resume", {
        method: "POST",
        body: JSON.stringify({ suspensionId: "sus_nonexistent", action: "approve" }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_r3" },
      { stores }
    );

    expect(response.status).toBe(404);
  });

  it("returns 409 for completed request", async () => {
    const stores = createMockStores();
    await stores.request.set("req_r4", {
      id: "req_r4",
      flowKind: "test",
      actionName: "run",
      userId: "u1",
      status: "completed",
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const response = await handleResumeRequest(
      new Request("http://localhost/resume", {
        method: "POST",
        body: JSON.stringify({ suspensionId: "sus_x", action: "approve" }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_r4" },
      { stores }
    );

    expect(response.status).toBe(409);
  });

  it("settles a pending suspension and returns 200", async () => {
    const { registerSuspension } = await import("../src/suspension/suspension-registry");

    const stores = createMockStores();
    await stores.request.set("req_r5", {
      id: "req_r5",
      flowKind: "test",
      actionName: "run",
      userId: "u1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    let resolvedPayload: any = undefined;
    registerSuspension({
      suspensionId: "sus_settle",
      requestId: "req_r5",
      reason: "test suspend",
      createdAt: Date.now(),
      resolve: (p) => { resolvedPayload = p; },
      reject: () => {},
      status: "pending"
    });

    const response = await handleResumeRequest(
      new Request("http://localhost/resume", {
        method: "POST",
        body: JSON.stringify({
          suspensionId: "sus_settle",
          action: "approve",
          data: { confirmed: true }
        }),
        headers: { "content-type": "application/json" }
      }),
      { kind: "resume_request", flowKind: "test", sessionId: "s1", requestId: "req_r5" },
      { stores }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.suspensionId).toBe("sus_settle");
    expect(body.status).toBe("approved");
    expect(resolvedPayload).toEqual({
      action: "approve",
      data: { confirmed: true }
    });
  });
});
