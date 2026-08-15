import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach } from "vitest";
import {
  continueRequest,
  createInMemoryStores,
  runAction,
  createFlowRegistry,
  createFlowApiRouter
} from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
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
    } as any, "any");

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
    } as any, "any");

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
    } as any, "any");

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
      stores,
      runtimeConfig: {}
    });

    // Give runAction a moment to start, then set the abort flag and fire the signal
    await new Promise((resolve) => setTimeout(resolve, 50));
    await stores.request.setFieldsIfStatus(
      "req_abort_test",
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
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
      stores,
      runtimeConfig: {}
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
      stores,
      runtimeConfig: {}
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
      stores,
      runtimeConfig: {}
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
      stores,
      runtimeConfig: {}
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
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 50));
    // Record the abort intent to simulate an intentional abort
    await stores.request.setFieldsIfStatus(
      requestId,
      { abortRequested: true },
      ["in_progress"],
      Date.now()
    );
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
      stores,
      runtimeConfig: {}
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

// ---------------------------------------------------------------------------
// Cross-process abort delivery (FIX-1026)
//
// Every case here deliberately INVERTS the pattern the tests above use. Those
// set the intent and then fire the local controller by hand, which proves the
// classification but not the delivery. Here nothing fires the controller: the
// intent is recorded through the store, exactly as a `/abort` handled by a
// different process would record it, and the running action's own heartbeat
// poll is the only thing that can tear it down.
// ---------------------------------------------------------------------------

/**
 * A `StoreRegistry` with individual store methods swapped out. Uses the real
 * store as the prototype so un-overridden methods keep working against the
 * same backing data.
 */
function withStoreOverrides(
  stores: StoreRegistry,
  overrides: {
    request?: Partial<StoreRegistry["request"]>;
    activeRequests?: Partial<StoreRegistry["activeRequests"]>;
    session?: Partial<StoreRegistry["session"]>;
  }
): StoreRegistry {
  const request = Object.create(stores.request) as StoreRegistry["request"];
  Object.assign(request, overrides.request ?? {});
  const activeRequests = Object.create(
    stores.activeRequests
  ) as StoreRegistry["activeRequests"];
  Object.assign(activeRequests, overrides.activeRequests ?? {});
  const session = Object.create(stores.session) as StoreRegistry["session"];
  Object.assign(session, overrides.session ?? {});
  return { ...stores, request, activeRequests, session };
}

/** Record the abort intent the way a `/abort` on another process would. */
async function recordAbortIntent(
  stores: StoreRegistry,
  requestId: string
): Promise<void> {
  const result = await stores.request.setFieldsIfStatus(
    requestId,
    { abortRequested: true },
    ["in_progress"],
    Date.now()
  );
  expect(result.applied).toBe(true);
}

/**
 * A flow whose action blocks until its signal fires, or resolves on its own
 * after `selfCompleteAfterMs`. The self-completion is what makes "did the
 * abort actually stop it?" falsifiable — without it a hung test and a
 * successful cancel look the same.
 */
function makeBlockingFlow(options: {
  kind: string;
  heartbeatIntervalMs?: number;
  selfCompleteAfterMs?: number;
}) {
  return defineFlow({
    kind: options.kind,
    request:
      options.heartbeatIntervalMs === undefined
        ? undefined
        : { heartbeatIntervalMs: options.heartbeatIntervalMs },
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({
          name: "blocking-handler",
          inputSchema: z.object({}).passthrough(),
          outputSchema: z.string(),
          execute: async (_input, ctx) =>
            new Promise<string>((resolve, reject) => {
              // `addEventListener` does not fire for an ALREADY-aborted signal,
              // and a cross-process abort can be delivered before this block
              // starts. Checking up front is what a block that honours its
              // signal does; without it the run would sit out its full delay
              // and look like a delivery failure.
              if (ctx.signal.aborted) {
                reject(new DOMException("Aborted", "AbortError"));
                return;
              }
              const timer = setTimeout(
                () => resolve("completed naturally"),
                options.selfCompleteAfterMs ?? 3_000
              );
              ctx.signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
              });
            })
        })
      }
    }
  })();
}

