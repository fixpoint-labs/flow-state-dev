import {
  defineFlow,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { Middleware } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  composeMiddleware,
  mergeMiddlewareStacks,
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock,
  runAction
} from "../src";

async function createTestContext(requestId: string, flow?: ReturnType<ReturnType<typeof defineFlow>>) {
  const defaultBlock = handler({
    name: "echo",
    inputSchema: z.string(),
    outputSchema: z.string(),
    execute: (input) => input
  });

  const defaultFlow = flow ?? defineFlow({
    kind: "middleware-test",
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: defaultBlock
      }
    }
  })();

  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId,
    now: () => Date.now()
  });

  const ctx = await createExecutionContext({
    flow: defaultFlow,
    actionName: "run",
    requestId,
    sessionId: "sess_mw",
    userId: "user_mw",
    modelResolver: (modelId) => ({
      modelId,
      async generate() {
        return { text: "ok" };
      }
    }),
    stores,
    response
  });

  return { ctx, stores, flow: defaultFlow };
}

describe("middleware composition", () => {
  it("passes through when no middleware is provided", async () => {
    const run = composeMiddleware([], { name: "test", kind: "handler" });
    const result = await run({ block: { name: "test", kind: "handler" }, input: "hello" }, async () => "world");
    expect(result).toBe("world");
  });

  it("composes middleware in outer-to-inner order", async () => {
    const order: string[] = [];

    const outer: Middleware = {
      name: "outer",
      execute: async (ctx, next) => {
        order.push("outer-before");
        const result = await next();
        order.push("outer-after");
        return result;
      }
    };

    const inner: Middleware = {
      name: "inner",
      execute: async (ctx, next) => {
        order.push("inner-before");
        const result = await next();
        order.push("inner-after");
        return result;
      }
    };

    const run = composeMiddleware([outer, inner], { name: "test", kind: "handler" });
    const result = await run(
      { block: { name: "test", kind: "handler" }, input: "x" },
      async () => {
        order.push("execute");
        return "done";
      }
    );

    expect(result).toBe("done");
    expect(order).toEqual([
      "outer-before",
      "inner-before",
      "execute",
      "inner-after",
      "outer-after"
    ]);
  });

  it("allows middleware to transform output", async () => {
    const doubler: Middleware = {
      name: "doubler",
      execute: async (ctx, next) => {
        const output = await next();
        return `${output}${output}`;
      }
    };

    const run = composeMiddleware([doubler], { name: "test", kind: "handler" });
    const result = await run(
      { block: { name: "test", kind: "handler" }, input: "x" },
      async () => "ab"
    );
    expect(result).toBe("abab");
  });

  it("allows middleware to short-circuit (skip next)", async () => {
    const shortCircuit: Middleware = {
      name: "short-circuit",
      execute: async () => "intercepted"
    };

    const run = composeMiddleware([shortCircuit], { name: "test", kind: "handler" });
    let executed = false;
    const result = await run(
      { block: { name: "test", kind: "handler" }, input: "x" },
      async () => {
        executed = true;
        return "original";
      }
    );
    expect(result).toBe("intercepted");
    expect(executed).toBe(false);
  });

  it("applies filter to skip non-matching blocks", async () => {
    const handlerOnly: Middleware = {
      name: "handler-only",
      execute: async (ctx, next) => {
        const output = await next();
        return `wrapped:${output}`;
      },
      filter: (block) => block.kind === "handler"
    };

    // Handler block should be wrapped
    const runHandler = composeMiddleware([handlerOnly], { name: "test", kind: "handler" });
    const handlerResult = await runHandler(
      { block: { name: "test", kind: "handler" }, input: "x" },
      async () => "value"
    );
    expect(handlerResult).toBe("wrapped:value");

    // Generator block should pass through
    const runGenerator = composeMiddleware([handlerOnly], { name: "test", kind: "generator" });
    const generatorResult = await runGenerator(
      { block: { name: "test", kind: "generator" }, input: "x" },
      async () => "value"
    );
    expect(generatorResult).toBe("value");
  });
});

