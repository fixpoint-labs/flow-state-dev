/**
 * Tests for block_debug item emission.
 *
 * Validates: env var gating, payload construction for each block kind,
 * transient/trace flags, and the generator runtime hook path.
 */
import {
  defineFlow,
  generator,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock
} from "../src";
import {
  isDebugItemsEnabled,
  buildStaticBlockDebugPayload,
  buildGeneratorDebugPayload
} from "../src/execution/internal/debug-items";

/* ---------- isDebugItemsEnabled ---------- */

describe("isDebugItemsEnabled", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns true when FSDEV_DEBUG_ITEMS=true', () => {
    process.env.FSDEV_DEBUG_ITEMS = "true";
    expect(isDebugItemsEnabled()).toBe(true);
  });

  it('returns true when FSDEV_DEBUG_ITEMS=1', () => {
    process.env.FSDEV_DEBUG_ITEMS = "1";
    expect(isDebugItemsEnabled()).toBe(true);
  });

  it('returns false when FSDEV_DEBUG_ITEMS=false', () => {
    process.env.FSDEV_DEBUG_ITEMS = "false";
    expect(isDebugItemsEnabled()).toBe(false);
  });

  it('returns false when FSDEV_DEBUG_ITEMS=0', () => {
    process.env.FSDEV_DEBUG_ITEMS = "0";
    expect(isDebugItemsEnabled()).toBe(false);
  });

  it('defaults to true when NODE_ENV is not production', () => {
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "development";
    expect(isDebugItemsEnabled()).toBe(true);
  });

  it('defaults to true when NODE_ENV is test', () => {
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "test";
    expect(isDebugItemsEnabled()).toBe(true);
  });

  it('defaults to false when NODE_ENV is production', () => {
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "production";
    expect(isDebugItemsEnabled()).toBe(false);
  });
});

/* ---------- buildStaticBlockDebugPayload ---------- */

describe("buildStaticBlockDebugPayload", () => {
  it("extracts router candidates", () => {
    const routeA = handler({
      name: "route-a",
      execute: () => "a"
    });
    const routeB = handler({
      name: "route-b",
      execute: () => "b"
    });

    const block = router({
      name: "test-router",
      routes: [routeA, routeB],
      execute: () => routeA,
    });

    const payload = buildStaticBlockDebugPayload(block);
    expect(payload.candidates).toEqual(["route-a", "route-b"]);
  });

  it("extracts sequencer state keys", () => {
    const step = handler({
      name: "step",
      execute: () => "done"
    });
    const block = sequencer({
      name: "test-seq",
      stateSchema: z.object({
        count: z.number(),
        label: z.string(),
      }),
      steps: [step],
    });

    const payload = buildStaticBlockDebugPayload(block);
    expect(payload.stateKeys).toEqual(["count", "label"]);
  });

  it("returns empty payload for handler without schemas", () => {
    const block = handler({
      name: "simple",
      execute: () => "ok",
    });

    const payload = buildStaticBlockDebugPayload(block);
    expect(payload).toEqual({});
  });
});

/* ---------- buildGeneratorDebugPayload ---------- */

describe("buildGeneratorDebugPayload", () => {
  it("maps capture payload to debug payload", () => {
    const payload = buildGeneratorDebugPayload({
      model: "claude-sonnet-4-5",
      prompt: "You are a helpful assistant.\n\nAdditional context here.",
      tools: ["search", "calculator"],
      maxTokens: 4096,
      search: true,
    });

    expect(payload.model).toBe("claude-sonnet-4-5");
    expect(payload.prompt).toBe("You are a helpful assistant.\n\nAdditional context here.");
    expect(payload.tools).toEqual(["search", "calculator"]);
    expect(payload.maxTokens).toBe(4096);
    expect(payload.search).toBe(true);
  });

  it("omits empty tools array", () => {
    const payload = buildGeneratorDebugPayload({
      model: "gpt-4o",
      prompt: "hello",
      tools: [],
      search: false,
    });

    expect(payload.tools).toBeUndefined();
    expect(payload.search).toBeUndefined();
  });
});

/* ---------- Integration: block_debug emission during executeBlock ---------- */

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

  it("emits block_debug item for handler blocks", async () => {
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
    const debugItem = items.find((i) => i.type === "block_debug");
    expect(debugItem).toBeDefined();
    expect(debugItem!.transient).toBe(true);
    expect((debugItem as any).client).toBe(false);
    expect((debugItem as any).history).toBe(false);
    expect((debugItem as any).blockName).toBe("test-handler");
    expect((debugItem as any).blockKind).toBe("handler");
  });

  it("emits block_debug item for router blocks", async () => {
    const { ctx, response } = await createTestContext("req_debug_router");

    const routeA = handler({ name: "route-a", execute: () => "a" });
    const block = router({
      name: "test-router",
      routes: [routeA],
      execute: () => routeA,
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_debug_router",
        actionName: "run",
        blockName: "test-router",
        blockKind: "router",
        blockInstanceId: "inst_2",
      },
    });

    const items = response.getItems();
    const debugItem = items.find((i) => i.type === "block_debug");
    expect(debugItem).toBeDefined();
    expect((debugItem as any).payload.candidates).toEqual(["route-a"]);
  });

  it("does not emit block_debug when FSDEV_DEBUG_ITEMS=false", async () => {
    process.env.FSDEV_DEBUG_ITEMS = "false";

    const { ctx, response } = await createTestContext("req_no_debug");

    const block = handler({
      name: "quiet-handler",
      execute: () => "result",
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

  it("does not emit block_debug in production mode (default)", async () => {
    delete process.env.FSDEV_DEBUG_ITEMS;
    process.env.NODE_ENV = "production";

    const { ctx, response } = await createTestContext("req_prod");

    const block = handler({
      name: "prod-handler",
      execute: () => "result",
    });

    await executeBlock({
      block,
      input: "hello",
      ctx,
      metadata: {
        requestId: "req_prod",
        actionName: "run",
        blockName: "prod-handler",
        blockKind: "handler",
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
