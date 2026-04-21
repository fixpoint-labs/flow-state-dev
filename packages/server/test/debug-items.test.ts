/**
 * Tests for block_debug item emission.
 *
 * Validates: env var gating, payload shape, transient/trace flags, the
 * generator runtime hook path, the connected-input capture path, and
 * suppression for non-generator blocks with no transforming connector.
 */
import {
  defineFlow,
  generator,
  handler,
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock
} from "../src";
import { isTraceObservabilityEnabled } from "@flow-state-dev/core";
import {
  buildGeneratorDebugPayload,
  buildConnectedInputDebugPayload
} from "../src/execution/internal/debug-items";

/* ---------- trace observability gate ---------- */

describe("isTraceObservabilityEnabled", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns true when FSDEV_TRACE_OBSERVABILITY=true', () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "true";
    delete process.env.FSDEV_DEBUG_ITEMS;
    expect(isTraceObservabilityEnabled()).toBe(true);
  });

  it('returns false when FSDEV_TRACE_OBSERVABILITY=false', () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    delete process.env.FSDEV_DEBUG_ITEMS;
    expect(isTraceObservabilityEnabled()).toBe(false);
  });

  it('honors FSDEV_TRACE_OBSERVABILITY over legacy FSDEV_DEBUG_ITEMS', () => {
    process.env.FSDEV_TRACE_OBSERVABILITY = "false";
    process.env.FSDEV_DEBUG_ITEMS = "true";
    expect(isTraceObservabilityEnabled()).toBe(false);
  });

  it('falls back to legacy FSDEV_DEBUG_ITEMS when primary is unset', () => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    process.env.FSDEV_DEBUG_ITEMS = "true";
    expect(isTraceObservabilityEnabled()).toBe(true);
  });

  it('defaults to true when NODE_ENV is not production', () => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "development";
    expect(isTraceObservabilityEnabled()).toBe(true);
  });

  it('defaults to false when NODE_ENV is production', () => {
    delete process.env.FSDEV_TRACE_OBSERVABILITY;
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "production";
    expect(isTraceObservabilityEnabled()).toBe(false);
  });
});

/* ---------- payload builders ---------- */

describe("buildGeneratorDebugPayload", () => {
  it("maps capture payload to debug payload", () => {
    const payload = buildGeneratorDebugPayload({
      model: "claude-sonnet-4-5",
      prompt: "You are a helpful assistant.\n\nAdditional context here.",
      tools: ["search", "calculator"],
    });

    expect(payload.model).toBe("claude-sonnet-4-5");
    expect(payload.prompt).toBe("You are a helpful assistant.\n\nAdditional context here.");
    expect(payload.tools).toEqual(["search", "calculator"]);
  });

  it("omits empty tools array", () => {
    const payload = buildGeneratorDebugPayload({
      model: "gpt-4o",
      prompt: "hello",
      tools: [],
    });

    expect(payload.tools).toBeUndefined();
  });
});

describe("buildConnectedInputDebugPayload", () => {
  it("wraps the transformed value", () => {
    const payload = buildConnectedInputDebugPayload({ a: 1, b: "two" });
    expect(payload.connectedInput).toEqual({ a: 1, b: "two" });
  });
});

/* ---------- Integration: emission during executeBlock ---------- */

async function createTestContext(requestId: string) {
  const block = handler({
    name: "ctx-block",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: (v) => v,
  });

  const flow = defineFlow({
    kind: "test-flow",
    actions: {
      run: {
        inputSchema: z.any(),
        block,
      },
    },
  })();

  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId,
    now: () => Date.now(),
  });

  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId,
    sessionId: "sess_debug",
    userId: "user_debug",
    modelResolver: (modelId) => ({
      modelId,
      async generate() {
        return { text: "mock-output" };
      },
    }),
    stores,
    response,
  });

  return { ctx, response };
}

describe("block_debug emission via executeBlock", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FSDEV_DEBUG_ITEMS = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("does NOT emit block_debug for a plain handler (no connector)", async () => {
    const { ctx, response } = await createTestContext("req_debug_handler");

    const block = handler({
      name: "test-handler",
      execute: () => "result",
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_debug_handler",
        actionName: "run",
        blockName: "test-handler",
        blockKind: "handler",
        blockInstanceId: "inst_1",
      },
    });

    const items = response.getItems();
    const debugItems = items.filter((i) => i.type === "block_debug");
    expect(debugItems).toHaveLength(0);
  });

  it("emits block_debug with connectedInput when a handler's connectInput transforms the input", async () => {
    const { ctx, response } = await createTestContext("req_debug_connected");

    const block = handler({
      name: "transforming-handler",
      inputSchema: z.object({ upper: z.string() }),
      connectInput: (raw: { text: string }) => ({ upper: raw.text.toUpperCase() }),
      execute: (input) => input.upper,
    });

    await executeBlock({
      block,
      input: { text: "hello" },
      ctx,
      metadata: {
        requestId: "req_debug_connected",
        actionName: "run",
        blockName: "transforming-handler",
        blockKind: "handler",
        blockInstanceId: "inst_connected",
      },
    });

    const items = response.getItems();
    const debugItem = items.find((i) => i.type === "block_debug");
    expect(debugItem).toBeDefined();
    expect(debugItem!.transient).toBe(true);
    expect((debugItem as any).client).toBe(false);
    expect((debugItem as any).history).toBe(false);
    expect((debugItem as any).blockName).toBe("transforming-handler");
    expect((debugItem as any).payload.connectedInput).toEqual({ upper: "HELLO" });
  });

  it("does NOT emit block_debug when FSDEV_DEBUG_ITEMS=false", async () => {
    process.env.FSDEV_DEBUG_ITEMS = "false";

    const { ctx, response } = await createTestContext("req_no_debug");

    const block = handler({
      name: "quiet-handler",
      connectInput: (raw: string) => raw.toUpperCase(),
      execute: (v: string) => v,
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_no_debug",
        actionName: "run",
        blockName: "quiet-handler",
        blockKind: "handler",
        blockInstanceId: "inst_3",
      },
    });

    const items = response.getItems();
    const debugItems = items.filter((i) => i.type === "block_debug");
    expect(debugItems).toHaveLength(0);
  });

  it("does NOT emit block_debug in production mode (default)", async () => {
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "production";

    const { ctx, response } = await createTestContext("req_prod");

    const block = generator({
      name: "prod-gen",
      model: "mock-model",
      prompt: "hi",
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_prod",
        actionName: "run",
        blockName: "prod-gen",
        blockKind: "generator",
        blockInstanceId: "inst_4",
      },
    });

    const items = response.getItems();
    const debugItems = items.filter((i) => i.type === "block_debug");
    expect(debugItems).toHaveLength(0);
  });

  it("emits block_debug for generator blocks via onBlockDebugCapture hook", async () => {
    const { ctx, response } = await createTestContext("req_debug_gen");

    const block = generator({
      name: "test-gen",
      model: "mock-model",
      prompt: "You are helpful.",
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_debug_gen",
        actionName: "run",
        blockName: "test-gen",
        blockKind: "generator",
        blockInstanceId: "inst_5",
      },
    });

    const items = response.getItems();
    const debugItem = items.find((i) => i.type === "block_debug");
    expect(debugItem).toBeDefined();
    expect((debugItem as any).blockKind).toBe("generator");
    expect((debugItem as any).payload.model).toBe("mock-model");
    expect((debugItem as any).payload.prompt).toContain("You are helpful.");
  });
});