describe("mergeMiddlewareStacks", () => {
  it("merges stacks in order, skipping undefined", () => {
    const a: Middleware = { name: "a", execute: async (_, next) => next() };
    const b: Middleware = { name: "b", execute: async (_, next) => next() };
    const c: Middleware = { name: "c", execute: async (_, next) => next() };

    const merged = mergeMiddlewareStacks([a], undefined, [b, c], []);
    expect(merged.map((m) => m.name)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when all undefined", () => {
    const merged = mergeMiddlewareStacks(undefined, undefined);
    expect(merged).toEqual([]);
  });
});

describe("middleware integration with executeBlock", () => {
  it("runs block-level middleware around block execution", async () => {
    const order: string[] = [];

    const mw: Middleware = {
      name: "block-mw",
      execute: async (ctx, next) => {
        order.push("before");
        const result = await next();
        order.push("after");
        return result;
      }
    };

    const block = handler({
      name: "tracked",
      inputSchema: z.number(),
      outputSchema: z.number(),
      middleware: [mw],
      execute: (input) => {
        order.push("execute");
        return input * 2;
      }
    });

    const { ctx } = await createTestContext("req_mw_block");
    const result = await executeBlock({
      block,
      input: 5,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(10);
    expect(order).toEqual(["before", "execute", "after"]);
  });

  it("runs caller middleware + block middleware in correct order", async () => {
    const order: string[] = [];

    const globalMw: Middleware = {
      name: "global",
      execute: async (ctx, next) => {
        order.push("global");
        return next();
      }
    };

    const blockMw: Middleware = {
      name: "block",
      execute: async (ctx, next) => {
        order.push("block");
        return next();
      }
    };

    const block = handler({
      name: "ordered",
      inputSchema: z.number(),
      outputSchema: z.number(),
      middleware: [blockMw],
      execute: (input) => {
        order.push("execute");
        return input;
      }
    });

    const { ctx } = await createTestContext("req_mw_order");
    await executeBlock({
      block,
      input: 1,
      ctx,
      middleware: [globalMw]
    });

    // Global (caller) middleware runs before block middleware
    expect(order).toEqual(["global", "block", "execute"]);
  });
});

describe("middleware integration with runAction", () => {
  it("passes global middleware through runAction to block execution", async () => {
    const order: string[] = [];

    const globalMw: Middleware = {
      name: "global-action",
      execute: async (ctx, next) => {
        order.push("global");
        return next();
      }
    };

    const block = handler({
      name: "action-block",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      execute: (input) => {
        order.push("execute");
        return input.message;
      }
    });

    const flow = defineFlow({
      kind: "mw-action-test",
      actions: {
        chat: {
          inputSchema: z.object({ message: z.string() }),
          block
        }
      }
    })();

    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "chat",
      input: { message: "hello" },
      userId: "user_1",
      stores,
      middleware: [globalMw]
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("hello");
    expect(order).toEqual(["global", "execute"]);
  });

  it("composes global + flow middleware in correct order", async () => {
    const order: string[] = [];

    const globalMw: Middleware = {
      name: "global",
      execute: async (ctx, next) => {
        order.push("global");
        return next();
      }
    };

    const flowMw: Middleware = {
      name: "flow",
      execute: async (ctx, next) => {
        order.push("flow");
        return next();
      }
    };

    const blockMw: Middleware = {
      name: "block",
      execute: async (ctx, next) => {
        order.push("block");
        return next();
      }
    };

    const block = handler({
      name: "layered",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      middleware: [blockMw],
      execute: (input) => {
        order.push("execute");
        return input.message;
      }
    });

    const flow = defineFlow({
      kind: "mw-layered-test",
      middleware: [flowMw],
      actions: {
        chat: {
          inputSchema: z.object({ message: z.string() }),
          block
        }
      }
    })();

    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "chat",
      input: { message: "hello" },
      userId: "user_1",
      stores,
      middleware: [globalMw]
    });

    expect(result.error).toBeUndefined();
    expect(order).toEqual(["global", "flow", "block", "execute"]);
  });

  it("middleware can access block context metadata", async () => {
    let capturedContext: Record<string, unknown> = {};

    const inspectorMw: Middleware = {
      name: "inspector",
      execute: async (ctx, next) => {
        capturedContext = {
          blockName: ctx.block.name,
          blockKind: ctx.block.kind,
          hasInput: ctx.input !== undefined
        };
        return next();
      }
    };

    const block = handler({
      name: "inspectable",
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.number(),
      execute: (input) => input.value
    });

    const flow = defineFlow({
      kind: "mw-inspect-test",
      actions: {
        process: {
          inputSchema: z.object({ value: z.number() }),
          block
        }
      }
    })();

    const stores = createInMemoryStores();
    await runAction({
      flow,
      actionName: "process",
      input: { value: 42 },
      userId: "user_1",
      stores,
      middleware: [inspectorMw]
    });

    expect(capturedContext.blockName).toBe("inspectable");
    expect(capturedContext.blockKind).toBe("handler");
    expect(capturedContext.hasInput).toBe(true);
  });

  it("middleware errors propagate as execution failures", async () => {
    const failingMw: Middleware = {
      name: "failing",
      execute: async () => {
        throw new Error("middleware boom");
      }
    };

    const block = handler({
      name: "unreachable",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      execute: (input) => input.message
    });

    const flow = defineFlow({
      kind: "mw-fail-test",
      actions: {
        chat: {
          inputSchema: z.object({ message: z.string() }),
          block
        }
      }
    })();

    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "chat",
      input: { message: "hello" },
      userId: "user_1",
      stores,
      middleware: [failingMw]
    });

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("middleware boom");
  });
});
