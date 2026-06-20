import {
  defineFlow,
  generator,
  handler,
  router,
  sequencer,
  transientSlot
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import {
  FlowError,
  NetworkError,
  ValidationError,
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  executeBlock,
  isRetryableError,
  mergeRetryPolicy,
  normalizeError,
  retryWithPolicy,
  runAction
} from "../src";
import {
  NOOP_INTERNAL_EXECUTION_SEAMS
} from "../src/execution/internal/seams";

async function createRuntimeContext(requestId: string) {
  const block = handler({
    name: "base-handler",
    inputSchema: z.number(),
    outputSchema: z.number(),
    execute: (value) => value
  });

  const flow = defineFlow({
    kind: "runtime-flow",
    actions: {
      run: {
        inputSchema: z.object({ valid: z.boolean(), count: z.number() }),
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
    sessionId: "sess_runtime",
    userId: "user_runtime",
    modelResolver: (modelId) => ({
      modelId,
      async generate() {
        return {
          text: modelId === "mock-model" ? "generated" : "ok"
        };
      }
    }),
    stores,
    response
  });

  return { ctx, stores };
}

describe("execution runtime", () => {
  it("normalizes unknown throws into FlowError", () => {
    const error = normalizeError("unexpected failure", {
      blockName: "demo",
      scope: "block"
    });

    expect(error).toBeInstanceOf(FlowError);
    expect(error.message).toBe("unexpected failure");
    expect(error.code).toBe("execution_error");
    expect(error.blockName).toBe("demo");
    expect(error.scope).toBe("block");
  });

  it("emits structured execution logs for action, block, retries, and failures", async () => {
    const logs: Array<{ level: string; message: string; context: Record<string, unknown> }> = [];
    const logger = {
      info: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: "info", message, context });
      },
      warn: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: "warn", message, context });
      },
      error: (message: string, context: Record<string, unknown>) => {
        logs.push({ level: "error", message, context });
      }
    };

    let attempts = 0;
    const flow = defineFlow({
      kind: "log-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: handler({
            name: "log-handler",
            inputSchema: z.object({ text: z.string() }),
            outputSchema: z.string(),
            retry: {
              maxAttempts: 3,
              baseDelayMs: 0,
              maxDelayMs: 0
            },
            execute: ({ text }) => {
              attempts += 1;
              if (attempts < 3) {
                throw new NetworkError(`retry-${attempts}`);
              }

              return `${text}-done`;
            }
          })
        }
      }
    })();

    const success = await runAction({
      flow,
      actionName: "run",
      input: { text: "x" },
      userId: "user_logs",
      sessionId: "sess_logs",
      stores: createInMemoryStores(),
      runtimeConfig: {
        logger
      }
    });

    expect(success.error).toBeUndefined();
    expect(
      logs.some((entry) =>
        entry.message.includes("action execution started") && entry.context.requestId !== undefined
      )
    ).toBe(true);
    expect(
      logs.some((entry) => entry.message.includes("block execution retry scheduled"))
    ).toBe(true);
    expect(
      logs.some((entry) =>
        entry.message.includes("action execution completed") &&
        typeof entry.context.output === "string"
      )
    ).toBe(true);

    logs.length = 0;

    const failingFlow = defineFlow({
      kind: "log-failure-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: handler({
            name: "log-failing-handler",
            inputSchema: z.object({ text: z.string() }),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("boom");
            }
          })
        }
      }
    })();

    const failed = await runAction({
      flow: failingFlow,
      actionName: "run",
      input: { text: "x" },
      userId: "user_logs_fail",
      sessionId: "sess_logs_fail",
      stores: createInMemoryStores(),
      runtimeConfig: {
        logger
      }
    });

    expect(failed.error?.message).toBe("boom");
    expect(
      logs.some((entry) =>
        entry.level === "error" &&
        entry.message.includes("action execution failed") &&
        typeof entry.context.error === "string"
      )
    ).toBe(true);
  });

  it("merges retry policy and retries retryable errors only", async () => {
    const merged = mergeRetryPolicy(
      {
        maxAttempts: 2,
        baseDelayMs: 1
      },
      {
        maxAttempts: 4,
        baseDelayMs: 5,
        maxDelayMs: 20
      }
    );

    expect(merged).toEqual({
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 20,
      retryableErrors: undefined
    });

    const retryPolicy = mergeRetryPolicy(
      {
        maxAttempts: 3,
        baseDelayMs: 0,
        retryableErrors: [NetworkError]
      },
      undefined
    );

    let attempts = 0;
    const value = await retryWithPolicy(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new NetworkError("transient");
        }

        return "ok";
      },
      retryPolicy
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(3);

    expect(
      isRetryableError(new ValidationError("bad"), retryPolicy)
    ).toBe(false);

    let plainRuns = 0;
    const plain = await retryWithPolicy(
      async () => {
        plainRuns += 1;
        return "plain";
      },
      undefined
    );
    expect(plain).toBe("plain");
    expect(plainRuns).toBe(1);

    const abortedSignal = new AbortController();
    abortedSignal.abort();
    await expect(
      retryWithPolicy(
        async () => {
          throw new NetworkError("abort");
        },
        {
          maxAttempts: 2,
          baseDelayMs: 5,
          maxDelayMs: 10
        },
        { signal: abortedSignal.signal }
      )
    ).rejects.toThrow("Retry aborted");
  });

  it("covers retry edge paths", async () => {
    expect(mergeRetryPolicy(undefined, undefined)).toBeUndefined();
    expect(mergeRetryPolicy({}, undefined)).toEqual({
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 5000,
      retryableErrors: undefined
    });
    expect(
      mergeRetryPolicy(
        {
          maxAttempts: -2,
          baseDelayMs: -5,
          maxDelayMs: -1
        },
        undefined
      )
    ).toEqual({
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      retryableErrors: undefined
    });
    expect(isRetryableError(new Error("x"), undefined)).toBe(false);

    const onRetryAttempts: number[] = [];
    let attempts = 0;
    const eventual = await retryWithPolicy(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first");
        }
        return "done";
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 2
      },
      {
        onRetry: (attempt) => {
          onRetryAttempts.push(attempt);
        }
      }
    );
    expect(eventual).toBe("done");
    expect(onRetryAttempts).toEqual([1]);

    await expect(
      retryWithPolicy(
        async () => {
          throw "plain-failure";
        },
        {
          maxAttempts: 2,
          baseDelayMs: 0,
          maxDelayMs: 0
        }
      )
    ).rejects.toThrow("Unknown retry failure");

    await expect(
      retryWithPolicy(
        async () => "never",
        {
          maxAttempts: 0,
          baseDelayMs: 0,
          maxDelayMs: 0
        }
      )
    ).rejects.toThrow("Retry loop exited unexpectedly");

    const inFlightAbort = new AbortController();
    const inFlightPromise = retryWithPolicy(
      async () => {
        throw new NetworkError("retry me");
      },
      {
        maxAttempts: 2,
        baseDelayMs: 25,
        maxDelayMs: 25,
        retryableErrors: [NetworkError]
      },
      {
        signal: inFlightAbort.signal
      }
    );
    setTimeout(() => inFlightAbort.abort(), 5);
    await expect(inFlightPromise).rejects.toThrow("Retry aborted");
  });

  it("dispatches handler/generator/sequencer/router blocks", async () => {
    const { ctx } = await createRuntimeContext("req_dispatch");

    const handlerBlock = handler({
      name: "plus-one",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });
    const generatorBlock = generator({
      name: "gen",
      inputSchema: z.string(),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "say hi"
    });
    const sequencerBlock = sequencer({
      name: "seq",
      inputSchema: z.number()
    }).map((value) => value + 2);

    const routeA = handler({
      name: "route-a",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: () => "a"
    });
    const routeB = handler({
      name: "route-b",
      inputSchema: z.number(),
      outputSchema: z.string(),
      execute: () => "b"
    });
    const routerBlock = router({
      name: "router",
      inputSchema: z.number(),
      outputSchema: z.string(),
      routes: [routeA, routeB],
      execute: () => routeB
    });

    const handlerResult = await executeBlock({
      block: handlerBlock,
      input: 2,
      ctx
    });
    const generatorResult = await executeBlock({
      block: generatorBlock,
      input: "input",
      ctx
    });
    const sequencerResult = await executeBlock({
      block: sequencerBlock,
      input: 3,
      ctx
    });
    const routerResult = await executeBlock({
      block: routerBlock,
      input: 1,
      ctx
    });

    expect(handlerResult.output).toBe(3);
    expect(generatorResult.output).toBe("generated");
    expect(sequencerResult.output).toBe(5);
    expect(routerResult.output).toBe("b");
  });

  it("tracks parent chain and resolves getTarget across sequencer, tools, and router execution", async () => {
    const stores = createInMemoryStores();
    const base = handler({
      name: "base",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value
    });

    const flow = defineFlow({
      kind: "target-flow",
      actions: {
        run: {
          inputSchema: z.number(),
          block: base
        }
      }
    })();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_targets",
      sessionId: "sess_targets",
      userId: "user_targets",
      stores,
      modelResolver: (modelId) => ({
        modelId,
        async generate(options: any) {
          if (Array.isArray(options.tools) && options.tools.length > 0 && typeof options.tools[0]?.execute === "function") {
            await options.tools[0].execute({ text: "hello" });
          }
          return { text: "chat-output" };
        }
      })
    });

    const snapshots: Array<{ step: string; target?: string }> = [];

    const innerTool = handler({
      name: "inner-tool",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      execute: (_input, toolCtx) => {
        const sequencerTarget = toolCtx.getTarget("research");
        const chatTarget = toolCtx.getTarget("chat");

        snapshots.push({
          step: "tool",
          target: `${sequencerTarget?.name}:${chatTarget?.name}`
        });

        return "tool-ok";
      }
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "Use tools",
      tools: [innerTool]
    });

    const routeA = handler({
      name: "route-a",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (input, routeCtx) => {
        const seqTarget = routeCtx.getTarget("research");
        snapshots.push({ step: "router-route", target: seqTarget?.name });
        return `${input}-a`;
      }
    });

    const gate = router({
      name: "gate",
      inputSchema: z.string(),
      outputSchema: z.string(),
      routes: [routeA],
      execute: () => routeA
    });

    const validate = handler({
      name: "validate",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.object({ text: z.string() }),
      execute: (input, stepCtx) => {
        const researchTarget = stepCtx.getTarget("research");
        snapshots.push({ step: "sequencer-step", target: researchTarget?.name });
        return input;
      }
    });

    const research = sequencer({
      name: "research",
      inputSchema: z.object({ text: z.string() })
    })
      .step(validate)
      .step(chat)
      .step(gate);

    const result = await executeBlock({
      block: research,
      input: { text: "hello" },
      ctx
    });

    expect(result.output).toBe("chat-output-a");
    expect(snapshots).toEqual([
      { step: "sequencer-step", target: "research" },
      { step: "tool", target: "research:chat" },
      { step: "router-route", target: "research" }
    ]);
  });



  it("resolves declared ctx.targets entries and returns undefined when missing", async () => {
    const { ctx } = await createRuntimeContext("req_declared_targets");

    const inspect = handler({
      name: "inspect-targets",
      inputSchema: z.number(),
      outputSchema: z.object({
        outer: z.string(),
        missing: z.boolean(),
        legacy: z.string()
      }),
      targetStateSchemas: {
        outer: z.object({}),
        missing: z.object({})
      },
      execute: async (_value, stepCtx) => {
        const outer = stepCtx.targets.outer;
        const missing = stepCtx.targets.missing;
        const legacy = stepCtx.getTarget("outer");

        await outer?.patchState({ count: 2 });

        return {
          outer: String(outer?.name),
          missing: missing === undefined,
          legacy: String(legacy?.name)
        };
      }
    });

    const outer = sequencer({
      name: "outer",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(0) })
    }).step(inspect);

    const result = await executeBlock({
      block: outer,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      outer: "outer",
      missing: true,
      legacy: "outer"
    });
  });

  it("exposes completed sibling outputs via getBlockOutput/getBlockResult", async () => {
    const { ctx } = await createRuntimeContext("req_block_output_completed");

    const validate = handler({
      name: "validate",
      inputSchema: z.number(),
      outputSchema: z.object({ valid: z.boolean(), count: z.number() }),
      execute: (value) => ({ valid: value > 0, count: value })
    });

    const inspect = handler({
      name: "inspect-output",
      inputSchema: z.object({ valid: z.boolean(), count: z.number() }),
      outputSchema: z.object({
        outputValid: z.boolean(),
        status: z.string()
      }),
      execute: (_value, stepCtx) => {
        const output = stepCtx.getBlockOutput(validate);
        const result = stepCtx.getBlockResult(validate);

        return {
          outputValid: output?.valid ?? false,
          status: result.status
        };
      }
    });

    const flow = sequencer({ name: "flow", inputSchema: z.number() })
      .step(validate)
      .step(inspect);

    const result = await executeBlock({
      block: flow,
      input: 3,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ outputValid: true, status: "completed" });
  });

  it("returns running status and undefined output for in-progress sibling work", async () => {
    const { ctx } = await createRuntimeContext("req_block_output_running");

    let releaseWorker: (() => void) | undefined;
    const workerReady = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });

    const worker = handler({
      name: "async-worker",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (value) => {
        await workerReady;
        return value + 1;
      }
    });

    const inspect = handler({
      name: "inspect-running",
      inputSchema: z.number(),
      outputSchema: z.object({ outputMissing: z.boolean(), status: z.string() }),
      execute: (value, stepCtx) => {
        const output = stepCtx.getBlockOutput(worker);
        const result = stepCtx.getBlockResult(worker);
        releaseWorker?.();
        return { outputMissing: output === undefined && value > 0, status: result.status };
      }
    });

    const flow = sequencer({ name: "flow-running", inputSchema: z.number() })
      .work(worker)
      .step(inspect)
      .waitForWork();

    const result = await executeBlock({
      block: flow,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ outputMissing: true, status: "running" });
  });

  it("does not resolve ancestor block outputs/results", async () => {
    const { ctx } = await createRuntimeContext("req_block_output_ancestor_unavailable");

    const validate = handler({
      name: "validate",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });

    const inspect = handler({
      name: "inspect-ancestor-output",
      inputSchema: z.number(),
      outputSchema: z.object({ outputMissing: z.boolean(), status: z.string() }),
      execute: (value, stepCtx) => {
        const output = stepCtx.getBlockOutput(validate);
        const result = stepCtx.getBlockResult(validate);

        return {
          outputMissing: output === undefined && value > 0,
          status: result.status
        };
      }
    });

    const inner = sequencer({ name: "inner", inputSchema: z.number() }).step(inspect);
    const flow = sequencer({ name: "outer", inputSchema: z.number() })
      .step(validate)
      .step(inner);

    const result = await executeBlock({
      block: flow,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ outputMissing: true, status: "not_started" });
  });

  it("returns failed status for failed sibling results", async () => {
    const { ctx } = await createRuntimeContext("req_block_output_failed");

    const worker = handler({
      name: "failing-worker",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("boom");
      }
    });

    const inspect = handler({
      name: "inspect-failed",
      inputSchema: z.number(),
      outputSchema: z.object({ outputMissing: z.boolean(), status: z.string(), hasError: z.boolean() }),
      execute: (_value, stepCtx) => {
        const output = stepCtx.getBlockOutput(worker);
        const result = stepCtx.getBlockResult(worker);
        return {
          outputMissing: output === undefined,
          status: result.status,
          hasError: result.status === "failed"
        };
      }
    });

    const flow = sequencer({ name: "flow-failed", inputSchema: z.number() })
      .work(worker)
      .waitForWork({ failOnError: false })
      .step(inspect);

    const result = await executeBlock({
      block: flow,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ outputMissing: true, status: "failed", hasError: true });
  });

  it("reports wasRescued=true for a rescued sibling and false otherwise", async () => {
    const { ctx } = await createRuntimeContext("req_was_rescued");

    const thrower = handler({
      name: "ws-thrower",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("boom");
      }
    });
    const recovery = handler({
      name: "ws-recovery",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => -1
    });
    // A rescued sub-sequencer: its inner throw is recovered, so it completes
    // and becomes a (rescued) sibling in the outer scope.
    const dispatch = sequencer({ name: "ws-dispatch", inputSchema: z.number() })
      .step(thrower)
      .rescue([{ block: recovery }]);

    const okStep = handler({
      name: "ws-ok",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value
    });
    // A sibling sequencer that completes without ever rescuing.
    const safe = sequencer({ name: "ws-safe", inputSchema: z.number() }).step(okStep);

    const probe = handler({
      name: "ws-probe",
      inputSchema: z.number(),
      outputSchema: z.object({
        rescuedByDef: z.boolean(),
        rescuedByName: z.boolean(),
        safeRescued: z.boolean(),
        unknownRescued: z.boolean()
      }),
      execute: (_value, stepCtx) => ({
        rescuedByDef: stepCtx.wasRescued(dispatch),
        rescuedByName: stepCtx.wasRescued("ws-dispatch"),
        safeRescued: stepCtx.wasRescued(safe),
        unknownRescued: stepCtx.wasRescued("does-not-exist")
      })
    });

    const flow = sequencer({ name: "ws-outer", inputSchema: z.number() })
      .step(dispatch)
      .step(safe)
      .step(probe);

    const result = await executeBlock({ block: flow, input: 5, ctx });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      rescuedByDef: true,
      rescuedByName: true,
      safeRescued: false,
      unknownRescued: false
    });
  });

  it("tracks wasRescued per-iteration under loopBack", async () => {
    const { ctx } = await createRuntimeContext("req_was_rescued_loop");

    // Throws on its first run only, then succeeds — so the rescue fires in
    // iteration 0 but not iteration 1.
    let attempts = 0;
    const flaky = handler({
      name: "loop-flaky",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first-attempt failure");
        }
        return attempts;
      }
    });
    const recovery = handler({
      name: "loop-recovery",
      inputSchema: z.any(),
      outputSchema: z.number(),
      execute: () => -1
    });
    const dispatch = sequencer({ name: "loop-dispatch", inputSchema: z.any() })
      .step(flaky)
      .rescue([{ block: recovery }]);

    // Drives exactly two iterations via a closure counter.
    let loops = 0;
    const controller = handler({
      name: "loop-controller",
      inputSchema: z.any(),
      outputSchema: z.object({ continue: z.boolean() }),
      execute: () => {
        loops += 1;
        return { continue: loops < 2 };
      }
    });
    // Records this iteration's rescued status as observed by a downstream
    // sibling of `dispatch`.
    const observed: boolean[] = [];
    const probe = handler({
      name: "loop-probe",
      inputSchema: z.object({ continue: z.boolean() }),
      outputSchema: z.object({ continue: z.boolean() }),
      execute: (input, stepCtx) => {
        observed.push(stepCtx.wasRescued(dispatch));
        return input;
      }
    });

    const flow = sequencer({ name: "loop-outer", inputSchema: z.any() })
      .step(dispatch)
      .step(controller)
      .step(probe)
      .loopBack(dispatch.name, {
        when: (v) => (v as { continue: boolean }).continue,
        maxIterations: 5
      });

    const result = await executeBlock({ block: flow, input: {}, ctx });

    expect(result.error).toBeUndefined();
    // Iteration 0 rescued; iteration 1 ran clean.
    expect(observed).toEqual([true, false]);
  });

  it("resolves getTarget from sibling registry before ancestors", async () => {
    const { ctx } = await createRuntimeContext("req_targets_siblings");

    let releaseWorker: (() => void) | undefined;
    const workerReady = new Promise<void>((resolve) => {
      releaseWorker = resolve;
    });

    const duplicateA = handler({
      name: "dup",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });

    const duplicateB = handler({
      name: "dup",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 2
    });

    const worker = handler({
      name: "worker",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (value) => {
        await workerReady;
        return value + 10;
      }
    });

    const snapshots: Array<{ key: string; value: string | undefined }> = [];

    const inspect = handler({
      name: "inspect",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        const dupTarget = stepCtx.getTarget("dup");
        const workerTarget = stepCtx.getTarget("worker");
        const ancestorFallback = stepCtx.getTarget("outer");

        snapshots.push({ key: "dup", value: dupTarget?.instanceId });
        snapshots.push({ key: "worker", value: workerTarget?.name });
        snapshots.push({ key: "fallback", value: ancestorFallback?.name });

        releaseWorker?.();
        return value;
      }
    });

    const inner = sequencer({ name: "inner", inputSchema: z.number() })
      .step(duplicateA)
      .step(duplicateB)
      .work(worker)
      .step(inspect)
      .waitForWork();

    const outer = sequencer({ name: "outer", inputSchema: z.number() }).step(inner);

    const result = await executeBlock({
      block: outer,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(4);
    expect(snapshots.find((entry) => entry.key === "worker")?.value).toBe("worker");
    expect(snapshots.find((entry) => entry.key === "fallback")?.value).toBe("outer");

    const dupInstanceId = snapshots.find((entry) => entry.key === "dup")?.value;
    // Deterministic instance IDs use the shape
    // `${requestId}:${path}:${attempt}`; the path points at the sibling
    // `dup` target's location in the execution tree.
    expect(dupInstanceId).toMatch(/^req_targets_siblings:root\/step\[/);
  });

  it("prefers sibling target over same-name ancestor target", async () => {
    const { ctx } = await createRuntimeContext("req_targets_sibling_shadow");

    const sibling = handler({
      name: "dup",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });

    const inspect = handler({
      name: "inspect",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        const target = stepCtx.getTarget("dup");
        // Deterministic IDs: `${requestId}:${path}:${attempt}`. The sibling
        // `dup` lives inside the child sequencer, so the path should include
        // `child/step[...]`, not point at the ancestor `dup` sequencer.
        expect(target?.instanceId).toMatch(
          /^req_targets_sibling_shadow:root\/step\[0\]\/step\[/
        );
        return value;
      }
    });

    const child = sequencer({ name: "child", inputSchema: z.number() })
      .step(sibling)
      .step(inspect);

    const outer = sequencer({ name: "dup", inputSchema: z.number() }).step(child);

    const result = await executeBlock({
      block: outer,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(2);
  });

  it("throws AmbiguousBlockNameError when parent chain contains duplicate names", async () => {
    const { ctx } = await createRuntimeContext("req_targets_ambiguous");

    const duplicateLeaf = handler({
      name: "leaf",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, leafCtx) => {
        expect(() => leafCtx.getTarget("dup")).toThrow(/ambiguous/i);
        return value;
      }
    });

    const inner = sequencer({ name: "dup", inputSchema: z.number() }).step(duplicateLeaf);
    const outer = sequencer({ name: "dup", inputSchema: z.number() }).step(inner);

    const result = await executeBlock({
      block: outer,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe(1);
  });


  it("initializes sequencer instance state and exposes mutating target ops", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state");

    const inspect = handler({
      name: "inspect-state",
      inputSchema: z.number(),
      outputSchema: z.object({
        count: z.number(),
        total: z.number(),
        status: z.string(),
        notes: z.array(z.string()),
        flags: z.record(z.boolean())
      }),
      execute: async (_input, stepCtx) => {
        const target = stepCtx.sequencer;
        expect(target).toBeDefined();
        if (target === undefined) {
          throw new Error("missing sequencer target");
        }

        await target.patchState({ status: "running" });
        await target.setState({
          count: 2,
          total: 5,
          status: "set",
          notes: ["seed"],
          flags: { seen: true }
        });
        await target.incState({ count: 3, total: 7 });
        await target.pushState("notes", "next");
        await target.setStateRecord("flags", "active", true);
        await target.deleteStateRecord("flags", "seen");
        await target.atomicState((state) => ({
          status: `${String((state as Record<string, unknown>).status)}:done`
        }));

        return {
          count: Number((target.state as Record<string, unknown>).count),
          total: Number((target.state as Record<string, unknown>).total),
          status: String((target.state as Record<string, unknown>).status),
          notes: (target.state as Record<string, unknown>).notes as string[],
          flags: (target.state as Record<string, boolean>).flags as Record<string, boolean>
        };
      }
    });

    const seq = sequencer({
      name: "stateful",
      inputSchema: z.number(),
      stateSchema: z.object({
        count: z.number().default(1),
        total: z.number().default(0),
        status: z.string().default("idle"),
        notes: z.array(z.string()).default([]),
        flags: z.record(z.boolean()).default({})
      })
    }).step(inspect);

    const result = await executeBlock({
      block: seq,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({
      count: 5,
      total: 12,
      status: "set:done",
      notes: ["seed", "next"],
      flags: { active: true }
    });
  });

  it("emits state_change items for sequencer target state ops with block instance provenance", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state_change");

    const mutate = handler({
      name: "mutate-state",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        const target = stepCtx.sequencer;
        if (target === undefined) {
          throw new Error("missing sequencer target");
        }

        await target.patchState({ status: "running" });
        await target.patchState("count", (current) => Number(current ?? 0) + 1);
        await target.setState({
          count: 5,
          total: 3,
          status: "set",
          notes: ["seed"],
          flags: { active: true }
        });
        await target.incState({ count: 2 });
        await target.pushState("notes", "next");
        await target.setStateRecord("flags", "seen", true);
        await target.deleteStateRecord("flags", "active");
        await target.atomicState((state) => ({
          status: `${String((state as Record<string, unknown>).status)}:done`
        }));

        return input;
      }
    });

    const seq = sequencer({
      name: "stateful",
      inputSchema: z.number(),
      stateSchema: z.object({
        count: z.number().default(0),
        total: z.number().default(0),
        status: z.string().default("idle"),
        notes: z.array(z.string()).default([]),
        flags: z.record(z.boolean()).default({})
      })
    }).step(mutate);

    const result = await executeBlock({
      block: seq,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();

    const response = ctx.response as ReturnType<typeof createResponseEmitter>;
    const items = response
      .getItems()
      .filter((item) => item.type === "state_change");

    expect(items).toHaveLength(8);

    const scopedItems = items.map((item) => item as Extract<(typeof items)[number], { type: "state_change" }>);
    expect(scopedItems.every((item) => item.scope === "block_instance")).toBe(true);
    expect(scopedItems.every((item) => item.provenance.blockName === "stateful")).toBe(true);
    expect(scopedItems.every((item) => item.provenance.blockInstanceId === item.blockInstanceId)).toBe(true);
    expect(scopedItems.map((item) => item.operation)).toEqual([
      "patch",
      "patch",
      "set",
      "increment",
      "push",
      "patch",
      "delete_key",
      "atomic"
    ]);
    expect(scopedItems.map((item) => item.version)).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8
    ]);
    expect(scopedItems.every((item) => item.transient === false)).toBe(true);
  });

  it("emits state_change items for session-scope state ops with monotonic version (FIX-576)", async () => {
    type SessionState = {
      count: number;
      total: number;
      status: string;
      notes: string[];
      flags: Record<string, boolean>;
    };
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "scope-state-change",
      sessionStateSchema: z.object({
        count: z.number().default(0),
        total: z.number().default(0),
        status: z.string().default("idle"),
        notes: z.array(z.string()).default([]),
        flags: z.record(z.boolean()).default({})
      }),
      actions: {
        run: {
          inputSchema: z.number(),
          block: handler({
            name: "noop",
            inputSchema: z.number(),
            outputSchema: z.number(),
            execute: (input) => input
          })
        }
      }
    })();

    const response = createResponseEmitter({ requestId: "req_session_scope" });
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_session_scope",
      sessionId: "sess_session_scope",
      userId: "user_session_scope",
      stores,
      response,
      modelResolver: (modelId) => ({
        modelId,
        async generate() {
          return { text: "ok" };
        }
      })
    });

    const session = ctx.session as unknown as {
      patchState: (...args: unknown[]) => Promise<boolean>;
      setState: (next: SessionState) => Promise<boolean>;
      incState: (incs: Record<string, number>) => Promise<boolean>;
      pushState: (field: string, value: unknown) => Promise<boolean>;
      setStateRecord: (field: string, key: string, value: unknown) => Promise<boolean>;
      deleteStateRecord: (field: string, key: string) => Promise<boolean>;
      atomicState: (mutator: (state: SessionState) => Partial<SessionState>) => Promise<boolean>;
    };

    await session.patchState({ status: "running" });
    await session.setState({
      count: 5,
      total: 3,
      status: "set",
      notes: ["seed"],
      flags: { active: true }
    });
    await session.incState({ count: 2 });
    await session.pushState("notes", "next");
    await session.setStateRecord("flags", "seen", true);
    await session.deleteStateRecord("flags", "active");
    await session.atomicState((state) => ({
      status: `${String(state.status)}:done`
    }));

    const items = response
      .getItems()
      .filter((item) => item.type === "state_change");

    expect(items).toHaveLength(7);
    expect(items.every((item) => item.scope === "session")).toBe(true);
    expect(items.every((item) => item.blockInstanceId === undefined)).toBe(true);
    expect(items.map((item) => item.operation)).toEqual([
      "patch",
      "set",
      "increment",
      "push",
      "patch",
      "delete_key",
      "atomic"
    ]);
    expect(items.map((item) => item.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(items[0]?.delta).toEqual({ status: "running" });
    expect(items[2]?.delta).toEqual({ count: 2 });
    expect(items[3]?.delta).toBe("next");
    expect(items[3]?.path).toBe("notes");
    expect(items[4]?.delta).toEqual({ flags: { seen: true } });
    expect(items[5]?.delta).toEqual({ flags: "active" });
    expect(items[5]?.path).toBe("flags.active");
    expect(items[6]?.delta).toBeUndefined();
  });

  it("emits state_change items for user, org, and request scopes (FIX-576)", async () => {
    const stores = createInMemoryStores();
    await stores.org.set(
      "org_scope",
      {
        id: "org_scope",
        userId: "user_scope_emit",
        orgId: "org_scope",
        state: { tier: "free" },
        version: 0,
        createdAt: 0,
        updatedAt: 0
      },
      "any"
    );
    const flow = defineFlow({
      kind: "scope-state-change-multi",
      requestStateSchema: z.object({ phase: z.string().default("idle") }),
      sessionStateSchema: z.object({}).passthrough(),
      userStateSchema: z.object({ role: z.string().default("guest") }),
      orgStateSchema: z.object({ tier: z.string().default("free") }),
      actions: {
        run: {
          inputSchema: z.number(),
          block: handler({
            name: "noop",
            inputSchema: z.number(),
            outputSchema: z.number(),
            execute: (input) => input
          })
        }
      }
    })();

    const response = createResponseEmitter({ requestId: "req_multi_scope" });
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_multi_scope",
      sessionId: "sess_multi_scope",
      userId: "user_scope_emit",
      orgId: "org_scope",
      stores,
      response,
      modelResolver: (modelId) => ({
        modelId,
        async generate() {
          return { text: "ok" };
        }
      })
    });

    await ctx.user.patchState({ role: "admin" });
    await ctx.request.patchState({ phase: "running" });
    if (ctx.org !== undefined) {
      await ctx.org.patchState({ tier: "pro" });
    }

    const byScope = (scope: string) =>
      response
        .getItems()
        .filter((item) => item.type === "state_change" && item.scope === scope);

    const userItems = byScope("user");
    const requestItems = byScope("request");
    const orgItems = byScope("org");

    expect(userItems).toHaveLength(1);
    expect(userItems[0]?.delta).toEqual({ role: "admin" });
    expect(userItems[0]?.operation).toBe("patch");
    expect(userItems[0]?.blockInstanceId).toBeUndefined();
    expect(userItems[0]?.provenance.blockName).toBe("runtime");

    expect(requestItems).toHaveLength(1);
    expect(requestItems[0]?.delta).toEqual({ phase: "running" });

    expect(orgItems).toHaveLength(1);
    expect(orgItems[0]?.delta).toEqual({ tier: "pro" });
  });

  it("suppresses scope-level state_change emit when patch is a no-op (FIX-576)", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "scope-state-change-noop",
      sessionStateSchema: z.object({ status: z.string().default("idle") }),
      actions: {
        run: {
          inputSchema: z.number(),
          block: handler({
            name: "noop",
            inputSchema: z.number(),
            outputSchema: z.number(),
            execute: (input) => input
          })
        }
      }
    })();

    const response = createResponseEmitter({ requestId: "req_scope_noop" });
    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_scope_noop",
      sessionId: "sess_scope_noop",
      userId: "user_scope_noop",
      sessionState: { status: "idle" },
      stores,
      response,
      modelResolver: (modelId) => ({
        modelId,
        async generate() {
          return { text: "ok" };
        }
      })
    });

    // schema default already sets status to "idle" — patch with the same value
    // is a no-op and must not emit.
    await (ctx.session as unknown as { patchState: (u: Record<string, unknown>) => Promise<boolean> }).patchState({ status: "idle" });

    const items = response
      .getItems()
      .filter((item) => item.type === "state_change");
    expect(items).toHaveLength(0);
  });

  it("scope-level state_change items honor transient default in production (FIX-576)", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "scope-state-change-transient",
        sessionStateSchema: z.object({ status: z.string().default("idle") }),
        actions: {
          run: {
            inputSchema: z.number(),
            block: handler({
              name: "noop",
              inputSchema: z.number(),
              outputSchema: z.number(),
              execute: (input) => input
            })
          }
        }
      })() as ReturnType<ReturnType<typeof defineFlow>> & { persistStateChanges?: boolean };

      const prodResponse = createResponseEmitter({ requestId: "req_scope_prod" });
      const prodCtx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_scope_prod",
        sessionId: "sess_scope_prod",
        userId: "user_scope_prod",
        stores,
        response: prodResponse,
        modelResolver: (modelId) => ({
          modelId,
          async generate() {
            return { text: "ok" };
          }
        })
      });
      await (prodCtx.session as unknown as { patchState: (u: Record<string, unknown>) => Promise<boolean> }).patchState({ status: "running" });
      const prodItems = prodResponse
        .getItems()
        .filter((item) => item.type === "state_change");
      expect(prodItems).toHaveLength(1);
      expect(prodItems[0]?.transient).toBe(true);

      flow.persistStateChanges = true;
      const persistedResponse = createResponseEmitter({ requestId: "req_scope_persist" });
      const persistedCtx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_scope_persist",
        sessionId: "sess_scope_persist",
        userId: "user_scope_persist",
        stores,
        response: persistedResponse,
        modelResolver: (modelId) => ({
          modelId,
          async generate() {
            return { text: "ok" };
          }
        })
      });
      await (persistedCtx.session as unknown as { patchState: (u: Record<string, unknown>) => Promise<boolean> }).patchState({ status: "running" });
      const persistedItems = persistedResponse
        .getItems()
        .filter((item) => item.type === "state_change");
      expect(persistedItems).toHaveLength(1);
      expect(persistedItems[0]?.transient).toBe(false);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("uses transient state_change items in production unless persistStateChanges is enabled", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const stores = createInMemoryStores();
      const step = handler({
        name: "step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value, blockCtx) => {
          await blockCtx.sequencer?.patchState({ count: value + 1 });
          return value;
        }
      });

      const seq = sequencer({
        name: "seq-prod",
        inputSchema: z.number(),
        stateSchema: z.object({ count: z.number().default(0) })
      }).step(step);

      const flow = defineFlow({
        kind: "state-change-transience",
        actions: {
          run: {
            inputSchema: z.number(),
            block: seq
          }
        }
      })() as ReturnType<ReturnType<typeof defineFlow>> & { persistStateChanges?: boolean };

      const response = createResponseEmitter({ requestId: "req_transient_prod" });
      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_transient_prod",
        sessionId: "sess_transient_prod",
        userId: "user_transient_prod",
        stores,
        response,
        modelResolver: (modelId) => ({
          modelId,
          async generate() {
            return { text: "ok" };
          }
        })
      });

      const prodResult = await executeBlock({ block: seq, input: 1, ctx });
      expect(prodResult.error).toBeUndefined();

      const prodStateItems = response.getItems().filter((item) => item.type === "state_change");
      expect(prodStateItems).toHaveLength(1);
      expect(prodStateItems[0]?.transient).toBe(true);

      flow.persistStateChanges = true;
      const persistedResponse = createResponseEmitter({ requestId: "req_transient_persist" });
      const persistedCtx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_transient_persist",
        sessionId: "sess_transient_persist",
        userId: "user_transient_persist",
        stores,
        response: persistedResponse,
        modelResolver: (modelId) => ({
          modelId,
          async generate() {
            return { text: "ok" };
          }
        })
      });

      const persistedResult = await executeBlock({ block: seq, input: 2, ctx: persistedCtx });
      expect(persistedResult.error).toBeUndefined();

      const persistedStateItems = persistedResponse
        .getItems()
        .filter((item) => item.type === "state_change");
      expect(persistedStateItems).toHaveLength(1);
      expect(persistedStateItems[0]?.transient).toBe(false);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("suppresses state_change emit when patchState is a no-op (FIX-477 part 1)", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state_noop");

    const noOp = handler({
      name: "noop-mutate",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        // schema default is `count: 0`. Patch with the same value — should
        // be detected as a no-op and emit nothing.
        await stepCtx.sequencer!.patchState({ count: 0 });
        return input;
      }
    });

    const seq = sequencer({
      name: "noop-stateful",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(0) })
    }).step(noOp);

    const result = await executeBlock({ block: seq, input: 1, ctx });
    expect(result.error).toBeUndefined();

    const response = ctx.response as ReturnType<typeof createResponseEmitter>;
    const stateChanges = response
      .getItems()
      .filter((item) => item.type === "state_change");
    expect(stateChanges).toHaveLength(0);
  });

  it("no-op guard runs even when persistStateChanges is enabled", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const stores = createInMemoryStores();
      const step = handler({
        name: "noop-step",
        inputSchema: z.number(),
        outputSchema: z.number(),
        execute: async (value, stepCtx) => {
          await stepCtx.sequencer!.patchState({ count: 0 });
          return value;
        }
      });

      const seq = sequencer({
        name: "noop-persisted",
        inputSchema: z.number(),
        stateSchema: z.object({ count: z.number().default(0) })
      }).step(step);

      const flow = defineFlow({
        kind: "noop-persisted-flow",
        actions: {
          run: { inputSchema: z.number(), block: seq }
        }
      })() as ReturnType<ReturnType<typeof defineFlow>> & { persistStateChanges?: boolean };
      flow.persistStateChanges = true;

      const response = createResponseEmitter({ requestId: "req_noop_persisted" });
      const ctx = await createExecutionContext({
        flow,
        actionName: "run",
        requestId: "req_noop_persisted",
        sessionId: "sess_noop_persisted",
        userId: "user_noop_persisted",
        stores,
        response,
        modelResolver: (modelId) => ({
          modelId,
          async generate() {
            return { text: "ok" };
          }
        })
      });

      const result = await executeBlock({ block: seq, input: 1, ctx });
      expect(result.error).toBeUndefined();
      const stateChanges = response
        .getItems()
        .filter((item) => item.type === "state_change");
      expect(stateChanges).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("transient slots: patches are in-memory only and never appear on the stream (FIX-477 part 2)", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state_transient");

    let observedScratch: unknown = undefined;

    const writeScratch = handler({
      name: "write-scratch",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        await stepCtx.sequencer!.patchState({ scratch: "v1" });
        return input;
      }
    });

    const readScratch = handler({
      name: "read-scratch",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        observedScratch = (stepCtx.sequencer!.state as Record<string, unknown>).scratch;
        return input;
      }
    });

    const seq = sequencer({
      name: "transient-only",
      inputSchema: z.number(),
      stateSchema: z.object({
        visible: z.number().default(0),
        scratch: transientSlot(z.string().optional())
      })
    })
      .step(writeScratch)
      .step(readScratch);

    const result = await executeBlock({ block: seq, input: 1, ctx });
    expect(result.error).toBeUndefined();

    const response = ctx.response as ReturnType<typeof createResponseEmitter>;

    // No state_change item: only a transient slot mutated.
    const stateChanges = response
      .getItems()
      .filter((item) => item.type === "state_change");
    expect(stateChanges).toHaveLength(0);

    // Subsequent step still saw the in-memory value.
    expect(observedScratch).toBe("v1");

    // state_snapshot payloads must not carry the transient key.
    const snapshots = response
      .getItems()
      .filter((item) => item.type === "state_snapshot") as Array<{
        type: "state_snapshot";
        state: Record<string, unknown>;
      }>;
    for (const snap of snapshots) {
      expect("scratch" in snap.state).toBe(false);
      expect("visible" in snap.state).toBe(true);
    }
  });

  it("transient slots: mixed patch emits delta with transient keys stripped", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state_transient_mix");

    const mixed = handler({
      name: "mixed-mutate",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        await stepCtx.sequencer!.patchState({ visible: 5, scratch: "x" });
        return input;
      }
    });

    const seq = sequencer({
      name: "transient-mixed",
      inputSchema: z.number(),
      stateSchema: z.object({
        visible: z.number().default(0),
        scratch: transientSlot(z.string().optional())
      })
    }).step(mixed);

    const result = await executeBlock({ block: seq, input: 1, ctx });
    expect(result.error).toBeUndefined();

    const response = ctx.response as ReturnType<typeof createResponseEmitter>;
    const stateChanges = response
      .getItems()
      .filter((item) => item.type === "state_change") as Array<
        Extract<ReturnType<typeof response.getItems>[number], { type: "state_change" }>
      >;
    expect(stateChanges).toHaveLength(1);
    expect(stateChanges[0].operation).toBe("patch");
    expect(stateChanges[0].delta).toEqual({ visible: 5 });
  });

  it("transient slots: setState delta is filtered to non-transient keys", async () => {
    const { ctx } = await createRuntimeContext("req_seq_state_transient_set");

    const setBoth = handler({
      name: "set-both",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: async (input, stepCtx) => {
        await stepCtx.sequencer!.setState({ visible: 1, scratch: "y" });
        return input;
      }
    });

    const seq = sequencer({
      name: "transient-set",
      inputSchema: z.number(),
      stateSchema: z.object({
        visible: z.number().default(0),
        scratch: transientSlot(z.string().optional())
      })
    }).step(setBoth);

    const result = await executeBlock({ block: seq, input: 1, ctx });
    expect(result.error).toBeUndefined();

    const response = ctx.response as ReturnType<typeof createResponseEmitter>;
    const stateChanges = response
      .getItems()
      .filter((item) => item.type === "state_change") as Array<
        Extract<ReturnType<typeof response.getItems>[number], { type: "state_change" }>
      >;
    expect(stateChanges).toHaveLength(1);
    expect(stateChanges[0].operation).toBe("set");
    expect(stateChanges[0].delta).toEqual({ visible: 1 });
  });

  it("resolves nearest sequencer and applies schema defaults", async () => {
    const { ctx } = await createRuntimeContext("req_seq_nested");

    const leaf = handler({
      name: "leaf",
      inputSchema: z.number(),
      outputSchema: z.object({
        nearest: z.string(),
        count: z.number()
      }),
      execute: (input, leafCtx) => ({
        nearest: String(leafCtx.sequencer?.name),
        count: Number((leafCtx.sequencer?.state as Record<string, unknown>)?.count ?? input)
      })
    });

    const inner = sequencer({
      name: "inner",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(11) })
    }).step(leaf);

    const outer = sequencer({
      name: "outer",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(7) })
    }).step(inner);

    const result = await executeBlock({
      block: outer,
      input: 1,
      ctx
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ nearest: "inner", count: 11 });
  });

  it("resolves ctx.sequencer in tool blocks and leaves it undefined outside sequencers", async () => {
    const stores = createInMemoryStores();
    const base = handler({
      name: "base",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value
    });

    const flow = defineFlow({
      kind: "seq-tool-flow",
      actions: {
        run: {
          inputSchema: z.number(),
          block: base
        }
      }
    })();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_seq_tool",
      sessionId: "sess_seq_tool",
      userId: "user_seq_tool",
      stores,
      modelResolver: (modelId) => ({
        modelId,
        async generate(options: any) {
          if (Array.isArray(options.tools) && options.tools.length > 0 && typeof options.tools[0]?.execute === "function") {
            await options.tools[0].execute({ text: "hello" });
          }
          return { text: "ok" };
        }
      })
    });

    const toolObservations: string[] = [];

    const tool = handler({
      name: "tool",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      execute: (_input, toolCtx) => {
        toolObservations.push(`${toolCtx.sequencer?.name}:${toolCtx.getTarget("research")?.name}`);
        return "done";
      }
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "use tool",
      tools: [tool]
    });

    const seq = sequencer({
      name: "research",
      inputSchema: z.object({ text: z.string() }),
      stateSchema: z.object({ mode: z.string().default("idle") })
    }).step(chat);

    const seqResult = await executeBlock({
      block: seq,
      input: { text: "hi" },
      ctx
    });

    expect(seqResult.error).toBeUndefined();
    expect(toolObservations).toEqual(["research:research"]);

    const standalone = handler({
      name: "standalone",
      inputSchema: z.number(),
      outputSchema: z.boolean(),
      execute: (_input, standaloneCtx) => standaloneCtx.sequencer === undefined
    });

    const standaloneResult = await executeBlock({
      block: standalone,
      input: 1,
      ctx
    });

    expect(standaloneResult.output).toBe(true);
  });


  it("emits container items for sequencer execution and preserves block-instance parent linkage", async () => {
    const { ctx } = await createRuntimeContext("req_container_link");

    const leaf = handler({
      name: "leaf-step",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitMessage(`value:${value}`);
        return value + 1;
      }
    });

    const flowSeq = sequencer({
      name: "research",
      inputSchema: z.number(),
      container: {
        component: "ResearchProgress",
        label: (input) => `Research:${input}`,
        metadata: (input) => ({ startedWith: input })
      }
    }).step(leaf);

    const result = await executeBlock({
      block: flowSeq,
      input: 2,
      ctx
    });

    expect(result.error).toBeUndefined();

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const container = items.find((item) => item.type === "container");
    expect(container).toBeDefined();
    expect(container).toMatchObject({
      blockName: "research",
      component: "ResearchProgress",
      label: "Research:2",
      metadata: { startedWith: 2 }
    });

  });

  it("emits container lifecycle: in_progress on entry, completed on exit (FIX-574)", async () => {
    const { ctx } = await createRuntimeContext("req_container_lifecycle");

    const leaf = handler({
      name: "lifecycle-leaf",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 1
    });

    const flowSeq = sequencer({
      name: "lifecycle-seq",
      inputSchema: z.number(),
      container: { component: "Lifecycle" }
    }).step(leaf);

    await executeBlock({ block: flowSeq, input: 1, ctx });

    const events = (ctx.response as { getEvents: () => Array<any> }).getEvents();
    const containerEvents = events.filter(
      (e: any) =>
        (e.type === "item.added" && e.item?.type === "container") ||
        (e.type === "item.done" && e.item?.type === "container") ||
        (e.type === "item.updated" &&
          events.some(
            (other: any) =>
              other.type === "item.added" &&
              other.item?.type === "container" &&
              other.item.id === e.itemId
          ))
    );
    const types = containerEvents.map((e: any) => e.type);
    expect(types).toEqual(["item.added", "item.updated", "item.done"]);

    const added = containerEvents[0];
    expect(added.item.status).toBe("in_progress");
    expect(added.item.startedAt).toBeTypeOf("number");

    const updated = containerEvents[1];
    expect(updated.itemId).toBe(added.item.id);
    expect(updated.patch.status).toBe("completed");
    expect(updated.patch.completedAt).toBeTypeOf("number");
    expect(updated.patch.duration).toBeTypeOf("number");

    const done = containerEvents[2];
    expect(done.item.status).toBe("completed");

    // The settled snapshot in itemsById reflects the patched state.
    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const container = items.find((item: any) => item.type === "container");
    expect(container.status).toBe("completed");
    expect(container.completedAt).toBeTypeOf("number");
    expect(container.duration).toBeTypeOf("number");
  });

  it("emits container lifecycle with failed status when sequencer throws (FIX-574)", async () => {
    const { ctx } = await createRuntimeContext("req_container_failure");

    const failing = handler({
      name: "failing-leaf",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("boom");
      }
    });

    const failSeq = sequencer({
      name: "failing-seq",
      inputSchema: z.number(),
      container: { component: "Failure" }
    }).step(failing);

    const result = await executeBlock({ block: failSeq, input: 1, ctx });
    expect(result.error).toBeDefined();

    const events = (ctx.response as { getEvents: () => Array<any> }).getEvents();
    const addedEvent = events.find(
      (e: any) => e.type === "item.added" && e.item?.type === "container"
    );
    expect(addedEvent).toBeDefined();
    const containerId = addedEvent.item.id;
    const updatedEvent = events.find(
      (e: any) => e.type === "item.updated" && e.itemId === containerId
    );
    const doneEvent = events.find(
      (e: any) =>
        e.type === "item.done" && e.item?.type === "container" && e.item.id === containerId
    );

    expect(addedEvent.item.status).toBe("in_progress");
    expect(updatedEvent).toBeDefined();
    expect(updatedEvent.patch.status).toBe("failed");
    expect(updatedEvent.patch.error).toEqual({ message: "boom" });
    expect(doneEvent).toBeDefined();
    expect(doneEvent.item.status).toBe("failed");
    expect(doneEvent.item.error).toEqual({ message: "boom" });
  });

  it("propagates ownedBy on items emitted inside a container scope", async () => {
    const { ctx } = await createRuntimeContext("req_owned_by");

    const leaf = handler({
      name: "owned-step",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitMessage(`value:${value}`);
        stepCtx.emitStatus("working");
        return value + 1;
      }
    });

    const containerSeq = sequencer({
      name: "container-seq",
      inputSchema: z.number(),
      container: { component: "test-container" }
    }).step(leaf);

    await executeBlock({ block: containerSeq, input: 5, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();

    // ContainerItem itself should not have ownedBy (no parent container).
    const containerItem = items.find((item: any) => item.type === "container");
    expect(containerItem).toBeDefined();
    expect(containerItem.ownedBy).toBeUndefined();

    // Message and status items emitted inside the container scope carry ownedBy.
    const messageItem = items.find((item: any) => item.type === "message");
    expect(messageItem).toBeDefined();
    expect(messageItem.ownedBy).toBe(containerItem.provenance.blockInstanceId);

    const statusItem = items.find((item: any) => item.type === "status");
    expect(statusItem).toBeDefined();
    expect(statusItem.ownedBy).toBe(containerItem.provenance.blockInstanceId);
  });

  it("sets ownedBy to inner container for nested container scopes", async () => {
    const { ctx } = await createRuntimeContext("req_nested_owned");

    const leaf = handler({
      name: "inner-leaf",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitMessage(`inner:${value}`);
        return value + 1;
      }
    });

    const innerSeq = sequencer({
      name: "inner-container",
      inputSchema: z.number(),
      container: { component: "inner" }
    }).step(leaf);

    const outerSeq = sequencer({
      name: "outer-container",
      inputSchema: z.number(),
      container: { component: "outer" }
    }).step(innerSeq);

    await executeBlock({ block: outerSeq, input: 1, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();

    const outerContainer = items.find(
      (item: any) => item.type === "container" && item.component === "outer"
    );
    const innerContainer = items.find(
      (item: any) => item.type === "container" && item.component === "inner"
    );

    expect(outerContainer).toBeDefined();
    expect(innerContainer).toBeDefined();

    // Outer container has no ownedBy (top level).
    expect(outerContainer.ownedBy).toBeUndefined();

    // Inner container is owned by the outer container.
    expect(innerContainer.ownedBy).toBe(outerContainer.provenance.blockInstanceId);

    // Message inside inner container is owned by inner container.
    const messageItem = items.find((item: any) => item.type === "message");
    expect(messageItem).toBeDefined();
    expect(messageItem.ownedBy).toBe(innerContainer.provenance.blockInstanceId);
  });

  it("does not set ownedBy for items outside any container scope", async () => {
    const { ctx } = await createRuntimeContext("req_no_container");

    const leaf = handler({
      name: "plain-step",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitMessage(`plain:${value}`);
        return value + 1;
      }
    });

    const plainSeq = sequencer({
      name: "plain-seq",
      inputSchema: z.number()
    }).step(leaf);

    await executeBlock({ block: plainSeq, input: 3, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const messageItem = items.find((item: any) => item.type === "message");
    expect(messageItem).toBeDefined();
    expect(messageItem.ownedBy).toBeUndefined();
  });

  it("runs request lifecycle observers in canonical order for success and failure", async () => {
    const stores = createInMemoryStores();
    const events: string[] = [];

    const observer = (name: string) =>
      handler({
        name,
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: (input) => {
          const status =
            typeof input === "object" &&
            input !== null &&
            "status" in input
              ? String((input as { status?: unknown }).status)
              : undefined;
          events.push(status === undefined ? name : `${name}:${status}`);
        }
      });

    const successFlow = defineFlow({
      kind: "run-success",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "success-action",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
            execute: () => "done"
          }),
          onCompleted: observer("action.completed")
        }
      },
      request: {
        onStarted: observer("request.started"),
        onCompleted: observer("request.completed"),
        onFinished: observer("request.finished")
      }
    })();

    const success = await runAction({
      flow: successFlow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_success",
      sessionId: "sess_success",
      userId: "user_success",
      stores,
      runtimeConfig: {}
    });

    expect(success.error).toBeUndefined();
    expect(success.output).toBe("done");
    expect(events).toEqual([
      "request.started",
      "action.completed",
      "request.completed",
      "request.finished:completed"
    ]);
    expect((await stores.request.get("req_success"))?.status).toBe("completed");

    events.length = 0;

    const failureFlow = defineFlow({
      kind: "run-failure",
      actions: {
        run: {
          inputSchema: z.object({ value: z.number() }),
          block: handler({
            name: "failure-action",
            inputSchema: z.object({ value: z.number() }),
            outputSchema: z.string(),
            execute: () => {
              throw new Error("boom");
            }
          }),
          onErrored: observer("action.errored")
        }
      },
      request: {
        onStarted: observer("request.started"),
        onErrored: observer("request.errored"),
        onFinished: observer("request.finished")
      }
    })();

    const failed = await runAction({
      flow: failureFlow,
      actionName: "run",
      input: { value: 1 },
      requestId: "req_failure",
      sessionId: "sess_failure",
      userId: "user_failure",
      stores,
      runtimeConfig: {}
    });

    expect(failed.error).toBeDefined();
    expect(failed.error).toBeInstanceOf(FlowError);
    expect(failed.items.some((item) => item.type === "error")).toBe(true);
    expect(events).toEqual([
      "request.started",
      "action.errored",
      "request.errored",
      "request.finished:failed"
    ]);
    expect((await stores.request.get("req_failure"))?.status).toBe("failed");
  });

  it("keeps execution behavior unchanged with explicit no-op seams", async () => {
    const { ctx } = await createRuntimeContext("req_seam_parity");
    const block = handler({
      name: "seam-handler",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value) => value + 4
    });

    const baseline = await executeBlock({
      block,
      input: 2,
      ctx
    });
    const withNoopSeams = await executeBlock({
      block,
      input: 2,
      ctx,
      internalSeams: NOOP_INTERNAL_EXECUTION_SEAMS
    });

    expect(withNoopSeams.output).toBe(baseline.output);
    expect(baseline.items.at(-1)?.type).toBe("block_trace");
    expect(withNoopSeams.items.at(-1)?.type).toBe("block_trace");
    // FIX-413: block_output items carry BlockValue<T>, not the raw T. Handlers
    // are leaves — always inline.
    expect(withNoopSeams.items.at(-1)).toMatchObject({
      blockName: "seam-handler",
      output: { kind: "inline", value: baseline.output }
    });
    expect(withNoopSeams.error).toEqual(baseline.error);
  });

  it("allows internal seam interception on normalized block errors", async () => {
    const { ctx } = await createRuntimeContext("req_seam_error");
    const failing = handler({
      name: "failing-block",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: () => {
        throw new Error("original");
      }
    });

    const result = await executeBlock({
      block: failing,
      input: 1,
      ctx,
      internalSeams: {
        interceptNormalizedError: (error) =>
          new FlowError(`intercepted:${error.message}`, {
            code: "intercepted_error",
            retryable: false,
            scope: "block"
          })
      }
    });

    expect(result.error?.code).toBe("intercepted_error");
    expect(result.error?.message).toBe("intercepted:original");
  });
});

