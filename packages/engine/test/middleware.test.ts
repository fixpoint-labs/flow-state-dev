/**
 * Middleware is an ENGINE-INTERNAL composition seam (FIX-831). It is fed only
 * through `runtimeConfig.middleware` → `executeBlock({ middleware })`; there is
 * no author-facing registration on `defineFlow`, block builders, or
 * `createFlowApiRouter`. These tests assert the internal seam plus behavioral
 * retraction guards proving the removed surfaces no longer wire middleware.
 *
 * Note: type-level guards (`@ts-expect-error`) are not CI-enforced in this
 * package (the typecheck script walks `src/**` only, and vitest does not
 * typecheck), so retraction is verified behaviorally by the guards below —
 * middleware smuggled onto a block builder or `defineFlow` via `as any` is not
 * executed, and `createRuntimeConfig` drops a flat `middleware` option so a
 * stale `createFlowApiRouter({ middleware })` cannot feed the seam.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { composeMiddleware } from "../src/middleware/compose";
import { createRuntimeConfig } from "../src/runtime-config";
import type { Middleware } from "../src/middleware/types";
import {
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock,
  runAction
} from "../src";

async function createTestContext(requestId: string) {
  const defaultBlock = handler({
    name: "echo",
    inputSchema: z.string(),
    outputSchema: z.string(),
    execute: (input) => input
  });

  const defaultFlow = defineFlow({
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

describe("composeMiddleware", () => {
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

  it("throws when middleware calls next() multiple times", async () => {
    const greedy: Middleware = {
      name: "greedy",
      execute: async (ctx, next) => {
        await next();
        return next();
      }
    };

    const run = composeMiddleware([greedy], { name: "test", kind: "handler" });
    await expect(
      run(
        { block: { name: "test", kind: "handler" }, input: "x" },
        async () => "value"
      )
    ).rejects.toThrow('Middleware "greedy" called next() multiple times');
  });

  it("propagates errors thrown after next() returns", async () => {
    const afterError: Middleware = {
      name: "after-error",
      execute: async (ctx, next) => {
        await next();
        throw new Error("post-processing failed");
      }
    };

    const run = composeMiddleware([afterError], { name: "test", kind: "handler" });
    await expect(
      run(
        { block: { name: "test", kind: "handler" }, input: "x" },
        async () => "value"
      )
    ).rejects.toThrow("post-processing failed");
  });
});

describe("executeBlock internal middleware seam", () => {
  it("runs caller-provided middleware around block execution", async () => {
    const order: string[] = [];

    const mw: Middleware = {
      name: "seam-mw",
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
      execute: (input) => {
        order.push("execute");
        return input * 2;
      }
    });

    const { ctx } = await createTestContext("req_mw_block");
    const result = await executeBlock({
      block,
      input: 5,
      ctx,
      middleware: [mw]
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(10);
    expect(order).toEqual(["before", "execute", "after"]);
  });

  it("composes multiple caller-provided middleware in order", async () => {
    const order: string[] = [];

    const outer: Middleware = {
      name: "outer",
      execute: async (ctx, next) => {
        order.push("outer");
        return next();
      }
    };

    const innerMw: Middleware = {
      name: "inner",
      execute: async (ctx, next) => {
        order.push("inner");
        return next();
      }
    };

    const block = handler({
      name: "ordered",
      inputSchema: z.number(),
      outputSchema: z.number(),
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
      middleware: [outer, innerMw]
    });

    expect(order).toEqual(["outer", "inner", "execute"]);
  });

  it("runs caller middleware on each retry attempt", async () => {
    let mwCalls = 0;
    let executeCalls = 0;

    const countingMw: Middleware = {
      name: "counting",
      execute: async (ctx, next) => {
        mwCalls++;
        return next();
      }
    };

    const block = handler({
      name: "flaky",
      inputSchema: z.number(),
      outputSchema: z.number(),
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
      execute: (input) => {
        executeCalls++;
        if (executeCalls < 3) {
          throw new Error("transient failure");
        }
        return input;
      }
    });

    const { ctx } = await createTestContext("req_mw_retry");
    const result = await executeBlock({
      block,
      input: 42,
      ctx,
      middleware: [countingMw]
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(42);
    // Middleware runs on every attempt, not just the first
    expect(mwCalls).toBe(3);
    expect(executeCalls).toBe(3);
  });
});

describe("runAction internal middleware seam", () => {
  it("passes runtimeConfig.middleware through runAction to block execution", async () => {
    const order: string[] = [];

    const globalMw: Middleware = {
      name: "runtime-config",
      execute: async (ctx, next) => {
        order.push("middleware");
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
      runtimeConfig: {
        middleware: [globalMw]
      }
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("hello");
    expect(order).toEqual(["middleware", "execute"]);
  });

  it("exposes block identity on the middleware context", async () => {
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
      runtimeConfig: {
        middleware: [inspectorMw]
      }
    });

    expect(capturedContext.blockName).toBe("inspectable");
    expect(capturedContext.blockKind).toBe("handler");
    expect(capturedContext.hasInput).toBe(true);
  });

  it("propagates middleware errors as execution failures", async () => {
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
      runtimeConfig: {
        middleware: [failingMw]
      }
    });

    expect(result.error).toBeDefined();
    expect(result.error!.message).toBe("middleware boom");
  });
});

describe("public middleware surface is retracted (FIX-831)", () => {
  it("ignores middleware smuggled onto a block builder config", async () => {
    let blockMwRan = false;

    const blockMw: Middleware = {
      name: "block-mw",
      execute: async (ctx, next) => {
        blockMwRan = true;
        return next();
      }
    };

    // `middleware` is no longer part of BlockConfig; force it on via `as any`
    // to prove executeBlock does not read `block.config.middleware`.
    const block = handler({
      name: "no-block-mw",
      inputSchema: z.number(),
      outputSchema: z.number(),
      middleware: [blockMw],
      execute: (input) => input
    } as any);

    const { ctx } = await createTestContext("req_retract_block");
    const result = await executeBlock({ block, input: 7, ctx });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(7);
    expect(blockMwRan).toBe(false);
  });

  it("ignores middleware smuggled onto defineFlow", async () => {
    let flowMwRan = false;

    const flowMw: Middleware = {
      name: "flow-mw",
      execute: async (ctx, next) => {
        flowMwRan = true;
        return next();
      }
    };

    const block = handler({
      name: "flow-retract-block",
      inputSchema: z.object({ message: z.string() }),
      outputSchema: z.string(),
      execute: (input) => input.message
    });

    // `middleware` is no longer part of the flow definition; force it on via
    // `as any` to prove runAction does not wire `flow.middleware`.
    const flow = defineFlow({
      kind: "mw-flow-retract-test",
      middleware: [flowMw],
      actions: {
        chat: {
          inputSchema: z.object({ message: z.string() }),
          block
        }
      }
    } as any)();

    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "chat",
      input: { message: "hello" },
      userId: "user_1",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("hello");
    expect(flowMwRan).toBe(false);
  });

  it("drops a flat middleware option smuggled through createRuntimeConfig", () => {
    const mw: Middleware = {
      name: "router-mw",
      execute: async (_ctx, next) => next()
    };

    // `createFlowApiRouter` builds its runtime config via
    // `createRuntimeConfig(options)`. A JS / `as any` caller that keeps the
    // retracted `createFlowApiRouter({ middleware })` option must NOT have it
    // reach the internal seam — the flat option is dropped, so the only way in
    // stays a framework-built `RuntimeConfig` passed as `runtimeConfig`.
    const runtimeConfig = createRuntimeConfig({ middleware: [mw] } as any);

    expect(runtimeConfig.middleware).toBeUndefined();
  });
});
