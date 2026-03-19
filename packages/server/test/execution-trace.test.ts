/**
 * Tests for the execution trace system: persisted block lifecycle events
 * with timing metadata and trace flag filtering.
 */
import {
  defineFlow,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import type { BlockOutputItem, RouterDecisionItem } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  runAction
} from "../src";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSequencerFlow() {
  const innerHandler = handler({
    name: "inner-handler",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    execute: (input) => ({ result: `processed: ${input.message}` })
  });

  const secondHandler = handler({
    name: "second-handler",
    inputSchema: z.object({ result: z.string() }),
    outputSchema: z.object({ final: z.string() }),
    execute: (input) => ({ final: input.result.toUpperCase() })
  });

  const pipeline = sequencer({
    name: "test-pipeline",
    inputSchema: z.object({ message: z.string() })
  })
    .then(innerHandler)
    .then(secondHandler);

  return defineFlow({
    kind: "trace-test-flow",
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: pipeline
      }
    }
  })();
}

function createRouterFlow() {
  const handlerA = handler({
    name: "handler-a",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    execute: (input) => ({ result: `A: ${input.message}` })
  });

  const handlerB = handler({
    name: "handler-b",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    execute: (input) => ({ result: `B: ${input.message}` })
  });

  const testRouter = router({
    name: "test-router",
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    routes: [handlerA, handlerB],
    execute: (input) => input.message.startsWith("A") ? handlerA : handlerB
  });

  return defineFlow({
    kind: "router-trace-flow",
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: testRouter
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("execution trace system", () => {
  describe("root block tracing (executeBlock)", () => {
    it("emits block_output with blockKind, timing, and trace flag for a simple handler", async () => {
      const simpleHandler = handler({
        name: "simple-handler",
        inputSchema: z.object({ x: z.number() }),
        outputSchema: z.object({ y: z.number() }),
        execute: (input) => ({ y: input.x * 2 })
      });

      const flow = defineFlow({
        kind: "kind-test-flow",
        actions: {
          run: {
            inputSchema: z.object({ x: z.number() }),
            block: simpleHandler
          }
        }
      })();

      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_kind", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { x: 5 },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeUndefined();

      const items = response.getItems();
      const blockOutputItems = items.filter(
        (i) => i.type === "block_output"
      ) as BlockOutputItem[];

      const rootItem = blockOutputItems.find((i) => i.blockName === "simple-handler");
      expect(rootItem).toBeDefined();
      expect(rootItem!.blockKind).toBe("handler");
      expect(rootItem!.trace).toBe(true);
      expect(rootItem!.startedAt).toBeDefined();
      expect(rootItem!.completedAt).toBeDefined();
      expect(rootItem!.duration).toBeGreaterThanOrEqual(0);
      expect(typeof rootItem!.startedAt).toBe("number");
      expect(typeof rootItem!.completedAt).toBe("number");
    });
  });

  describe("nested block tracing (_withExecutionScope)", () => {
    it("emits lifecycle trace items for sequencer steps", async () => {
      const flow = createSequencerFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_seq", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { message: "hello" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeUndefined();

      const items = response.getItems();
      const traceItems = items.filter(
        (i) => i.type === "block_output" && i.trace === true
      ) as BlockOutputItem[];

      // At least the root pipeline + nested handlers should produce trace items.
      expect(traceItems.length).toBeGreaterThanOrEqual(1);

      // All trace items should have blockKind set.
      for (const item of traceItems) {
        expect(item.blockKind).toBeDefined();
        expect(typeof item.blockName).toBe("string");
      }

      // Completed trace items should have timing metadata.
      const completedTraces = traceItems.filter((i) => i.status === "completed");
      expect(completedTraces.length).toBeGreaterThanOrEqual(1);
      for (const item of completedTraces) {
        expect(item.startedAt).toBeDefined();
        expect(item.completedAt).toBeDefined();
        expect(item.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("emits lifecycle items with failed status for blocks that throw", async () => {
      const failingHandler = handler({
        name: "failing-handler",
        inputSchema: z.object({ message: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        execute: () => {
          throw new Error("intentional failure");
        }
      });

      const pipeline = sequencer({
        name: "failing-pipeline",
        inputSchema: z.object({ message: z.string() })
      }).then(failingHandler);

      const flow = defineFlow({
        kind: "fail-trace-flow",
        actions: {
          run: {
            inputSchema: z.object({ message: z.string() }),
            block: pipeline
          }
        }
      })();

      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_fail", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { message: "hello" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeDefined();

      const items = response.getItems();
      const traceItems = items.filter(
        (i) => i.type === "block_output" && i.trace === true
      ) as BlockOutputItem[];

      expect(traceItems.length).toBeGreaterThanOrEqual(1);

      // At least one trace item should have failed status.
      const failedItems = traceItems.filter((i) => i.status === "failed");
      expect(failedItems.length).toBeGreaterThanOrEqual(1);

      // Failed items should still have timing.
      for (const item of failedItems) {
        expect(item.startedAt).toBeDefined();
        expect(item.duration).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("router decision tracing", () => {
    it("emits router_decision items when a route is selected", async () => {
      const flow = createRouterFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_router", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { message: "A test" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeUndefined();

      // Allow fire-and-forget trace emissions to settle.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const items = response.getItems();
      const routerDecisions = items.filter(
        (i) => i.type === "router_decision"
      ) as RouterDecisionItem[];

      expect(routerDecisions.length).toBeGreaterThanOrEqual(1);

      const decision = routerDecisions[0]!;
      expect(decision.routerName).toBe("test-router");
      expect(decision.selectedRoute).toBe("handler-a");
      expect(decision.trace).toBe(true);
    });

    it("selects the correct route based on input", async () => {
      const flow = createRouterFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_router_b", now: () => Date.now() });

      await runAction({
        flow,
        actionName: "run",
        input: { message: "B test" },
        userId: "user_1",
        sessionId: "sess_2",
        stores,
        responseEmitter: response
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const items = response.getItems();
      const routerDecisions = items.filter(
        (i) => i.type === "router_decision"
      ) as RouterDecisionItem[];

      expect(routerDecisions.length).toBeGreaterThanOrEqual(1);
      expect(routerDecisions[0]!.selectedRoute).toBe("handler-b");
    });
  });

  describe("trace flag filtering", () => {
    it("marks all lifecycle block_output items with trace: true", async () => {
      const flow = createSequencerFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_filter", now: () => Date.now() });

      await runAction({
        flow,
        actionName: "run",
        input: { message: "hello" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      const items = response.getItems();
      const blockOutputItems = items.filter(
        (i) => i.type === "block_output"
      ) as BlockOutputItem[];

      // All block_output items from lifecycle tracing should have trace: true.
      for (const item of blockOutputItems) {
        expect(item.trace).toBe(true);
      }
    });

    it("marks all router_decision items with trace: true", async () => {
      const flow = createRouterFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_rd_filter", now: () => Date.now() });

      await runAction({
        flow,
        actionName: "run",
        input: { message: "A test" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const items = response.getItems();
      const routerDecisions = items.filter((i) => i.type === "router_decision");
      for (const item of routerDecisions) {
        expect(item.trace).toBe(true);
      }
    });

    it("excludes trace items from LLM history and includes block_tool_output", async () => {
      const flow = defineFlow({
        kind: "llm-filter-flow",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "llm-filter-handler",
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.object({ ok: z.boolean() }),
              execute: () => ({ ok: true })
            })
          }
        }
      })();

      const stores = createInMemoryStores();
      const prov = { blockName: "gen", blockInstanceId: "gen_1", phase: "main" as const };

      // Pre-populate a completed request with a mix of trace and non-trace items.
      await stores.request.set("req_prev_llm", {
        id: "req_prev_llm",
        flowKind: flow.kind,
        actionName: "run",
        sessionId: "sess_llm",
        userId: "user_llm",
        status: "completed",
        startedAtMs: 1,
        updatedAt: 1,
        items: [
          {
            id: "msg_1",
            type: "message",
            status: "completed",
            requestId: "req_prev_llm",
            itemIndex: 0,
            ts: 1,
            role: "user",
            content: [{ type: "output_text", text: "hello" }],
            provenance: prov
          },
          {
            id: "msg_2",
            type: "message",
            status: "completed",
            requestId: "req_prev_llm",
            itemIndex: 1,
            ts: 2,
            role: "assistant",
            content: [{ type: "output_text", text: "world" }],
            provenance: prov
          },
          // Trace block_output — should be EXCLUDED from LLM history
          {
            id: "bo_trace",
            type: "block_output",
            status: "completed",
            trace: true,
            requestId: "req_prev_llm",
            itemIndex: 2,
            ts: 3,
            blockName: "inner",
            blockKind: "handler",
            output: { data: "trace-only" },
            startedAt: 1,
            completedAt: 3,
            duration: 2,
            provenance: prov
          },
          // Router decision — should be EXCLUDED from LLM history
          {
            id: "rd_1",
            type: "router_decision",
            status: "completed",
            trace: true,
            requestId: "req_prev_llm",
            itemIndex: 3,
            ts: 4,
            routerName: "my-router",
            selectedRoute: "route-a",
            provenance: prov
          },
          // block_tool_output — should be INCLUDED in LLM history (no trace flag)
          {
            id: "bto_1",
            type: "block_tool_output",
            status: "completed",
            requestId: "req_prev_llm",
            itemIndex: 4,
            ts: 5,
            blockName: "tool-block",
            output: "tool result",
            toolCall: {
              callId: "call_1",
              name: "tool-block",
              arguments: "{}",
              generatorBlock: "gen"
            },
            provenance: prov
          }
        ]
      } as any);

      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_cur_llm",
        sessionId: "sess_llm",
        userId: "user_llm",
        stores
      });

      const llmMessages = await ctx.session.items.llm();

      // Should contain the two messages, plus the tool-call/tool-result pair.
      // AI SDK v6 requires tool results to be preceded by an assistant message
      // with a matching tool-call part, so block_tool_output items expand into
      // two messages (assistant tool-call + tool result).
      expect(llmMessages).toHaveLength(4);
      expect(llmMessages[0]).toEqual({ role: "user", content: "hello" });
      expect(llmMessages[1]).toEqual({ role: "assistant", content: "world" });
      expect(llmMessages[2]).toEqual({
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "tool-block",
          args: {}
        }]
      });
      expect(llmMessages[3]).toEqual({
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "call_1",
          toolName: "tool-block",
          output: { type: "text", value: "tool result" }
        }]
      });

      // Verify none of the trace items leaked through.
      const allContents = llmMessages.map((m: any) => m.content);
      expect(allContents).not.toContain(JSON.stringify({ data: "trace-only" }));
    });
  });

  describe("_blockIdentity provenance", () => {
    it("provides correct parentBlockInstanceId for nested block trace items", async () => {
      const innerHandler = handler({
        name: "identity-inner",
        inputSchema: z.object({ x: z.number() }),
        outputSchema: z.object({ y: z.number() }),
        execute: (input) => ({ y: input.x + 1 })
      });

      const pipeline = sequencer({
        name: "identity-pipeline",
        inputSchema: z.object({ x: z.number() })
      }).then(innerHandler);

      const flow = defineFlow({
        kind: "identity-flow",
        actions: {
          run: {
            inputSchema: z.object({ x: z.number() }),
            block: pipeline
          }
        }
      })();

      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_identity", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { x: 1 },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeUndefined();

      const items = response.getItems();
      const traceItems = items.filter(
        (i) => i.type === "block_output" && i.trace === true
      ) as BlockOutputItem[];

      // Nested handler trace items should have parentBlockInstanceId set.
      const nestedTraces = traceItems.filter(
        (i) => i.provenance.parentBlockInstanceId !== undefined
      );
      expect(nestedTraces.length).toBeGreaterThanOrEqual(1);

      // parentBlockInstanceId should point to a real block instance
      // (not synthetic or undefined).
      for (const item of nestedTraces) {
        expect(item.provenance.parentBlockInstanceId).toBeTruthy();
        expect(item.provenance.parentBlockInstanceId).not.toBe(item.provenance.blockInstanceId);
      }
    });

    it("router decision items use the router's actual blockInstanceId", async () => {
      const flow = createRouterFlow();
      const stores = createInMemoryStores();
      const response = createResponseEmitter({ requestId: "req_router_id", now: () => Date.now() });

      const result = await runAction({
        flow,
        actionName: "run",
        input: { message: "A test" },
        userId: "user_1",
        sessionId: "sess_1",
        stores,
        responseEmitter: response
      });

      expect(result.error).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const items = response.getItems();
      const routerDecisions = items.filter(
        (i) => i.type === "router_decision"
      ) as RouterDecisionItem[];

      expect(routerDecisions.length).toBeGreaterThanOrEqual(1);

      const decision = routerDecisions[0]!;
      // Should use the router's actual blockInstanceId (dynamic, contains timestamp)
      // not a synthetic fallback like "test-router_<requestId>".
      expect(decision.provenance.blockInstanceId).toContain("test-router_");
      expect(decision.provenance.blockInstanceId).not.toBe(`test-router_${decision.requestId}`);
    });
  });
});