describe("transient block output", () => {
  it("transient block: block_trace inherits transient and is not persisted (FIX-586)", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "transient-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "transient-handler",
            transient: true,
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: ({ value }) => `processed:${value}`
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "test" },
      userId: "user_transient",
      sessionId: "sess_transient",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    expect(result.output).toBe("processed:test");

    // FIX-586 restores the FIX-478 contract: auto-emitted block_trace
    // inherits the originating block's `transient` flag, so traces from a
    // transient block are filtered out of the persisted items log.
    const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
    const storedItems = requestRecord?.items ?? [];
    const blockOutputItems = storedItems.filter((item) => item.type === "block_trace");
    expect(blockOutputItems.length).toBe(0);
  });

  it("transient block: block_trace streams live but is marked transient (FIX-586)", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "transient-stream-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "transient-streaming",
            transient: true,
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: ({ value }) => `streamed:${value}`
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "hello" },
      userId: "user_stream",
      sessionId: "sess_stream",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    // FIX-586: trace still streams live (visible on result.items, which
    // reflects the emitter's view) but inherits the block's transient flag.
    const blockOutputItems = result.items.filter((item) => item.type === "block_trace");
    expect(blockOutputItems.length).toBe(1);
    expect(blockOutputItems[0]?.transient).toBe(true);
  });

  it("non-transient blocks in the same flow are unaffected", async () => {
    const transientBlock = handler({
      name: "transient-step",
      transient: true,
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.string(),
      execute: ({ value }) => `t:${value}`
    });

    const durableBlock = handler({
      name: "durable-step",
      inputSchema: z.string(),
      outputSchema: z.string(),
      execute: (value) => `d:${value}`
    });

    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "mixed-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: sequencer({
            name: "mixed-sequencer",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.object({ value: z.string() }),
            execute: async (input, ctx) => {
              await ctx._withExecutionScope!(
                { name: "transient-step", kind: "handler", instanceId: "t1" },
                async (scopedCtx) => {
                  return runForTest(transientBlock, input, scopedCtx);
                }
              );
              const result = await ctx._withExecutionScope!(
                { name: "durable-step", kind: "handler", instanceId: "d1" },
                async (scopedCtx) => {
                  return runForTest(durableBlock, "hello", scopedCtx);
                }
              );
              return result;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "test" },
      userId: "user_mixed",
      sessionId: "sess_mixed",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    // In-flight items include both transient and non-transient
    const allBlockOutputs = result.items.filter((item) => item.type === "block_trace");
    expect(allBlockOutputs.length).toBeGreaterThanOrEqual(1);

    // Persisted items should exclude transient block output but include durable
    const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
    const storedItems = requestRecord?.items ?? [];
    const storedBlockOutputNames = storedItems
      .filter((item) => item.type === "block_trace")
      .map((item) => (item as { blockName: string }).blockName);

    // The sequencer's own block output is durable (sequencer is not transient)
    expect(storedBlockOutputNames).toContain("mixed-sequencer");
  });

  it("transient block: emitMessage produces persisted message; block_trace is canonical retained", async () => {
    // FIX-478: explicit emit calls are user-facing content. They no longer
    // inherit the producing block's `transient` flag.
    // FIX-573 §3.8: block_trace is always retained, regardless of the
    // originating block's `transient` flag.
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "transient-gen-flow",
      actions: {
        run: {
          inputSchema: z.object({ prompt: z.string() }),
          block: handler({
            name: "transient-gen",
            transient: true,
            inputSchema: z.object({ prompt: z.string() }),
            outputSchema: z.string(),
            execute: async ({ prompt }, ctx) => {
              ctx.emitMessage(`Response: ${prompt}`);
              return `done:${prompt}`;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { prompt: "hello" },
      userId: "user_gen",
      sessionId: "sess_gen",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    // In-flight: message item present and non-transient (emitMessage no longer
    // inherits blockTransient).
    const messageItems = result.items.filter(
      (item) => item.type === "message" && item.role === "assistant"
    );
    expect(messageItems.length).toBeGreaterThanOrEqual(1);
    expect(messageItems[0]?.transient).toBeUndefined();

    // Persisted: the message survives because it is not transient.
    const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
    const storedMessages = (requestRecord?.items ?? []).filter(
      (item) => item.type === "message" && (item as { role: string }).role === "assistant"
    );
    expect(storedMessages.length).toBe(1);

    // FIX-586: block_trace inherits the originating block's `transient`
    // flag, so the trace for `transient-gen` is filtered from the persisted
    // items log. The user-facing message above survives because emitMessage
    // defaults to non-transient (FIX-478).
    const storedBlockOutputs = (requestRecord?.items ?? []).filter(
      (item) => item.type === "block_trace"
    );
    const transientGenTrace = storedBlockOutputs.find(
      (i) => (i as { blockName: string }).blockName === "transient-gen"
    );
    expect(transientGenTrace).toBeUndefined();
  });

  describe("emit* default semantics (FIX-478)", () => {
    it("transient block + emitComponent → non-transient by default; persists", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-comp-default",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "transient-emit-component",
              transient: true,
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitComponent("widget", { v: 1 });
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter((item) => item.type === "component");
      expect(inFlight.length).toBe(1);
      expect(inFlight[0]?.transient).toBeUndefined();

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter((item) => item.type === "component");
      expect(stored.length).toBe(1);
    });

    it("transient block + emitComponent({ transient: true }) → transient; stripped", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-comp-opt-in",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "transient-emit-component-transient",
              transient: true,
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitComponent("widget", { v: 1 }, { transient: true });
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter((item) => item.type === "component");
      expect(inFlight.length).toBe(1);
      expect(inFlight[0]?.transient).toBe(true);

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter((item) => item.type === "component");
      expect(stored.length).toBe(0);
    });

    it("non-transient block + emitComponent({ transient: true }) → transient", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-comp-nontransient-block",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "durable-block-transient-emit",
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitComponent("widget", { v: 1 }, { transient: true });
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter((item) => item.type === "component");
      expect(inFlight.length).toBe(1);
      expect(inFlight[0]?.transient).toBe(true);

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter((item) => item.type === "component");
      expect(stored.length).toBe(0);
    });

    it("transient block + emitMessage({ transient: true }) → transient; stripped", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-message-opt-in",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "transient-emit-message-transient",
              transient: true,
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitMessage("hi", { transient: true });
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter(
        (item) => item.type === "message" && (item as { role: string }).role === "assistant"
      );
      expect(inFlight.length).toBe(1);
      expect(inFlight[0]?.transient).toBe(true);

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter(
        (item) => item.type === "message" && (item as { role: string }).role === "assistant"
      );
      expect(stored.length).toBe(0);
    });

    it("transient block + emitStatus → transient by default", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-status-default",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "transient-emit-status",
              transient: true,
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitStatus("working");
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter((item) => item.type === "status");
      expect(inFlight.length).toBeGreaterThanOrEqual(1);
      expect(inFlight[0]?.transient).toBe(true);

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter((item) => item.type === "status");
      expect(stored.length).toBe(0);
    });

    it("non-transient block + emitStatus({ transient: false }) → persisted", async () => {
      const stores = createInMemoryStores();
      const flow = defineFlow({
        kind: "fix478-status-opt-out",
        actions: {
          run: {
            inputSchema: z.object({ value: z.string() }),
            block: handler({
              name: "status-persist-opt-out",
              inputSchema: z.object({ value: z.string() }),
              outputSchema: z.string(),
              execute: async ({ value }, ctx) => {
                ctx.emitStatus("working", { transient: false });
                return value;
              }
            })
          }
        }
      })();

      const result = await runAction({
        flow,
        actionName: "run",
        input: { value: "ok" },
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });

      expect(result.error).toBeUndefined();
      const inFlight = result.items.filter((item) => item.type === "status");
      expect(inFlight.length).toBeGreaterThanOrEqual(1);
      expect(inFlight[0]?.transient).toBeUndefined();

      const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
      const stored = (requestRecord?.items ?? []).filter((item) => item.type === "status");
      expect(stored.length).toBe(1);
    });
  });

  it("existing transient status items are also stripped from store", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "status-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: handler({
            name: "status-handler",
            inputSchema: z.object({ text: z.string() }),
            outputSchema: z.string(),
            execute: async ({ text }, ctx) => {
              ctx.emitStatus("processing...");
              return text;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { text: "ok" },
      userId: "user_status",
      sessionId: "sess_status",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    // Status items are always transient, so they should be in-flight but not stored
    const inFlightStatus = result.items.filter((item) => item.type === "status");
    expect(inFlightStatus.length).toBeGreaterThanOrEqual(1);
    expect(inFlightStatus[0]?.transient).toBe(true);

    const requestRecord = await stores.request.get(result.items[0]?.requestId ?? "");
    const storedStatus = (requestRecord?.items ?? []).filter((item) => item.type === "status");
    expect(storedStatus.length).toBe(0);
  });
});

