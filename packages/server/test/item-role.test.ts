/**
 * Tests for the item role system: conversational vs. trace item designation
 * for history assembly filtering (FIX-382).
 */
import {
  defineFlow,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type {
  BlockOutputItem,
  MessageItem,
  OutputItem,
  ItemRole
} from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a flow with a handler that emits a message via ctx.emitMessage. */
function createMessageEmittingFlow(options?: { itemRole?: ItemRole }) {
  const emitter = handler({
    name: "message-emitter",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ emitted: z.boolean() }),
    ...(options?.itemRole !== undefined ? { itemRole: options.itemRole } : {}),
    execute: (input, ctx) => {
      const handle = ctx.emitMessage(input.text);
      handle.done();
      return { emitted: true };
    }
  });

  return defineFlow({
    kind: "message-emit-flow",
    actions: {
      run: {
        inputSchema: z.object({ text: z.string() }),
        block: emitter
      }
    }
  })();
}

/** Creates a flow with a sequencer that has a step emitting a message. */
function createSequencerFlow(options?: { handlerItemRole?: ItemRole }) {
  const msgHandler = handler({
    name: "seq-message-handler",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    ...(options?.handlerItemRole !== undefined
      ? { itemRole: options.handlerItemRole }
      : {}),
    execute: (input, ctx) => {
      const handle = ctx.emitMessage(`Response: ${input.text}`);
      handle.done();
      return { result: input.text };
    }
  });

  const pipeline = sequencer({
    name: "test-pipeline",
    inputSchema: z.object({ text: z.string() })
  }).then(msgHandler);

  return defineFlow({
    kind: "sequencer-flow",
    actions: {
      run: {
        inputSchema: z.object({ text: z.string() }),
        block: pipeline
      }
    }
  })();
}

async function runFlowAndGetItems(
  flow: ReturnType<ReturnType<typeof defineFlow>>,
  input: Record<string, unknown>,
  sessionId = "sess_1"
) {
  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId: `req_${Date.now()}`,
    now: () => Date.now()
  });

  const result = await runAction({
    flow,
    actionName: "run",
    input,
    userId: "user_1",
    sessionId,
    stores,
    responseEmitter: response
  });

  return { result, items: response.getItems(), stores };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("item role system", () => {
  describe("structural items default to trace", () => {
    it("block_output items have itemRole: trace", async () => {
      const flow = createMessageEmittingFlow();
      const { items } = await runFlowAndGetItems(flow, { text: "hello" });

      const blockOutputs = items.filter(
        (i) => i.type === "block_output"
      ) as BlockOutputItem[];

      expect(blockOutputs.length).toBeGreaterThanOrEqual(1);
      for (const item of blockOutputs) {
        expect(item.itemRole).toBe("trace");
        expect(item.trace).toBe(true);
      }
    });

    it("router_decision items have itemRole: trace", async () => {
      const { router } = await import("@flow-state-dev/core");

      const handlerA = handler({
        name: "handler-a",
        inputSchema: z.object({ x: z.string() }),
        outputSchema: z.object({ y: z.string() }),
        execute: (input) => ({ y: input.x })
      });

      const testRouter = router({
        name: "test-router",
        inputSchema: z.object({ x: z.string() }),
        outputSchema: z.object({ y: z.string() }),
        routes: [handlerA],
        execute: () => handlerA
      });

      const flow = defineFlow({
        kind: "router-flow",
        actions: {
          run: {
            inputSchema: z.object({ x: z.string() }),
            block: testRouter
          }
        }
      })();

      const { items } = await runFlowAndGetItems(flow, { x: "test" });

      const decisions = items.filter((i) => i.type === "router_decision");
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      for (const item of decisions) {
        expect(item.itemRole).toBe("trace");
      }
    });
  });

  describe("message items from main phase", () => {
    it("message items emitted by handler in main phase have no explicit itemRole (resolves to message)", async () => {
      const flow = createMessageEmittingFlow();
      const { items } = await runFlowAndGetItems(flow, { text: "hello" });

      const messages = items.filter(
        (i) => i.type === "message"
      ) as MessageItem[];

      expect(messages.length).toBeGreaterThanOrEqual(1);
      for (const msg of messages) {
        // In main phase with no override, itemRole is undefined (resolves to "message")
        expect(msg.itemRole).toBeUndefined();
      }
    });
  });

  describe("explicit itemRole override on block config", () => {
    it("block with itemRole: trace stamps trace on emitted message items", async () => {
      const flow = createMessageEmittingFlow({ itemRole: "trace" });
      const { items } = await runFlowAndGetItems(flow, { text: "hello" });

      const messages = items.filter(
        (i) => i.type === "message"
      ) as MessageItem[];

      expect(messages.length).toBeGreaterThanOrEqual(1);
      for (const msg of messages) {
        expect(msg.itemRole).toBe("trace");
      }
    });

    it("block with itemRole: message in sequencer stamps message on items", async () => {
      const flow = createSequencerFlow({ handlerItemRole: "message" });
      const { items } = await runFlowAndGetItems(flow, { text: "hello" });

      const messages = items.filter(
        (i) => i.type === "message"
      ) as MessageItem[];

      expect(messages.length).toBeGreaterThanOrEqual(1);
      for (const msg of messages) {
        expect(msg.itemRole).toBe("message");
      }
    });
  });

  describe("itemRole on BlockDefinition", () => {
    it("handler() with itemRole propagates to BlockDefinition", () => {
      const h = handler({
        name: "test",
        inputSchema: z.any(),
        outputSchema: z.any(),
        itemRole: "trace",
        execute: () => ({})
      });

      expect(h.itemRole).toBe("trace");
    });

    it("handler() without itemRole has undefined itemRole on definition", () => {
      const h = handler({
        name: "test",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: () => ({})
      });

      expect(h.itemRole).toBeUndefined();
    });
  });
});
