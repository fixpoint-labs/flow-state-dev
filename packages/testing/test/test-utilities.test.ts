import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineResource, generator, handler, router } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "@flow-state-dev/server";
import {
  mockGenerator,
  testBlock,
  testFlow,
  testRouter,
  testItems,
  snapshotTrace
} from "../src";

const passthroughSchema = {
  safeParse: (input: unknown) => ({ success: true as const, data: input })
};

describe("testing utilities", () => {
  it("testBlock executes block and records state changes", async () => {
    const increment = handler<{ amount: number }, { ok: boolean }>({
      name: "increment",
      execute: async (input, ctx) => {
        await ctx.session.incState({ count: input.amount });
        return { ok: true };
      }
    });

    const result = await testBlock(increment, {
      input: { amount: 2 },
      session: { state: { count: 1 } }
    });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ ok: true });
    expect(result.state.session.count).toBe(3);
    expect(result.stateChanges.some((change) => change.operation === "incState")).toBe(true);
  });

  it("registers a block's declared resources so ctx.resources is wired without explicit seeding", async () => {
    // Regression: testBlock/testSequencer ran a block that declared a resource on
    // its `resources:` slot without registering it, so `ctx.resources.X` was
    // undefined and writing to it threw "Cannot read properties of undefined
    // (reading 'setState')". Production wires it via flow.resources collected from
    // the block's declaredResources; the harness must mirror that. This is the gap
    // that made round-robin / debate / routed-specialists fail in the benchmark.
    const ledger = defineResource({
      scope: "session",
      stateSchema: z.object({ entries: z.array(z.string()).default([]) }),
      writable: true
    });

    const record = handler<{ note: string }, { ok: boolean }>({
      name: "record",
      resources: { ledger },
      execute: async (input, ctx) => {
        // Throws unless ctx.resources.ledger was registered from declaredResources.
        await ctx.resources.ledger.setState({ entries: [input.note] } as never);
        return { ok: true };
      }
    });

    const result = await testBlock(record, { input: { note: "hello" } });

    expect(result.error).toBeNull();
    expect(result.output).toEqual({ ok: true });
  });

  it("testRouter reports selected route", async () => {
    const left = handler<{ route: string }, string>({
      name: "left",
      execute: () => "left"
    });
    const right = handler<{ route: string }, string>({
      name: "right",
      execute: () => "right"
    });

    const routeBlock = router<{ route: string }, string>({
      name: "chooser",
      routes: [left, right],
      execute: (input) => (input.route === "right" ? right : left)
    });

    const result = await testRouter(routeBlock, {
      input: { route: "right" }
    });

    expect(result.error).toBeNull();
    expect(result.output).toBe("right");
    expect(result.selectedRoute).toBe("right");
  });

  it("testFlow executes one flow action end-to-end", async () => {
    const flow: FlowInstance = {
      id: "test",
      kind: "test-flow",
      requireUser: true,
      actions: {
        run: {
          inputSchema: passthroughSchema as any,
          block: handler<{ value: string }, { echoed: string }>({
            name: "echo",
            execute: (input) => ({ echoed: input.value })
          })
        }
      }
    } as FlowInstance;

    const result = await testFlow({
      flow,
      action: "run",
      input: { value: "hello" },
      userId: "user_1"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ echoed: "hello" });
  });

  it("testFlow supports generator mocking by block-name and model-id", async () => {
    const chat = generator<{ message: string }, { reply: string }>({
      name: "chat-generator",
      model: "openai/gpt-4o-mini",
      prompt: "Reply to the user",
      outputSchema: passthroughSchema as any
    });
    const fallback = generator<{ message: string }, { reply: string }>({
      name: "fallback-generator",
      model: "openai/gpt-4o-mini",
      prompt: "Fallback",
      outputSchema: passthroughSchema as any
    });

    const flow: FlowInstance = {
      id: "generator-flow",
      kind: "generator-flow",
      requireUser: true,
      actions: {
        run: {
          inputSchema: passthroughSchema as any,
          block: router<{ message: string }, { reply: string }>({
            name: "generator-router",
            routes: [chat, fallback],
            execute: (input) => (input.message === "primary" ? chat : fallback)
          })
        }
      }
    } as FlowInstance;

    const byName = mockGenerator({
      name: "chat-generator",
      script: [{ structuredOutput: { reply: "from block-name" } }]
    });
    const byModel = mockGenerator({
      name: "openai/gpt-4o-mini",
      script: [{ structuredOutput: { reply: "from model-id" } }]
    });

    const primary = await testFlow({
      flow,
      action: "run",
      input: { message: "primary" },
      userId: "user_1",
      generators: { "chat-generator": byName },
      models: { "openai/gpt-4o-mini": byModel }
    });
    expect(primary.status).toBe("completed");
    expect(primary.output).toEqual({ reply: "from block-name" });

    const secondary = await testFlow({
      flow,
      action: "run",
      input: { message: "secondary" },
      userId: "user_1",
      generators: { "chat-generator": byName },
      models: { "openai/gpt-4o-mini": byModel }
    });
    expect(secondary.status).toBe("completed");
    expect(secondary.output).toEqual({ reply: "from model-id" });
  });

  it("testFlow falls back to unmockedDefault instead of throwing on a missing mock", async () => {
    const chat = generator<{ message: string }, { reply: string }>({
      name: "chat-generator",
      model: "openai/gpt-5.4-mini",
      prompt: "Reply to the user",
      outputSchema: passthroughSchema as any
    });

    const flow: FlowInstance = {
      id: "default-flow",
      kind: "default-flow",
      requireUser: true,
      actions: {
        run: {
          inputSchema: passthroughSchema as any,
          block: chat
        }
      }
    } as FlowInstance;

    const result = await testFlow({
      flow,
      action: "run",
      input: { message: "hi" },
      userId: "user_1",
      // No generator/model mock provided for chat-generator.
      unmockedGeneratorPolicy: "default",
      unmockedDefault: { structuredOutput: { reply: "default reply" } }
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ reply: "default reply" });
  });

  it("testFlow shares state across runs when given the same stores", async () => {
    const counter = handler<{ amount: number }, { total: number }>({
      name: "counter",
      execute: async (input, ctx) => {
        const current = (ctx.session.state as { count?: number }).count ?? 0;
        const total = current + input.amount;
        await ctx.session.patchState({ count: total });
        return { total };
      }
    });

    const flow: FlowInstance = {
      id: "stateful",
      kind: "stateful-flow",
      requireUser: true,
      actions: {
        run: {
          inputSchema: passthroughSchema as any,
          block: counter
        }
      }
    } as FlowInstance;

    const stores = createInMemoryStores();
    const sessionId = "test-resume-session";

    const r1 = await testFlow({
      flow,
      action: "run",
      input: { amount: 1 },
      userId: "user_1",
      sessionId,
      stores
    });
    expect(r1.status).toBe("completed");
    expect(r1.output).toEqual({ total: 1 });

    const r2 = await testFlow({
      flow,
      action: "run",
      input: { amount: 2 },
      userId: "user_1",
      sessionId,
      stores
    });
    expect(r2.status).toBe("completed");
    // Second run sees the first run's mutation — proof that the registry
    // is shared and seeding didn't reset the session.
    expect(r2.output).toEqual({ total: 3 });

    const session = await stores.session.get(sessionId);
    expect((session?.state as { count: number }).count).toBe(3);
  });

  it("testItems and snapshotTrace provide deterministic assertions", () => {
    const items = [
      {
        id: "item_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hi" }],
        status: "completed",
        requestId: "req_1",
        itemIndex: 1,
        provenance: {
          blockName: "assistant",
          blockInstanceId: "assistant_1",
          phase: "main"
        },
        ts: 1
      },
      {
        id: "item_2",
        type: "block_trace",
        blockName: "summary",
        output: { ok: true },
        status: "completed",
        requestId: "req_1",
        itemIndex: 2,
        provenance: {
          blockName: "summary",
          blockInstanceId: "summary_1",
          phase: "work"
        },
        ts: 2
      }
    ] as any;

    const selector = testItems(items);
    expect(selector.messages()).toHaveLength(1);
    expect(selector.blockOutputs("summary")).toHaveLength(1);
    expect(selector.work()).toHaveLength(1);

    const trace = snapshotTrace({ items, requestId: "req_1", actionName: "run" });
    expect(trace.requestId).toBe("req_1");
    expect(trace.items).toHaveLength(2);
  });
});