describe("keyed component upsert (FIX-491)", () => {
  it("two emits with same key collapse to one item; latest data wins", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "fix491-keyed-upsert",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "keyed-emit-twice",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: async ({ value }, ctx) => {
              ctx.emitComponent("widget", { a: 1, b: 2 }, { key: "k" });
              ctx.emitComponent("widget", { a: 99 }, { key: "k" });
              return value;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "ok" },
      userId: "u",
      sessionId: "s",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    const inFlight = result.items.filter((item) => item.type === "component");
    expect(inFlight.length).toBe(1);
    const inFlightItem = inFlight[0] as {
      id: string;
      data: Record<string, unknown>;
      key?: string;
    };
    expect(inFlightItem.id).toBe("item_component_keyed:k");
    expect(inFlightItem.key).toBe("k");
    // Replace, not merge: `b` from the first emission is gone.
    expect(inFlightItem.data).toEqual({ a: 99 });

    const requestRecord = await stores.request.get(
      result.items[0]?.requestId ?? ""
    );
    const stored = (requestRecord?.items ?? []).filter(
      (item) => item.type === "component"
    );
    expect(stored.length).toBe(1);
    expect((stored[0] as { data: Record<string, unknown> }).data).toEqual({
      a: 99
    });
  });

  it("two emits without a key produce two distinct items", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "fix491-non-keyed",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "non-keyed-emit-twice",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: async ({ value }, ctx) => {
              ctx.emitComponent("widget", { v: 1 });
              ctx.emitComponent("widget", { v: 2 });
              return value;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "ok" },
      userId: "u",
      sessionId: "s",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    const inFlight = result.items.filter((item) => item.type === "component");
    expect(inFlight.length).toBe(2);
    const ids = new Set(inFlight.map((item) => item.id));
    expect(ids.size).toBe(2);

    const requestRecord = await stores.request.get(
      result.items[0]?.requestId ?? ""
    );
    const stored = (requestRecord?.items ?? []).filter(
      (item) => item.type === "component"
    );
    expect(stored.length).toBe(2);
  });

  it("distinct keys produce distinct items", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "fix491-distinct-keys",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "distinct-keyed-emit",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: async ({ value }, ctx) => {
              ctx.emitComponent("widget", { v: 1 }, { key: "a" });
              ctx.emitComponent("widget", { v: 2 }, { key: "b" });
              ctx.emitComponent("widget", { v: 3 }, { key: "a" });
              return value;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "ok" },
      userId: "u",
      sessionId: "s",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();

    const inFlight = result.items.filter((item) => item.type === "component");
    expect(inFlight.length).toBe(2);
    const byKey = new Map(
      inFlight.map((item) => {
        const typed = item as { key?: string; data: Record<string, unknown> };
        return [typed.key, typed.data] as const;
      })
    );
    expect(byKey.get("a")).toEqual({ v: 3 });
    expect(byKey.get("b")).toEqual({ v: 2 });
  });

  it("event log appends one item.added + item.done per emission, all sharing the keyed item ID", async () => {
    const stores = createInMemoryStores();
    const flow = defineFlow({
      kind: "fix491-event-log",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: handler({
            name: "keyed-emit-thrice",
            inputSchema: z.object({ value: z.string() }),
            outputSchema: z.string(),
            execute: async ({ value }, ctx) => {
              ctx.emitComponent("widget", { v: 1 }, { key: "k" });
              ctx.emitComponent("widget", { v: 2 }, { key: "k" });
              ctx.emitComponent("widget", { v: 3 }, { key: "k" });
              return value;
            }
          })
        }
      }
    })();

    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "ok" },
      userId: "u",
      sessionId: "s",
      stores,
      runtimeConfig: {}
    });

    expect(result.error).toBeUndefined();
    const requestId = result.items[0]?.requestId ?? "";
    const events = await stores.request.getEvents(requestId);

    const componentEvents = events.filter((event) => {
      const e = event as {
        type: string;
        item?: { type?: string; id?: string };
      };
      return (
        (e.type === "item.added" || e.type === "item.done") &&
        e.item?.type === "component"
      );
    });

    // 3 emissions × (added + done) = 6 events.
    expect(componentEvents.length).toBe(6);

    const itemIds = new Set(
      componentEvents.map((event) => {
        const e = event as { item?: { id?: string } };
        return e.item?.id;
      })
    );
    expect(itemIds.size).toBe(1);
    expect(itemIds.has("item_component_keyed:k")).toBe(true);
  });
});