describe("runAction — cross-process abort delivery", () => {
  it("tears down and settles aborted when only the store carries the intent", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_xproc_basic";
    const flow = makeBlockingFlow({
      kind: "xproc-basic",
      heartbeatIntervalMs: 20
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 50));
    // No local controller is fired anywhere in this test.
    await recordAbortIntent(stores, requestId);

    const result = await resultPromise;
    expect(result.error).toBeUndefined();

    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("aborted");
    expect(record?.abortedAt).toBeTypeOf("number");
    expect(hasActiveAbortController(requestId)).toBe(false);
  });

  it("does not deliver when heartbeatIntervalMs is 0 — the off state", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_xproc_off";
    const flow = makeBlockingFlow({
      kind: "xproc-off",
      heartbeatIntervalMs: 0,
      selfCompleteAfterMs: 150
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 30));
    await recordAbortIntent(stores, requestId);

    const result = await resultPromise;
    // No timer, therefore no poll and no delivery: the run finishes normally.
    expect(result.output).toBe("completed naturally");
    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("completed");
    // The intent is still recorded — it was simply never delivered.
    expect(await stores.request.isAbortRequested(requestId)).toBe(true);
  });

  it("leaves the run healthy when the abort read throws on every poll", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_read_throws";
    let reads = 0;
    const stores = withStoreOverrides(base, {
      request: {
        isAbortRequested: async () => {
          reads += 1;
          throw new Error("store unavailable");
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-read-throws",
      heartbeatIntervalMs: 20,
      selfCompleteAfterMs: 200
    });

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    // A transient store error must never abort or fail a healthy run.
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("completed naturally");
    expect(reads).toBeGreaterThan(0);
    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("completed");
  });

  it("still delivers when the heartbeat write rejects on every tick", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_hb_fails";
    const stores = withStoreOverrides(base, {
      activeRequests: {
        heartbeat: async () => {
          throw new Error("registry unavailable");
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-hb-fails",
      heartbeatIntervalMs: 20
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 50));
    await recordAbortIntent(stores, requestId);

    await resultPromise;
    // The two halves share a timer, not a fate: a registry outage must not
    // silently disable cancellation on a deployment that meets every
    // documented requirement.
    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });

  it("delivers once — a later tick does not re-read or re-fire", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_latch";
    let readsAfterDelivery = 0;
    let delivered = false;
    const stores = withStoreOverrides(base, {
      request: {
        async isAbortRequested(this: StoreRegistry["request"], id: string) {
          const requested = await Object.getPrototypeOf(this).isAbortRequested.call(this, id);
          if (delivered) readsAfterDelivery += 1;
          if (requested) delivered = true;
          return requested;
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-latch",
      heartbeatIntervalMs: 15
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 40));
    await recordAbortIntent(stores, requestId);
    await resultPromise;

    // Teardown can outlast an interval; the latch is what stops the poll from
    // reading again once it has actually delivered.
    await new Promise((r) => setTimeout(r, 60));
    expect(readsAfterDelivery).toBe(0);
  });

  it("never runs two polls at once when the store is slower than the interval", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_overlap";
    let inFlight = 0;
    let maxConcurrent = 0;
    let calls = 0;
    // Deliberately slower than the tick, which is what a degrading store looks
    // like. `setInterval` fires again while the previous callback is still
    // awaiting, so without an in-flight guard both ticks read the store — and
    // both would call `abortRequest`, which keeps returning true while the
    // controller is registered, aborted or not.
    const stores = withStoreOverrides(base, {
      request: {
        isAbortRequested: async () => {
          inFlight += 1;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          calls += 1;
          await new Promise((r) => setTimeout(r, 60));
          inFlight -= 1;
          return false;
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-overlap",
      heartbeatIntervalMs: 10,
      selfCompleteAfterMs: 300
    });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    expect(calls).toBeGreaterThan(1);
    expect(maxConcurrent).toBe(1);
  });

  it("delivers a flag that was already set before the run started", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_xproc_preset";
    const flow = makeBlockingFlow({
      kind: "xproc-preset",
      heartbeatIntervalMs: 20
    });

    // Seed the record as in_progress with the intent already recorded, the way
    // a cancel accepted between admission and the run starting leaves it.
    const now = Date.now();
    await stores.request.set(
      requestId,
      {
        id: requestId,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: "xproc-preset",
        actionName: "run",
        userId: "u_xproc",
        source: "http",
        status: "in_progress",
        startedAtMs: now
      },
      "any"
    );
    await recordAbortIntent(stores, requestId);

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    const record = await stores.request.get(requestId);
    // Delivered on the first tick that could deliver, well before the handler's
    // natural completion.
    expect(record?.status).toBe("aborted");
  });

  it("does not latch on a tick that lands before the controller is registered", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_prereg";
    const sessionId = "sess_xproc_prereg";
    let pollsBeforeRegistration = 0;

    // `runAction` installs the heartbeat timer well before it calls
    // `registerAbortController`, and does session work in between. Making that
    // session work take real time puts ticks deterministically inside the
    // window instead of racing the scheduler for them.
    const stores = withStoreOverrides(base, {
      request: {
        async isAbortRequested(this: StoreRegistry["request"], id: string) {
          if (!hasActiveAbortController(id)) pollsBeforeRegistration += 1;
          return Object.getPrototypeOf(this).isAbortRequested.call(this, id);
        }
      }
    });
    const slowSession = Object.create(stores.session) as StoreRegistry["session"];
    Object.assign(slowSession, {
      async get(this: StoreRegistry["session"], id: string) {
        await new Promise((r) => setTimeout(r, 60));
        return Object.getPrototypeOf(this).get.call(this, id);
      }
    });
    const slowStores = { ...stores, session: slowSession };

    // The intent is already recorded when the run starts — the queued /
    // pre-start cancellation case.
    const now = Date.now();
    await slowStores.request.set(
      requestId,
      {
        id: requestId,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: "xproc-prereg",
        actionName: "run",
        userId: "u_xproc",
        source: "http",
        status: "in_progress",
        startedAtMs: now
      },
      "any"
    );
    await recordAbortIntent(slowStores, requestId);

    const flow = makeBlockingFlow({
      kind: "xproc-prereg",
      heartbeatIntervalMs: 10,
      selfCompleteAfterMs: 400
    });

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      sessionId,
      userId: "u_xproc",
      stores: slowStores,
      runtimeConfig: {}
    });

    // Precondition: ticks really did land in the pre-registration window.
    expect(pollsBeforeRegistration).toBeGreaterThan(0);
    // And delivery still happened. Under a DETECTION latch those first ticks
    // would have latched on a read they could not act on, suppressed every
    // later poll, and let the run finish naturally.
    expect(result.output).not.toBe("completed naturally");
    const record = await slowStores.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });

  it("still classifies as aborted when the classification read fails after delivery", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_classify";
    let delivered = false;
    let failedOnce = false;

    // Fail exactly the classification read — the `get` the terminal `catch`
    // makes to decide intentional-abort vs accidental-disconnect. Everything
    // after it (the terminal write's own read) must still work, or the record
    // would never be written at all and the test would prove nothing.
    const stores = withStoreOverrides(base, {
      request: {
        async isAbortRequested(this: StoreRegistry["request"], id: string) {
          const requested = await Object.getPrototypeOf(this).isAbortRequested.call(this, id);
          if (requested) delivered = true;
          return requested;
        },
        async get(this: StoreRegistry["request"], id: string) {
          if (delivered && !failedOnce) {
            failedOnce = true;
            throw new Error("store unavailable");
          }
          return Object.getPrototypeOf(this).get.call(this, id);
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-classify",
      heartbeatIntervalMs: 20
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 50));
    await recordAbortIntent(stores, requestId);
    await resultPromise;

    expect(failedOnce).toBe(true);
    // This process read the durable intent and fired the controller itself, so
    // it does not need the store to tell it what happened. Without that
    // fallback the run files as `interrupted` — a RESUMABLE state — for a
    // request the operator demonstrably cancelled.
    const record = await base.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });

  it("keeps the intent across a worker full-record write taken from a stale snapshot", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_xproc_stale_write";
    const flow = makeBlockingFlow({
      kind: "xproc-stale-write",
      heartbeatIntervalMs: 10_000 // no tick during the window under test
    });

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    await new Promise((r) => setTimeout(r, 50));
    // The snapshot a worker holds — taken BEFORE the cancel is recorded. This
    // is the shape of all six full-record writers, the longest-lived being the
    // execution context's run-lifetime `requestRef`.
    const staleSnapshot = await stores.request.get(requestId);
    expect(staleSnapshot).toBeDefined();
    expect(staleSnapshot?.abortRequested).not.toBe(true);

    await recordAbortIntent(stores, requestId);

    // The worker now writes its whole record back from that stale copy.
    await stores.request.set(
      requestId,
      { ...(staleSnapshot as NonNullable<typeof staleSnapshot>), updatedAt: Date.now() },
      "any"
    );

    // The flag survives, because `set` cannot carry it in either direction.
    expect(await stores.request.isAbortRequested(requestId)).toBe(true);

    // And the next poll still delivers.
    abortRequest(requestId);
    await resultPromise;
    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });

  // The poll rides a timer installed BEFORE the run has an abort controller, and
  // the setup between the two touches the stores (the session update, the
  // initial status emits). A rejection there returns through neither the
  // pre-transition cleanup nor a terminal path — both sit further down — so the
  // timer outlives the request that owns it and keeps reading the request store
  // on every interval, forever. The failure mode compounds exactly when it can
  // least afford to: a store outage fails many requests, and each one leaves
  // behind another permanent reader of the store that is already degrading.
  it("stops polling the store when setup fails before the controller is registered", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_setup_fails";
    let reads = 0;
    const stores = withStoreOverrides(base, {
      request: {
        isAbortRequested: async (id: string) => {
          reads += 1;
          return base.request.isAbortRequested(id);
        }
      },
      session: {
        get: async () => {
          throw new Error("session store unavailable");
        }
      }
    });
    const flow = makeBlockingFlow({
      kind: "xproc-setup-fails",
      heartbeatIntervalMs: 20
    });

    await expect(
      runAction({
        flow,
        actionName: "run",
        input: {},
        requestId,
        userId: "u_xproc",
        // The session update is the first store await after the timer is
        // installed; `sessionId` is what puts the run on that path.
        sessionId: "sess_xproc_setup_fails",
        stores,
        runtimeConfig: {}
      })
    ).rejects.toThrow("session store unavailable");

    // Precondition: the run really did die in the pre-controller window. If it
    // got as far as registration, this test is asserting about a window that
    // was never open.
    expect(hasActiveAbortController(requestId)).toBe(false);

    const readsAtFailure = reads;
    // Several intervals' worth. A surviving timer polls once per interval.
    await new Promise((r) => setTimeout(r, 120));
    expect(reads).toBe(readsAtFailure);
  });

  // The pre-controller guards above stop at `registerAbortController`, but two
  // awaits still sit between it and the main try — the `started` lifecycle seam
  // and the flow's `onStarted` observer. A rejection in either returns through
  // neither the pre-transition cleanup nor a terminal path, so the timer
  // survives the request and keeps reading the request store forever. Same leak
  // as the pre-controller one, one window further down — and here the abort
  // controller is registered, so it leaks too.
  it("stops polling the store when a startup observer fails after registration", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_started_fails";
    let reads = 0;
    let observerRan = false;
    let bodyRan = false;

    const stores = withStoreOverrides(base, {
      request: {
        isAbortRequested: async (id: string) => {
          reads += 1;
          return base.request.isAbortRequested(id);
        }
      }
    });

    const flow = defineFlow({
      kind: "xproc-started-fails",
      request: {
        heartbeatIntervalMs: 20,
        onStarted: handler({
          name: "on-started-throws",
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: async () => {
            observerRan = true;
            throw new Error("onStarted observer failed");
          }
        })
      },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "never-reached",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.string(),
            execute: async () => {
              bodyRan = true;
              return "body succeeded";
            }
          })
        }
      }
    })();

    let caught: unknown;
    await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    }).then(
      () => {},
      (err: unknown) => {
        caught = err;
      }
    );

    // Precondition: the run really did die in THIS window — past registration
    // (the observer runs long after it) and before the main try (the body never
    // ran). Without both, the test is asserting about a window it never opened.
    expect(observerRan).toBe(true);
    expect(bodyRan).toBe(false);
    // The failure still reaches the caller; the guard cleans up, it does not
    // swallow.
    expect(caught).toBeDefined();

    // The controller is registered by this point, so the guard owes its release
    // as well as the timer's.
    expect(hasActiveAbortController(requestId)).toBe(false);

    const readsAtFailure = reads;
    // Several intervals' worth. A surviving timer polls once per interval.
    await new Promise((r) => setTimeout(r, 120));
    expect(reads).toBe(readsAtFailure);
  });

  /**
   * The admission poll is the only thing that can deliver a cancel recorded
   * before the run starts — and it is a store read, so whether it lands at all
   * depended on how that read raced the action. Fired and forgotten, an action
   * shorter than one `isAbortRequested` round trip runs, clears the post-drain
   * abort check, persists `completed` and deregisters its controller while the
   * read that would have stopped it is still in flight; the answer then arrives
   * with nowhere to land. Awaited, the race cannot occur.
   *
   * The delay only has to be long enough to lose that race, and the unfixed
   * code loses it at ANY delay — so a generous one cannot make this flaky, only
   * more obviously red.
   */
  it("does not run the action until the admission read has answered", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_admission_await";

    const stores = withStoreOverrides(base, {
      request: {
        async isAbortRequested(this: StoreRegistry["request"], id: string) {
          await new Promise((r) => setTimeout(r, 60));
          return Object.getPrototypeOf(this).isAbortRequested.call(this, id);
        }
      }
    });

    // A tick interval far outside the run, and a body that completes as soon as
    // it is entered. So the admission poll is the ONLY delivery path in play —
    // no timer tick fires, and the body cannot outlast anything but the read.
    const flow = makeBlockingFlow({
      kind: "xproc-admission-await",
      heartbeatIntervalMs: 10_000,
      selfCompleteAfterMs: 0
    });

    // The cancel is already recorded when the run starts — a queued job stopped
    // before a worker picked it up.
    const now = Date.now();
    await base.request.set(
      requestId,
      {
        id: requestId,
        state: {},
        version: 0,
        createdAt: now,
        updatedAt: now,
        flowKind: "xproc-admission-await",
        actionName: "run",
        userId: "u_xproc",
        source: "http",
        status: "in_progress",
        startedAtMs: now
      },
      "any"
    );
    await recordAbortIntent(base, requestId);

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_xproc",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // The body honours its signal up front, so this is the direct statement
    // that it was entered with the cancel already delivered.
    expect(result.output).not.toBe("completed naturally");
    const record = await base.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });
});

