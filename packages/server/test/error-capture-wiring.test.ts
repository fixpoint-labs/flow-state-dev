import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock,
  runAction
} from "../src";
import { FlowError } from "../src/errors/flow-error";
import type { ErrorCaptureEvent, ErrorCaptureHandler } from "../src/errors/error-capture";

/**
 * Build an execution context wired to an errorCapture handler. Mirrors the
 * harness in execution-internals.test.ts (in-memory stores + response emitter).
 */
async function createCtx(
  requestId: string,
  errorCapture?: ErrorCaptureHandler
) {
  const flow = defineFlow({
    kind: "capture-flow",
    actions: {
      run: { inputSchema: z.any(), block: handler({ name: "noop", execute: (i) => i }) }
    }
  })();

  const stores = createInMemoryStores();
  const response = createResponseEmitter({ requestId, now: () => 1 });

  return createExecutionContext({
    flow,
    actionName: "run",
    requestId,
    sessionId: "sess_cap",
    userId: "user_cap",
    // Explicit resolver bypasses env-driven intent wiring (mirrors the
    // execution-internals harness).
    modelResolver: (modelId) => ({ modelId, async generate() { return { text: "ok" }; } }),
    stores,
    response,
    errorCapture
  });
}

describe("errorCapture wiring", () => {
  it("captures a failing root handler with block identity", async () => {
    const events: ErrorCaptureEvent[] = [];
    const ctx = await createCtx("req_root", (e) => {
      events.push(e);
    });

    const failing = handler({
      name: "failing-root",
      execute: () => {
        throw new Error("root boom");
      }
    });

    const result = await executeBlock({ block: failing, input: 1, ctx });

    expect(result.error).toBeInstanceOf(FlowError);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      requestId: "req_root",
      flowKind: "capture-flow",
      actionName: "run",
      userId: "user_cap",
      blockName: "failing-root",
      blockKind: "handler",
      scope: "block"
    });
    expect(events[0]!.error).toBeInstanceOf(FlowError);
  });

  it("captures the LEAF block once for a nested sequencer failure", async () => {
    const events: ErrorCaptureEvent[] = [];
    const ctx = await createCtx("req_nested", (e) => {
      events.push(e);
    });

    const failingStep = handler({
      name: "failing-step",
      execute: () => {
        throw new Error("leaf boom");
      }
    });
    const passThrough = handler({ name: "pass", execute: (i) => i });
    const seq = sequencer({ name: "root-seq", inputSchema: z.any() })
      .step(passThrough)
      .step(failingStep);

    await executeBlock({ block: seq, input: {}, ctx });

    // Exactly one capture, identifying the leaf step, not the sequencer.
    expect(events).toHaveLength(1);
    expect(events[0]!.blockName).toBe("failing-step");
    expect(events[0]!.blockKind).toBe("handler");
    // Leaf identity is threaded from the firing block's _blockIdentity:
    // blockInstanceId is always present; attempt is only set under a retry
    // policy (undefined for a single-shot block).
    expect(events[0]!.blockInstanceId).toBeTruthy();
    expect(events[0]!.blockPath).toBeTruthy();
  });

  it("does not capture on the success path", async () => {
    const events: ErrorCaptureEvent[] = [];
    const ctx = await createCtx("req_ok", (e) => {
      events.push(e);
    });

    const ok = handler({ name: "ok", execute: (i) => i });
    const result = await executeBlock({ block: ok, input: 42, ctx });

    expect(result.output).toBe(42);
    expect(events).toHaveLength(0);
  });

  it("is a no-op when no errorCapture handler is configured", async () => {
    const ctx = await createCtx("req_none");
    expect(ctx._captureError).toBeUndefined();

    const failing = handler({
      name: "failing",
      execute: () => {
        throw new Error("boom");
      }
    });
    // Must still surface the error result, just without capture.
    const result = await executeBlock({ block: failing, input: 1, ctx });
    expect(result.error).toBeInstanceOf(FlowError);
  });

  it("still captures a failure that a sequencer rescues (request succeeds)", async () => {
    const events: ErrorCaptureEvent[] = [];
    const ctx = await createCtx("req_rescued", (e) => {
      events.push(e);
    });

    const risky = handler({
      name: "risky",
      execute: () => {
        throw new Error("recover me");
      }
    });
    const recover = handler({ name: "recover", execute: () => "recovered" });
    const seq = sequencer({ name: "rescued-seq", inputSchema: z.any() })
      .step(risky)
      .rescue([{ block: recover }]);

    const result = await executeBlock({ block: seq, input: {}, ctx });

    // The request recovers, but the underlying failure is still reported —
    // this is the "capture all failures" behaviour (FIX-724 Q1).
    expect(result.error).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(events[0]!.blockName).toBe("risky");
    expect(events[0]!.error.retryable).toBe(false);
  });

  it("captures through the full runAction / RuntimeConfig plumbing", async () => {
    const events: ErrorCaptureEvent[] = [];
    const failing = handler({
      name: "boom",
      execute: () => {
        throw new Error("e2e boom");
      }
    });
    const flow = defineFlow({
      kind: "e2e-capture-flow",
      actions: { run: { inputSchema: z.any(), block: failing } }
    });

    await runAction({
      flow,
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores: createInMemoryStores(),
      responseEmitter: createResponseEmitter({ requestId: "req_e2e" }),
      runtimeConfig: {
        errorCapture: (e) => {
          events.push(e);
        }
      }
    });

    expect(events).toHaveLength(1);
    // runAction owns the requestId, so just assert it is threaded through.
    expect(events[0]!.requestId).toBeTruthy();
    expect(events[0]).toMatchObject({
      flowKind: "e2e-capture-flow",
      actionName: "run",
      userId: "u",
      blockName: "boom",
      blockKind: "handler",
      scope: "block"
    });
  });

  it("a throwing capture handler does not break execution", async () => {
    const handlerSpy = vi.fn(() => {
      throw new Error("sink exploded");
    });
    const ctx = await createCtx("req_throws", handlerSpy);

    const failing = handler({
      name: "failing",
      execute: () => {
        throw new Error("boom");
      }
    });

    const result = await executeBlock({ block: failing, input: 1, ctx });
    expect(result.error).toBeInstanceOf(FlowError);
    expect(handlerSpy).toHaveBeenCalled();
  });
});