describe("rescue boundary in nested sequencer", () => {
  it("rescues inner block failure and produces rescue output as sequencer result", async () => {
    const executionOrder: string[] = [];

    const step1 = handler({
      name: "step-1",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string(), step: z.number() }),
      execute: (input) => {
        executionOrder.push("step-1");
        return { value: input.value, step: 1 };
      }
    });

    const failingStep = handler({
      name: "failing-step",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string(), step: z.number() }),
      execute: () => {
        executionOrder.push("failing-step");
        throw new Error("inner block failure");
      }
    });

    const rescueStep = handler({
      name: "rescue-handler",
      inputSchema: z.any(),
      outputSchema: z.object({ value: z.string() }),
      execute: () => {
        executionOrder.push("rescue-handler");
        return { value: "rescued" };
      }
    });

    // Rescue is a sequencer-level boundary: when rescue fires, the rescue
    // handler's output becomes the sequencer's output. Steps chained AFTER
    // .rescue() start a new sequencer wrapping the rescued one.
    const innerSeq = sequencer({
      name: "inner-seq",
      inputSchema: z.object({ value: z.string() })
    })
      .step(step1)
      .step(failingStep)
      .rescue([{ block: rescueStep }]);

    const outerStep = handler({
      name: "outer-step",
      inputSchema: z.any(),
      outputSchema: z.object({ result: z.string() }),
      execute: (input: any) => {
        executionOrder.push("outer-step");
        return { result: `final: ${input.value}` };
      }
    });

    // Chain: innerSeq (with rescue) → outerStep
    const fullSeq = sequencer({
      name: "outer-seq",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ result: z.string() })
    })
      .step(innerSeq)
      .step(outerStep);

    const flow = defineFlow({
      kind: "rescue-flow",
      actions: {
        run: {
          inputSchema: z.object({ value: z.string() }),
          block: fullSeq
        }
      }
    })();

    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "run",
      input: { value: "test" },
      userId: "user_test",
      stores,
      runtimeConfig: {
        modelResolver: (id) => ({
          modelId: id,
          async generate() {
            return { text: "mock" };
          }
        })
      }
    });

    // Execution should complete without error — rescue caught the failure
    expect(result.error).toBeUndefined();

    // Execution order: step-1, failing-step (throws), rescue-handler, outer-step
    expect(executionOrder).toEqual([
      "step-1",
      "failing-step",
      "rescue-handler",
      "outer-step"
    ]);

    // The outer step receives rescue's output and transforms it
    expect(result.output).toEqual({ result: "final: rescued" });
  });
});