describe("handleAbortRequest — conditional write", () => {
  const abortCtx = (stores: StoreRegistry) => ({ stores });

  async function postAbort(stores: StoreRegistry, requestId: string) {
    return handleAbortRequest(
      new Request(`http://localhost/api/flows/cond-flow/requests/${requestId}/abort`, {
        method: "POST"
      }),
      { kind: "abort_request", flowKind: "cond-flow", requestId },
      abortCtx(stores)
    );
  }

  function seedRecord(
    stores: StoreRegistry,
    requestId: string,
    status: "in_progress" | "completed",
    version = 0
  ) {
    const now = Date.now();
    return stores.request.set(
      requestId,
      {
        id: requestId,
        state: {},
        version,
        createdAt: now,
        updatedAt: now,
        flowKind: "cond-flow",
        actionName: "run",
        userId: "u_cond",
        source: "http",
        status,
        startedAtMs: now
      },
      "any"
    );
  }

  it("404s when the request does not exist", async () => {
    const stores = createInMemoryStores();
    const response = await postAbort(stores, "req_cond_absent");
    expect(response.status).toBe(404);
  });

  it("202s and records the intent when the request is running elsewhere", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_cond_running";
    await seedRecord(stores, requestId, "in_progress");
    deregisterAbortController(requestId);

    const response = await postAbort(stores, requestId);

    expect(response.status).toBe(202);
    expect(await stores.request.isAbortRequested(requestId)).toBe(true);
  });

  it("204s and fires the controller when the request is running here", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_cond_local";
    await seedRecord(stores, requestId, "in_progress");
    const controller = registerAbortController(requestId);

    const response = await postAbort(stores, requestId);

    expect(response.status).toBe(204);
    expect(controller.signal.aborted).toBe(true);
    deregisterAbortController(requestId);
  });

  // The resurrection case, and the reason `expectedVersion` cannot be the
  // predicate: terminal writes persist `version` UNCHANGED, so a version-checked
  // write still validates after the terminal commit. The version is deliberately
  // held constant across the transition here to reproduce exactly that.
  it("409s without resurrecting a record that went terminal at the same version", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_cond_race";
    await seedRecord(stores, requestId, "in_progress", 7);

    const beforeTerminal = await stores.request.get(requestId);
    expect(beforeTerminal?.version).toBe(7);

    // The worker commits the terminal status — version unchanged, as
    // `patchRequestRecord(..., "any")` leaves it.
    await stores.request.set(
      requestId,
      { ...(beforeTerminal as NonNullable<typeof beforeTerminal>), status: "completed" },
      "any"
    );

    const response = await postAbort(stores, requestId);

    expect(response.status).toBe(409);
    const after = await stores.request.get(requestId);
    expect(after?.status).toBe("completed");
    expect(after?.version).toBe(7);
    expect(await stores.request.isAbortRequested(requestId)).toBe(false);
  });
});

