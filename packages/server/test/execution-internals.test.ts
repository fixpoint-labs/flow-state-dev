import {
  defineFlow,
  generator,
  handler,
  sequencer
} from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, createInMemoryStores, createResponseEmitter, executeBlock } from "../src";
import { NetworkError } from "../src/errors/flow-error";
import { getResponseItems } from "../src/execution/internal/response";
import {
  applyBlockInputSeam,
  applyBlockOutputSeam,
  applyNormalizedErrorSeam,
  emitActionLifecycleSeam,
  emitGeneratorLifecycleSeam,
  NOOP_INTERNAL_EXECUTION_SEAMS
} from "../src/execution/internal/seams";
import { createExecutionMetadata } from "../src/execution/types";
import { FlowError } from "../src/errors/flow-error";

async function createCtx(requestId: string) {
  const block = handler<number, number>({
    name: "ctx-handler",
    execute: (value) => value
  });

  const flow = defineFlow({
    kind: "ctx-flow",
    actions: {
      run: {
        inputSchema: z.number(),
        block
      }
    }
  })();

  const stores = createInMemoryStores();
  const response = createResponseEmitter({
    requestId,
    now: () => 1
  });

  const ctx = await createExecutionContext({
    flow,
    actionName: "run",
    requestId,
    sessionId: "sess_ctx",
    userId: "user_ctx",
    modelResolver: (modelId) => ({
      modelId,
      async generate() {
        if (modelId === "model-fail") {
          throw new Error("gfail");
        }

        return {
          text: "ok"
        };
      }
    }),
    stores,
    response
  });

  return ctx;
}

describe("execution internals", () => {
  it("provides response item extraction fallback behavior", () => {
    expect(getResponseItems(null)).toEqual([]);
    expect(getResponseItems({})).toEqual([]);
    expect(
      getResponseItems({
        getItems: () => undefined
      })
    ).toEqual([]);
    expect(
      getResponseItems({
        getItems: () => [{ id: "x" }]
      })
    ).toEqual([{ id: "x" }]);
  });

  it("applies internal seam helpers and lifecycle seam hooks", async () => {
    const metadata = {
      requestId: "req_1",
      actionName: "run",
      flowKind: "flow",
      userId: "user_1"
    };

    expect(
      applyBlockInputSeam(
        {
          interceptBlockInput: (input: number) => input + 1
        },
        1,
        metadata
      )
    ).toBe(2);

    expect(
      applyBlockOutputSeam(
        {
          interceptBlockOutput: (output: number) => output + 2
        },
        1,
        metadata
      )
    ).toBe(3);

    const baseError = new FlowError("x", {
      code: "base",
      retryable: false
    });
    const intercepted = applyNormalizedErrorSeam(
      {
        interceptNormalizedError: () =>
          new FlowError("intercepted", {
            code: "overridden",
            retryable: false
          })
      },
      baseError,
      metadata
    );

    expect(intercepted.code).toBe("overridden");
    expect(applyNormalizedErrorSeam(NOOP_INTERNAL_EXECUTION_SEAMS, baseError, metadata)).toBe(baseError);

    const stages: string[] = [];
    await emitGeneratorLifecycleSeam(
      {
        onGeneratorLifecycle: (stage) => {
          stages.push(stage);
        }
      },
      "before_execute",
      metadata
    );
    await emitActionLifecycleSeam(
      {
        onActionLifecycle: (stage) => {
          stages.push(stage);
        }
      },
      "completed",
      metadata
    );

    expect(stages).toEqual(["before_execute", "completed"]);
  });

  it("builds execution metadata with explicit override and fallback paths", async () => {
    const ctx = await createCtx("req_meta");
    const metadata = createExecutionMetadata(ctx, {
      blockName: "x"
    });

    expect(metadata.requestId).toBe("req_meta");
    expect(metadata.userId).toBe("user_ctx");
    expect(metadata.blockName).toBe("x");

    const unknownUserMetadata = createExecutionMetadata(
      {
        ...ctx,
        user: {
          ...ctx.user,
          identity: {
            ...ctx.user.identity,
            userId: undefined
          }
        },
        request: {
          ...ctx.request,
          identity: {
            ...ctx.request.identity,
            userId: undefined
          }
        }
      } as any,
      {}
    );

    expect(unknownUserMetadata.userId).toBe("unknown_user");
  });

  it("dispatches all block kinds through executeBlock and emits generator lifecycle seams", async () => {
    const ctx = await createCtx("req_execute");

    const h = handler<number, number>({
      name: "h",
      execute: (value) => value + 1
    });
    const s = sequencer<number>({ name: "s" }).map((value) => value + 2);
    const g = generator<string, string>({
      name: "g",
      model: "model",
      prompt: "prompt"
    });

    expect(s.config.execute).toBeUndefined();
    expect(g.config.execute).toBeUndefined();

    const hResult = await executeBlock({ block: h, input: 1, ctx });
    expect(hResult.output).toBe(2);

    const sResult = await executeBlock({ block: s, input: 1, ctx });
    expect(sResult.output).toBe(3);

    const lifecycle: string[] = [];
    const gResult = await executeBlock({
      block: g,
      input: "in",
      ctx,
      internalSeams: {
        onGeneratorLifecycle: (stage) => {
          lifecycle.push(stage);
        }
      }
    });
    expect(gResult.output).toBe("ok");
    expect(lifecycle).toEqual(["before_execute", "after_execute"]);

    const gFail = generator<string, string>({
      name: "g-fail",
      model: "model-fail",
      prompt: "prompt"
    });
    const gFailResult = await executeBlock({
      block: gFail,
      input: "in",
      ctx,
      internalSeams: {
        onGeneratorLifecycle: (stage) => {
          lifecycle.push(stage);
        }
      }
    });
    expect(gFailResult.error).toBeDefined();
    expect(lifecycle).toContain("errored");
  });

  it("handles executeBlock unknown kind and uses block-level retry policies", async () => {
    const ctx = await createCtx("req_block");

    const unknown = {
      kind: "not_real",
      name: "unknown-kind",
      config: {
        execute: async () => 1
      },
      run: async () => 1
    } as unknown as BlockDefinition<number, number>;

    const unknownResult = await executeBlock({
      block: unknown,
      input: 1,
      ctx
    });
    expect(unknownResult.error?.code).toBe("execution_error");
    expect(unknownResult.output).toBeUndefined();

    let attempts = 0;
    const retrying = handler<number, number>({
      name: "retrying",
      retry: {
        maxAttempts: 2,
        baseDelayMs: 0,
        retryableErrors: [NetworkError]
      },
      execute: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new NetworkError("retry");
        }

        return 10;
      }
    });

    const result = await executeBlock({
      block: retrying,
      input: 0,
      ctx
    });

    expect(result.output).toBe(10);
    expect(result.error).toBeUndefined();
    expect(attempts).toBe(2);
  });
});