describe("emitStatus single-slot semantics (FIX-387)", () => {
  it("dedupes repeat messages — identical consecutive emits produce only the first item", async () => {
    const { ctx } = await createRuntimeContext("req_status_dedupe");
    const block = handler({
      name: "dedupe-block",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitStatus("working");
        stepCtx.emitStatus("working");
        stepCtx.emitStatus("working");
        return value;
      }
    });

    await executeBlock({ block, input: 1, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusItems = items.filter((item: any) => item.type === "status");
    expect(statusItems.length).toBe(1);
    expect(statusItems[0].message).toBe("working");
  });

  it("undefined preserves the slot message while updating signals", async () => {
    const { ctx } = await createRuntimeContext("req_status_signals");
    const block = handler({
      name: "signals-block",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitStatus("uploading files");
        stepCtx.emitStatus(undefined, { blocked: false, backgroundTasks: 3 });
        stepCtx.emitStatus(undefined, { blocked: false, backgroundTasks: 0 });
        return value;
      }
    });

    await executeBlock({ block, input: 1, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusItems = items.filter((item: any) => item.type === "status");
    expect(statusItems.length).toBe(3);
    // Every emitted item carries the slot message, not undefined.
    expect(statusItems[0].message).toBe("uploading files");
    expect(statusItems[1].message).toBe("uploading files");
    expect(statusItems[2].message).toBe("uploading files");
    expect(statusItems[1].backgroundTasks).toBe(3);
    expect(statusItems[2].backgroundTasks).toBe(0);
  });

  it("empty string clears the slot — stored as the new slot value", async () => {
    const { ctx } = await createRuntimeContext("req_status_clear");
    const block = handler({
      name: "clear-block",
      inputSchema: z.number(),
      outputSchema: z.number(),
      execute: (value, stepCtx) => {
        stepCtx.emitStatus("analyzing");
        stepCtx.emitStatus("");
        // After clearing, the next undefined-signal emit carries "".
        stepCtx.emitStatus(undefined, { blocked: true });
        return value;
      }
    });

    await executeBlock({ block, input: 1, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusItems = items.filter((item: any) => item.type === "status");
    expect(statusItems.map((s: any) => s.message)).toEqual(["analyzing", "", ""]);
    expect(statusItems[2].blocked).toBe(true);
  });
});

describe("activeStatusMessage declarative config (FIX-387)", () => {
  it("fires a status emit at handler block start when set to a static string", async () => {
    const { ctx } = await createRuntimeContext("req_active_static");
    const block = handler({
      name: "active-static",
      inputSchema: z.number(),
      outputSchema: z.number(),
      activeStatusMessage: "Crunching numbers...",
      execute: (value) => value + 1
    });

    await executeBlock({ block, input: 1, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusItems = items.filter((item: any) => item.type === "status");
    expect(statusItems.length).toBe(1);
    expect(statusItems[0].message).toBe("Crunching numbers...");
  });

  it("resolves function form with (input, ctx) when the block starts", async () => {
    const { ctx } = await createRuntimeContext("req_active_fn");
    const block = handler({
      name: "active-fn",
      inputSchema: z.object({ count: z.number() }),
      outputSchema: z.number(),
      activeStatusMessage: (input: { count: number }) => `Analyzing ${input.count} items...`,
      execute: (input) => input.count
    });

    await executeBlock({ block, input: { count: 7 }, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusItems = items.filter((item: any) => item.type === "status");
    expect(statusItems.length).toBe(1);
    expect(statusItems[0].message).toBe("Analyzing 7 items...");
  });

  it("nested sequencer children each resolve their own activeStatusMessage", async () => {
    const { ctx } = await createRuntimeContext("req_active_nested");
    const stepA = handler({
      name: "step-a",
      inputSchema: z.number(),
      outputSchema: z.number(),
      activeStatusMessage: "step A running",
      execute: (value) => value + 1
    });
    const stepB = handler({
      name: "step-b",
      inputSchema: z.number(),
      outputSchema: z.number(),
      activeStatusMessage: "step B running",
      execute: (value) => value + 1
    });
    const chain = sequencer({
      name: "chain",
      inputSchema: z.number()
    })
      .step(stepA)
      .step(stepB);

    await executeBlock({ block: chain, input: 0, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusMessages = items
      .filter((item: any) => item.type === "status")
      .map((item: any) => item.message);
    expect(statusMessages).toEqual(["step A running", "step B running"]);
  });
});

describe("generator/tool status-slot restore (FIX-600)", () => {
  it("restores the slot to the generator's pre-tool value after a tool round", async () => {
    const stores = createInMemoryStores();

    const tool = handler({
      name: "weather-tool",
      inputSchema: z.object({ city: z.string() }),
      outputSchema: z.string(),
      activeStatusMessage: "Calling weather tool...",
      execute: (input, toolCtx) => {
        // The tool's own activeStatusMessage doesn't fire automatically
        // when invoked through the generator's tool loop (it bypasses
        // the dispatcher), so emit it imperatively to model the bug
        // surface: a tool whose status is left in the slot after it
        // completes.
        toolCtx.emit.status("Calling weather tool...");
        return `weather in ${input.city}`;
      }
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "use tool",
      activeStatusMessage: "Responding",
      tools: [tool]
    });

    const flow = defineFlow({
      kind: "tool-status-restore-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: chat
        }
      }
    })();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_tool_status_restore",
      sessionId: "sess_tool_status_restore",
      userId: "user_tool_status_restore",
      stores,
      modelResolver: (modelId) => ({
        modelId,
        async generate(options: any) {
          if (Array.isArray(options.tools) && options.tools.length > 0) {
            await options.tools[0].execute({ city: "Tokyo" }, { toolCallId: "tc_1" });
          }
          return { text: "ok" };
        }
      }),
      response: createResponseEmitter({ requestId: "req_tool_status_restore", now: () => 1 })
    });

    await executeBlock({ block: chat, input: { text: "weather?" }, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusMessages = items
      .filter((item: any) => item.type === "status")
      .map((item: any) => item.message);

    // Expected sequence: generator sets "Responding", the tool wrapper
    // surfaces "Using weather-tool…", the tool's own emit overrides with
    // "Calling weather tool...", restore puts "Responding" back.
    expect(statusMessages).toEqual([
      "Responding",
      "Using weather-tool…",
      "Calling weather tool...",
      "Responding"
    ]);
  });

  it("restores only once after parallel tool calls complete", async () => {
    const stores = createInMemoryStores();

    const toolA = handler({
      name: "tool-a",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: (_input, toolCtx) => {
        toolCtx.emit.status("Running A");
        return "a";
      }
    });
    const toolB = handler({
      name: "tool-b",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: (_input, toolCtx) => {
        toolCtx.emit.status("Running B");
        return "b";
      }
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "use tools",
      activeStatusMessage: "Responding",
      tools: [toolA, toolB]
    });

    const flow = defineFlow({
      kind: "parallel-tools-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: chat
        }
      }
    })();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_parallel_tools",
      sessionId: "sess_parallel_tools",
      userId: "user_parallel_tools",
      stores,
      modelResolver: (modelId) => ({
        modelId,
        async generate(options: any) {
          // Kick off both tool executes without awaiting individually;
          // wait for both via Promise.all to model parallel dispatch.
          await Promise.all([
            options.tools[0].execute({}, { toolCallId: "tc_a" }),
            options.tools[1].execute({}, { toolCallId: "tc_b" })
          ]);
          return { text: "ok" };
        }
      }),
      response: createResponseEmitter({ requestId: "req_parallel_tools", now: () => 1 })
    });

    await executeBlock({ block: chat, input: { text: "go" }, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusMessages = items
      .filter((item: any) => item.type === "status")
      .map((item: any) => item.message);

    // The exact ordering of "Running A" vs "Running B" is not guaranteed
    // (parallel competition), but the slot must (1) start at "Responding"
    // and (2) end at "Responding" with exactly ONE restore (no
    // intermediate "Responding" between the two tool emits — the
    // refcount only restores when the last tool exits).
    expect(statusMessages[0]).toBe("Responding");
    expect(statusMessages[statusMessages.length - 1]).toBe("Responding");
    // Exactly two restores would mean we restored after each tool;
    // exactly one restore is the contract.
    const restoreCount = statusMessages
      .slice(1, -1)
      .filter((m: string) => m === "Responding").length;
    expect(restoreCount).toBe(0);
  });

  it("clears the 'Using <tool>' status after a tool with no emit.status finishes", async () => {
    // Regression: web tools like search/fetch/crawl don't call emit.status
    // themselves. The framework surfaces "Using <tool>…" so the in-flight
    // indicator reflects the current tool — and must clear it on completion
    // so the indicator doesn't claim the tool is still running.
    const stores = createInMemoryStores();

    const silentTool = handler({
      name: "search",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.string(),
      execute: (input) => `results for ${input.q}`
    });

    const chat = generator({
      name: "chat",
      inputSchema: z.object({ text: z.string() }),
      outputSchema: z.string(),
      model: "mock-model",
      prompt: "use tool",
      activeStatusMessage: "Responding",
      tools: [silentTool]
    });

    const flow = defineFlow({
      kind: "silent-tool-status-flow",
      actions: {
        run: {
          inputSchema: z.object({ text: z.string() }),
          block: chat
        }
      }
    })();

    const ctx = await createExecutionContext({
      flow,
      actionName: "run",
      requestId: "req_silent_tool",
      sessionId: "sess_silent_tool",
      userId: "user_silent_tool",
      stores,
      modelResolver: (modelId) => ({
        modelId,
        async generate(options: any) {
          await options.tools[0].execute({ q: "weather" }, { toolCallId: "tc_1" });
          return { text: "ok" };
        }
      }),
      response: createResponseEmitter({ requestId: "req_silent_tool", now: () => 1 })
    });

    await executeBlock({ block: chat, input: { text: "search?" }, ctx });

    const items = (ctx.response as { getItems: () => Array<any> }).getItems();
    const statusMessages = items
      .filter((item: any) => item.type === "status")
      .map((item: any) => item.message);

    // The "Using search…" surfaced by the wrapper must be cleared back to
    // the generator's "Responding" once the tool returns — even though the
    // tool itself never touched the slot.
    expect(statusMessages).toEqual([
      "Responding",
      "Using search…",
      "Responding"
    ]);
  });
});
