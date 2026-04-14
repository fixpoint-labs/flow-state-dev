import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryStores, runAction } from "../src";
import { parseFlowRoute } from "../src/routes/parseFlowRoute";
import {
  registerAbortController,
  abortRequest,
  deregisterAbortController,
  hasActiveAbortController
} from "../src/execution/abort-registry";
import { handleAbortRequest } from "../src/routes/abort-routes";
import type { StoreRegistry } from "../src/stores/types";

// ---------------------------------------------------------------------------
// Abort registry unit tests
// ---------------------------------------------------------------------------

describe("abort-registry", () => {
  beforeEach(() => {
    // Clean up any leftover controllers from previous tests
    deregisterAbortController("test-req-1");
    deregisterAbortController("test-req-2");
  });

  it("registers and retrieves an abort controller", () => {
    const controller = registerAbortController("test-req-1");
    expect(controller).toBeInstanceOf(AbortController);
    expect(hasActiveAbortController("test-req-1")).toBe(true);
  });

  it("aborts a registered request", () => {
    const controller = registerAbortController("test-req-1");
    expect(controller.signal.aborted).toBe(false);

    const result = abortRequest("test-req-1");
    expect(result).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("returns false when aborting an unregistered request", () => {
    const result = abortRequest("nonexistent");
    expect(result).toBe(false);
  });

  it("deregisters a controller", () => {
    registerAbortController("test-req-1");
    expect(hasActiveAbortController("test-req-1")).toBe(true);

    deregisterAbortController("test-req-1");
    expect(hasActiveAbortController("test-req-1")).toBe(false);
  });

  it("double-abort is safe (controller already aborted)", () => {
    registerAbortController("test-req-1");
    abortRequest("test-req-1");
    // Second abort doesn't throw
    const result = abortRequest("test-req-1");
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Route parsing
// ---------------------------------------------------------------------------

describe("parseFlowRoute — abort route", () => {
  it("parses abort_request route", () => {
    // POST /api/flows/:flowKind/requests/:requestId/abort
    const route = parseFlowRoute("POST", ["chat", "requests", "req_123", "abort"]);
    expect(route).toEqual({
      kind: "abort_request",
      flowKind: "chat",
      requestId: "req_123"
    });
  });

  it("does not match abort with wrong method", () => {
    const route = parseFlowRoute("GET", ["chat", "requests", "req_123", "abort"]);
    expect(route.kind).toBe("not_found");
  });

  it("does not match abort with wrong segment count", () => {
    const route = parseFlowRoute("POST", ["chat", "requests", "abort"]);
    expect(route.kind).toBe("not_found");
  });

  it("does not match abort with wrong keyword", () => {
    const route = parseFlowRoute("POST", ["chat", "requests", "req_123", "cancel"]);
    expect(route.kind).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// Abort route handler
// ---------------------------------------------------------------------------

describe("handleAbortRequest", () => {
  let stores: StoreRegistry;

  beforeEach(() => {
    stores = createInMemoryStores();
    deregisterAbortController("req_active");
    deregisterAbortController("req_terminal");
  });

  it("returns 204 when aborting an active request", async () => {
    registerAbortController("req_active");

    const response = await handleAbortRequest(
      new Request("http://localhost/api/flows/chat/requests/req_active/abort", { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: "req_active" },
      { stores }
    );

    expect(response.status).toBe(204);
    deregisterAbortController("req_active");
  });

  it("returns 404 when request is not in progress and not in store", async () => {
    const response = await handleAbortRequest(
      new Request("http://localhost/api/flows/chat/requests/req_gone/abort", { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: "req_gone" },
      { stores }
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("not in progress");
  });

  it("returns 409 when request is already completed", async () => {
    // Seed a completed request record
    await stores.request.set("req_terminal", {
      id: "req_terminal",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      status: "completed",
      startedAtMs: Date.now(),
      completedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: []
    } as any);

    const response = await handleAbortRequest(
      new Request("http://localhost/api/flows/chat/requests/req_terminal/abort", { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: "req_terminal" },
      { stores }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("terminal state");
  });
});

// ---------------------------------------------------------------------------
// runAction abort integration
// ---------------------------------------------------------------------------

describe("runAction — abort path", () => {
  it("writes aborted status when signal is aborted during execution", async () => {
    const stores = createInMemoryStores();
    const abortController = new AbortController();

    // A handler that takes long enough for us to abort mid-execution
    const flow = defineFlow({
      kind: "abort-test-flow",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "slow-handler",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
              // Wait until aborted
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
              return "should not reach";
            }
          })
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: { message: "hello" },
      requestId: "req_abort_test",
      userId: "user_abort",
      sessionId: "sess_abort",
      signal: abortController.signal,
      stores
    });

    // Give runAction a moment to start, then abort
    await new Promise((resolve) => setTimeout(resolve, 50));
    abortController.abort();

    const result = await resultPromise;

    // Should not have an error (abort is not an error)
    expect(result.error).toBeUndefined();

    // Request record should be "aborted"
    const record = await stores.request.get("req_abort_test");
    expect(record?.status).toBe("aborted");
    expect(record?.abortedAt).toBeTypeOf("number");
  });

  it("writes failed status when execution errors without abort", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "fail-test-flow",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "failing-handler",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("intentional failure");
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { message: "hello" },
      requestId: "req_fail_test",
      userId: "user_fail",
      sessionId: "sess_fail",
      stores
    });

    // Should have an error
    expect(result.error).toBeDefined();

    // Request record should be "failed", not "aborted"
    const record = await stores.request.get("req_fail_test");
    expect(record?.status).toBe("failed");
    expect(record?.abortedAt).toBeUndefined();
  });

  it("deregisters abort controller on successful completion", async () => {
    const stores = createInMemoryStores();

    const flow = defineFlow({
      kind: "complete-test-flow",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "ok-handler",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.string(),
            execute: () => "done"
          })
        }
      }
    })();

    await runAction({
      flow,
      actionName: "run",
      input: { message: "hello" },
      requestId: "req_complete_test",
      userId: "user_complete",
      sessionId: "sess_complete",
      stores
    });

    // The abort controller should be cleaned up
    expect(hasActiveAbortController("req_complete_test")).toBe(false);
  });
});