describe("cross-process abort accepted in the teardown window", () => {
  // Both terminal legs clear the heartbeat timer BEFORE writing the terminal
  // status, so a cancel can be accepted while the record still says
  // `in_progress` — the predicate holds, the intent is recorded, and no poll
  // remains on that leg to deliver it.
  //
  // When the run settles `suspended`, the same-request continuation delivers on
  // its first poll and settles `aborted`. That is the intended behaviour, not a
  // leak: the intent was recorded against this request, was never delivered,
  // and the continuation IS the same request. Nothing clears the flag on the
  // suspended write, which is what makes the continuation able to honour it.
  it("survives the suspend write and is delivered by the continuation", async () => {
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    const gate = handler({
      name: "gate",
      inputSchema: z.any(),
      outputSchema: z.unknown(),
      execute: async (_input, ctx) =>
        ctx.suspend!({ reason: "human_approval", message: "Approve?" })
    });
    const after = handler({
      name: "after",
      inputSchema: z.any(),
      outputSchema: z.string(),
      // Long enough that a delivered abort is distinguishable from natural
      // completion, and honouring an already-aborted signal the way a real
      // block does.
      execute: async (_input, ctx) =>
        new Promise<string>((resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const timer = setTimeout(() => resolve("ran past the gate"), 1_000);
          ctx.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    });

    const flow = defineFlow({
      kind: "teardown-window",
      request: { heartbeatIntervalMs: 15 },
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "seq", durable: true }).step(gate).step(after)
        }
      }
    })({ id: "teardown-window" });

    // Reproduce the teardown window deterministically: record the intent on the
    // very write that settles `suspended`, before it lands. The status is still
    // `in_progress` at that moment, so the route's own predicate holds — which
    // is exactly the ordering the window creates.
    let intentRecorded = false;
    const request = Object.create(stores.request) as StoreRegistry["request"];
    Object.assign(request, {
      async set(
        this: StoreRegistry["request"],
        id: string,
        value: Parameters<StoreRegistry["request"]["set"]>[1],
        expectedVersion: Parameters<StoreRegistry["request"]["set"]>[2]
      ) {
        if (!intentRecorded && value.status === "suspended") {
          intentRecorded = true;
          const accepted = await this.setFieldsIfStatus(
            id,
            { abortRequested: true },
            ["in_progress"],
            Date.now()
          );
          expect(accepted.applied).toBe(true);
        }
        return Object.getPrototypeOf(this).set.call(this, id, value, expectedVersion);
      }
    });
    const hookedStores = { ...stores, request };

    const initial = await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u_teardown",
      stores: hookedStores,
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = initial.requestId!;

    expect(intentRecorded).toBe(true);
    const suspended = await hookedStores.request.get(requestId);
    expect(suspended?.status).toBe("suspended");
    // Nothing clears the flag on the suspended write — this is the property the
    // continuation depends on.
    expect(suspended?.abortRequested).toBe(true);
    expect(await hookedStores.request.isAbortRequested(requestId)).toBe(true);

    // Now continue the same request, as an approval would.
    const [suspension] = await provider.listSuspended({ status: "pending" });
    await provider.suspend({
      ...suspension,
      status: "approved",
      resolvedAt: Date.now(),
      resumeData: undefined
    });
    const registry = createFlowRegistry();
    registry.register(flow as never);
    const { finished } = await continueRequest({
      requestId,
      stores: hookedStores,
      flowRegistry: registry,
      resumeContext: {
        suspensionId: suspension.suspensionId,
        action: "approve",
        resumedBy: "reviewer"
      },
      runtimeConfig: { durabilityProvider: provider }
    });
    const continued = await finished;

    expect(continued.output).not.toBe("ran past the gate");
    const record = await hookedStores.request.get(requestId);
    expect(record?.status).toBe("aborted");
  });
});

