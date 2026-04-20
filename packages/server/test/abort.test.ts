import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach } from "vitest";
import { createInMemoryStores, runAction, createFlowRegistry, createFlowApiRouter } from "../src";
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

  it("returns 204 when aborting an active request with in-memory controller", async () => {
    registerAbortController("req_active");
    await stores.request.set("req_active", {
      id: "req_active",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: []
    } as any);

    const response = await handleAbortRequest(
      new Request("http://localhost/api/flows/chat/requests/req_active/abort", { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: "req_active" },
      { stores }
    );

    expect(response.status).toBe(204);

    // Verify the abortRequested flag was set
    const record = await stores.request.get("req_active");
    expect(record?.abortRequested).toBe(true);
    deregisterAbortController("req_active");
  });

  it("returns 202 when request is in-progress but on a different instance (no controller)", async () => {
    await stores.request.set("req_remote", {
      id: "req_remote",
      flowKind: "chat",
      actionName: "run",
      userId: "user_1",
      status: "in_progress",
      startedAtMs: Date.now(),
      state: {},
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      journal: []
    } as any);

    const response = await handleAbortRequest(
      new Request("http://localhost/api/flows/chat/requests/req_remote/abort", { method: "POST" }),
      { kind: "abort_request", flowKind: "chat", requestId: "req_remote" },
      { stores }
    );

    expect(response.status).toBe(202);

    // Verify the abortRequested flag was set
    const record = await stores.request.get("req_remote");
    expect(record?.abortRequested).toBe(true);
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

    // Give runAction a moment to start, then set the abort flag and fire the signal
    await new Promise((resolve) => setTimeout(resolve, 50));
    const record = await stores.request.get("req_abort_test");
    if (record) {
      await stores.request.set("req_abort_test", { ...record, abortRequested: true } as any);
    }
    abortController.abort();

    const result = await resultPromise;

    // Should not have an error (abort is not an error)
    expect(result.error).toBeUndefined();

    // Request record should be "aborted"
    const updatedRecord = await stores.request.get("req_abort_test");
    expect(updatedRecord?.status).toBe("aborted");
    expect(updatedRecord?.abortedAt).toBeTypeOf("number");
  });

  it("writes interrupted status when signal aborts without abortRequested flag", async () => {
    const stores = createInMemoryStores();
    const abortController = new AbortController();

    const flow = defineFlow({
      kind: "disconnect-test-flow",
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "slow-handler",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
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
      requestId: "req_disconnect_test",
      userId: "user_disconnect",
      sessionId: "sess_disconnect",
      signal: abortController.signal,
      stores
    });

    // Simulate accidental disconnect (no abortRequested flag set)
    await new Promise((resolve) => setTimeout(resolve, 50));
    abortController.abort();

    const result = await resultPromise;

    expect(result.error).toBeUndefined();

    const record = await stores.request.get("req_disconnect_test");
    expect(record?.status).toBe("interrupted");
    expect(record?.interruptedAt).toBeTypeOf("number");
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

  it("abort endpoint triggers abort path end-to-end (aborts running request)", async () => {
    const stores = createInMemoryStores();

    // Handler waits for ctx.signal to abort
    const flow = defineFlow({
      kind: "endpoint-abort-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "wait-handler",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
              return "unreachable";
            }
          })
        }
      }
    })();

    const requestId = "req_endpoint_abort";
    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "user_1",
      stores
    });

    // Give runAction a moment to reach the handler and register the controller
    await new Promise((r) => setTimeout(r, 50));

    // Call the abort endpoint like a real client would
    const response = await handleAbortRequest(
      new Request(`http://localhost/api/flows/endpoint-abort-flow/requests/${requestId}/abort`, {
        method: "POST"
      }),
      { kind: "abort_request", flowKind: "endpoint-abort-flow", requestId },
      { stores }
    );
    expect(response.status).toBe(204);

    const result = await resultPromise;
    expect(result.error).toBeUndefined();

    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("aborted");
    expect(record?.abortedAt).toBeTypeOf("number");
  });

  it("emits request.aborted terminal event in the response emitter", async () => {
    const stores = createInMemoryStores();
    const abortController = new AbortController();

    const flow = defineFlow({
      kind: "emit-abort-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "wait-handler",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
              return "unreachable";
            }
          })
        }
      }
    })();

    const requestId = "req_emit_abort";
    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "user_emit",
      signal: abortController.signal,
      stores
    });

    await new Promise((r) => setTimeout(r, 50));
    // Set the abort flag to simulate an intentional abort
    const rec = await stores.request.get(requestId);
    if (rec) {
      await stores.request.set(requestId, { ...rec, abortRequested: true } as any);
    }
    abortController.abort();
    await resultPromise;

    // Check persisted events include request.aborted terminal
    const events = await stores.request.getEvents(requestId);
    const abortEvent = events.find((e) => e.type === "request.aborted");
    expect(abortEvent).toBeDefined();
    expect((abortEvent as { status?: string })?.status).toBe("aborted");

    // Check that a persistent status item was emitted with the abort message
    const record = await stores.request.get(requestId);
    const items = record?.items ?? [];
    const abortStatusItem = items.find(
      (i) => i.type === "status" && (i as { detail?: { code?: string } }).detail?.code === "system.request_aborted"
    );
    expect(abortStatusItem).toBeDefined();
    expect((abortStatusItem as { message?: string })?.message).toBe("Request was stopped.");
    expect(abortStatusItem?.transient).not.toBe(true);
  });

  it("aborting a non-existent request returns 409 after terminal write (or 404 if no record)", async () => {
    const stores = createInMemoryStores();
    const abortController = new AbortController();

    const flow = defineFlow({
      kind: "double-abort-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "wait-handler",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
              return "unreachable";
            }
          })
        }
      }
    })();

    const requestId = "req_double_abort";
    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "user_double",
      signal: abortController.signal,
      stores
    });

    await new Promise((r) => setTimeout(r, 50));
    abortController.abort();
    await resultPromise;

    // Second abort call on the same requestId — now terminal
    const response = await handleAbortRequest(
      new Request(`http://localhost/api/flows/double-abort-flow/requests/${requestId}/abort`, {
        method: "POST"
      }),
      { kind: "abort_request", flowKind: "double-abort-flow", requestId },
      { stores }
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain("terminal state");
  });

  it("delivers the abort status item over the inline SSE stream", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "sse-abort-flow",
      actions: {
        run: {
          inputSchema: z.object({}),
          block: handler({
            name: "wait-handler",
            inputSchema: z.object({}),
            outputSchema: z.string(),
            execute: async (_input, ctx) => {
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener("abort", () => {
                  reject(new DOMException("Aborted", "AbortError"));
                });
              });
              return "unreachable";
            }
          })
        }
      }
    })();

    const registry = createFlowRegistry();
    registry.register(flow);
    const router = createFlowApiRouter({ registry, stores });

    const requestId = "req_sse_abort";
    const sseRequest = new Request(
      "http://localhost/api/flows/sse-abort-flow/actions/run",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "text/event-stream"
        },
        body: JSON.stringify({ userId: "user_sse", requestId, input: {} })
      }
    );
    const sseResponse = await router.POST(sseRequest, {
      params: { path: ["sse-abort-flow", "actions", "run"] }
    });
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

    // Start consuming the SSE stream in the background
    const reader = sseResponse.body!.getReader();
    const decoder = new TextDecoder();
    const collected: string[] = [];
    const consume = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        collected.push(decoder.decode(value, { stream: true }));
      }
    })();

    // Wait briefly for the handler to begin, then abort via the abort endpoint
    await new Promise((r) => setTimeout(r, 50));
    const abortResponse = await router.POST(
      new Request(
        `http://localhost/api/flows/sse-abort-flow/requests/${requestId}/abort`,
        { method: "POST" }
      ),
      { params: { path: ["sse-abort-flow", "requests", requestId, "abort"] } }
    );
    expect(abortResponse.status).toBe(204);

    await consume;
    const body = collected.join("");

    // The abort status item must appear in the SSE stream BEFORE the terminal event
    const abortedItemIdx = body.indexOf("system.request_aborted");
    const requestAbortedIdx = body.indexOf("\"type\":\"request.aborted\"");
    expect(abortedItemIdx).toBeGreaterThan(-1);
    expect(requestAbortedIdx).toBeGreaterThan(-1);
    expect(abortedItemIdx).toBeLessThan(requestAbortedIdx);
    expect(body).toContain("Request was stopped.");
  });
});