describe("cross-process abort delivered during the background drain", () => {
  /**
   * A promise plus its resolver, for parking the test at a chosen point so the
   * interleave is deterministic instead of timing-dependent.
   */
  function createGate(): { wait: Promise<void>; open: () => void } {
    let open: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  /**
   * The success path drains the request-scoped `.sideChain()` pool before it writes
   * the terminal status. A cancel accepted during that drain IS delivered — the
   * poll fires the controller and the in-flight tasks self-cancel — but the
   * drain collects their rejections into `failed[]`, logs them, and resolves
   * normally. Nothing after it re-reads `deliveredAbort`, so the run persists
   * `completed`: the caller is told the request finished while their cancel was
   * busy stopping its background work.
   *
   * Distinct from the teardown window above, which is about intent that is
   * never delivered at all. Here delivery demonstrably happened.
   */
  it("classifies the request aborted rather than completed", async () => {
    const base = createInMemoryStores();
    const requestId = "req_xproc_drain_window";

    // The abort must stay invisible to the poll until the action body has
    // finished. Delivered any earlier and the body itself throws, which is the
    // ordinary abort path — a different window, already covered above.
    let abortVisible = false;
    const stores = withStoreOverrides(base, {
      request: {
        isAbortRequested: async (id: string) =>
          abortVisible && (await base.request.isAbortRequested(id))
      }
    });

    // Two gates make the interleave exact rather than timed. `bodyDone` fires
    // when the last step of the body returns; the background task then holds
    // the drain open until its signal fires, which only delivery can do. So the
    // drain cannot finish before the abort lands, and the abort cannot land
    // before the body is done.
    const bodyDone = createGate();

    const background = handler({
      name: "bg-holds-the-drain",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async (_input, ctx) =>
        new Promise<string>((_resolve, reject) => {
          // `.sideChain()` tasks run on the background signal (FIX-663), which fires
          // only on an explicit cancel — exactly the delivery under test.
          if (ctx.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          ctx.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    });

    const finish = handler({
      name: "body-done",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async () => {
        bodyDone.open();
        return "body succeeded";
      }
    });

    const flow = defineFlow({
      kind: "xproc-drain-window",
      request: { heartbeatIntervalMs: 20 },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: sequencer({ name: "seq" }).sideChain(background).step(finish)
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_drain",
      stores,
      runtimeConfig: {}
    });

    await bodyDone.wait;
    // The body has returned, so the run is in (or entering) the drain and the
    // record is still `in_progress` — the drain is blocked on the task above.
    // Record the intent the way a `/abort` on another process does, then let
    // the poll see it.
    await recordAbortIntent(stores, requestId);
    abortVisible = true;

    const result = await resultPromise;
    expect(result.error).toBeUndefined();

    const record = await stores.request.get(requestId);
    // The cancel was accepted with a 202 and demonstrably stopped the
    // background work. Reporting `completed` tells the caller the opposite.
    expect(record?.status).toBe("aborted");
    expect(record?.abortedAt).toBeTypeOf("number");
  });

  /**
   * The same window reached the other way. `/abort` on the process that owns
   * the run answers 204 and fires the controller directly, so `deliveredAbort`
   * — the poll's own latch — is never set. Both delivery paths converge on the
   * one registry controller by design, and the classification after the drain
   * has to key on something both of them set, or the 204 case keeps writing
   * `completed` over work it just stopped.
   *
   * `heartbeatIntervalMs: 0` removes the poll entirely, so the local fire is
   * demonstrably the only thing that cancelled the drain.
   */
  it("classifies a locally fired abort in the same window", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_local_drain_window";
    const bodyDone = createGate();

    const background = handler({
      name: "bg-holds-the-drain-local",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async (_input, ctx) =>
        new Promise<string>((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          ctx.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    });

    const finish = handler({
      name: "body-done-local",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async () => {
        bodyDone.open();
        return "body succeeded";
      }
    });

    const flow = defineFlow({
      kind: "local-drain-window",
      request: { heartbeatIntervalMs: 0 },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: sequencer({ name: "seq" }).sideChain(background).step(finish)
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_local_drain",
      stores,
      runtimeConfig: {}
    });

    await bodyDone.wait;
    // Exactly what `handleAbortRequest` does on its 204 leg: record the intent
    // durably, then fire the in-process controller.
    await recordAbortIntent(stores, requestId);
    expect(abortRequest(requestId)).toBe(true);

    const result = await resultPromise;
    expect(result.error).toBeUndefined();

    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("aborted");
    expect(record?.abortedAt).toBeTypeOf("number");
  });

  /**
   * Records each lifecycle hook that fires, tagging the ones carrying a
   * terminal `status` so `onFinished`'s verdict is visible in the same list.
   */
  function recordingObserver(events: string[], name: string) {
    return handler({
      name,
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input) => {
        const status =
          typeof input === "object" && input !== null && "status" in input
            ? String((input as { status?: unknown }).status)
            : undefined;
        events.push(status === undefined ? name : `${name}:${status}`);
      }
    });
  }

  /** Holds the drain open until the returned gate is opened or the signal fires. */
  function drainHolder(name: string, release?: Promise<void>) {
    return handler({
      name,
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async (_input, ctx) => {
        if (release !== undefined) {
          await release;
          return "bg settled";
        }
        return new Promise<string>((_resolve, reject) => {
          if (ctx.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          ctx.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        });
      }
    });
  }

  /**
   * `onCompleted` "fires only on terminal success"
   * (docs/architecture/execution-and-errors.md → Request Lifecycle). A cancel
   * accepted during the drain ends the request as `aborted`, so the completion
   * hooks must not run for it — otherwise a flow's `onCompleted` commits
   * business side effects or sends a success notification for a request whose
   * own `onFinished` reports `aborted`, in the same breath.
   */
  it("skips the completion hooks for a cancel accepted in that window", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_drain_window_hooks_aborted";
    const bodyDone = createGate();
    const events: string[] = [];

    const flow = defineFlow({
      kind: "drain-window-hooks-aborted",
      request: {
        heartbeatIntervalMs: 0,
        onCompleted: recordingObserver(events, "request.completed"),
        onFinished: recordingObserver(events, "request.finished")
      },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: sequencer({ name: "seq" })
            .sideChain(drainHolder("bg-holds-the-drain-hooks"))
            .step(handler({
              name: "body-done-hooks",
              inputSchema: z.object({}).passthrough(),
              outputSchema: z.string(),
              execute: async () => {
                bodyDone.open();
                return "body succeeded";
              }
            })),
          onCompleted: recordingObserver(events, "action.completed")
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_drain_hooks",
      stores,
      runtimeConfig: {}
    });

    await bodyDone.wait;
    await recordAbortIntent(stores, requestId);
    expect(abortRequest(requestId)).toBe(true);

    const result = await resultPromise;
    expect(result.error).toBeUndefined();
    expect((await stores.request.get(requestId))?.status).toBe("aborted");

    // Exact list, so this also pins `onFinished` firing exactly once and
    // reporting the terminal status the record actually carries.
    expect(events).toEqual(["request.finished:aborted"]);
  });

  /**
   * The other half of the discriminator: the same flow, the same queued work,
   * the same drain — settled normally instead of cancelled. Without this a fix
   * that simply stopped calling `onCompleted` would pass the test above.
   */
  it("still fires them when the same drain settles without a cancel", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_drain_window_hooks_completed";
    const bodyDone = createGate();
    const releaseSideChain = createGate();
    const events: string[] = [];

    const flow = defineFlow({
      kind: "drain-window-hooks-completed",
      request: {
        heartbeatIntervalMs: 0,
        onCompleted: recordingObserver(events, "request.completed"),
        onFinished: recordingObserver(events, "request.finished")
      },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: sequencer({ name: "seq" })
            .sideChain(drainHolder("bg-settles-normally", releaseSideChain.wait))
            .step(handler({
              name: "body-done-hooks-ok",
              inputSchema: z.object({}).passthrough(),
              outputSchema: z.string(),
              execute: async () => {
                bodyDone.open();
                return "body succeeded";
              }
            })),
          onCompleted: recordingObserver(events, "action.completed")
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_drain_hooks_ok",
      stores,
      runtimeConfig: {}
    });

    // Same interleave as the abort case — the task is still pending when the
    // drain starts — but released rather than cancelled.
    await bodyDone.wait;
    releaseSideChain.open();

    const result = await resultPromise;
    expect(result.error).toBeUndefined();
    expect((await stores.request.get(requestId))?.status).toBe("completed");

    // Order matters: action before request, both before `onFinished`.
    expect(events).toEqual([
      "action.completed",
      "request.completed",
      "request.finished:completed"
    ]);
  });

  /**
   * The window on the OTHER side of the abort check, pinned deliberately.
   *
   * The check sits immediately before `action.onCompleted` — there is no
   * statement between them — so it is already the last instant at which
   * `aborted` is a true statement about what the request did. A cancel that
   * lands after it stops nothing: the body's output exists, the side-chain pool has
   * drained, and the only things left are the success hooks and the record
   * write that reports them.
   *
   * So a cancel accepted here settles `completed`, and `/abort` answers 204
   * because the record is still `in_progress` until that write commits. That
   * pairing looks wrong and is not: the alternative is to fire `onCompleted`
   * (committing its side effects) and then report `aborted`, telling the
   * caller nothing happened while the success notification is already out.
   * The record carries `abortRequested: true` beside `completed`, which is the
   * honest account — someone asked, and they asked too late.
   *
   * Staged on two gates, so the cancel provably lands while the first hook is
   * pending rather than on timing. Drives the real route handler, because the
   * 204 is half of what is being pinned.
   */
  it("settles completed for a cancel that lands after the check, while a hook is pending", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_post_check_hook_window";
    const inHook = createGate();
    const releaseHook = createGate();
    const events: string[] = [];

    const flow = defineFlow({
      kind: "post-check-hook-window",
      request: {
        heartbeatIntervalMs: 0,
        onCompleted: recordingObserver(events, "request.completed"),
        onFinished: recordingObserver(events, "request.finished")
      },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "body-post-check",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.string(),
            execute: async () => "body succeeded"
          }),
          // Parks the run inside the FIRST completion hook — past the abort
          // check, before the terminal write.
          onCompleted: handler({
            name: "action-completed-parks",
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async () => {
              events.push("action.completed");
              inHook.open();
              await releaseHook.wait;
            }
          })
        }
      }
    })();

    const resultPromise = runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_post_check",
      stores,
      runtimeConfig: {}
    });

    await inHook.wait;

    const response = await handleAbortRequest(
      new Request(
        `http://localhost/api/flows/post-check-hook-window/requests/${requestId}/abort`,
        { method: "POST" }
      ),
      { kind: "abort_request", flowKind: "post-check-hook-window", requestId },
      { stores }
    );
    // The record is still `in_progress`, so the cancel IS accepted and the
    // controller IS fired. This is the interleave under discussion, reached on
    // the real path rather than argued about.
    expect(response.status).toBe(204);

    releaseHook.open();
    const result = await resultPromise;

    // The output the body genuinely produced is returned, not discarded.
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("body succeeded");

    const record = await stores.request.get(requestId);
    expect(record?.status).toBe("completed");
    // Both halves on one record: the cancel was accepted, and it was too late.
    expect(record?.abortRequested).toBe(true);

    // Exact list. `onCompleted` and the status the request settles with agree —
    // which is the property a re-check placed after these hooks would break.
    expect(events).toEqual([
      "action.completed",
      "request.completed",
      "request.finished:completed"
    ]);
  });

  /**
   * Moving the completion hooks below the work-pool drain took them out from
   * under the barrier. A hook that is a sequencer dispatching `.sideChain()` enqueues
   * into the request pool AFTER the only drain, and an inner sequencer does not
   * auto-await its own work while a request pool exists (FIX-554) — so the
   * request would emit `completed` and return with a notification or state
   * write still running, and the item flush below could miss it. Before the
   * move, that same work was covered by the drain.
   */
  it("drains work queued by the completion hooks before it settles", async () => {
    const stores = createInMemoryStores();
    const requestId = "req_hook_queued_work";
    let sideChainFinished = false;
    const sideChainStarted = createGate();

    const hookSideChain = handler({
      name: "hook-background",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.string(),
      execute: async () => {
        sideChainStarted.open();
        // Long enough that a request which does not wait provably returns
        // first; a request that does wait simply takes this long.
        await new Promise((r) => setTimeout(r, 60));
        sideChainFinished = true;
        return "hook work done";
      }
    });

    const flow = defineFlow({
      kind: "hook-queued-work",
      request: {
        heartbeatIntervalMs: 0,
        // A sequencer, because `.sideChain()` is what a hook uses to fan out — the
        // shape the drain has to cover.
        onCompleted: sequencer({ name: "on-completed-seq" })
          .sideChain(hookSideChain)
          .step(handler({
            name: "hook-body",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.string(),
            execute: async () => "hook body done"
          }))
      },
      actions: {
        run: {
          inputSchema: z.object({}).passthrough(),
          block: handler({
            name: "body-queues-nothing",
            inputSchema: z.object({}).passthrough(),
            outputSchema: z.string(),
            execute: async () => "body succeeded"
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: {},
      requestId,
      userId: "u_hook_work",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // Precondition: the hook really did dispatch background work, so the
    // barrier below has something to be about.
    await sideChainStarted.wait;
    // The barrier itself — `runAction` returned only after the hook's work had
    // finished, not while it was still running in the void.
    expect(sideChainFinished).toBe(true);
    expect((await stores.request.get(requestId))?.status).toBe("completed");
  });
});
