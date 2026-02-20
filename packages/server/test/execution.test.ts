import {
  defineFlow,
  generator,
  handler,
  router,
  sequencer
} from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  FlowError,
  NetworkError,
  ValidationError,
  createExecutionContext,
  createInMemoryStores,
  createResponseEmitter,
  createWorkQueue,
  executeBlock,
  isRetryableError,
  mergeRetryPolicy,
  normalizeError,
  resolveRescueHandler,
  retryWithPolicy,
  runAction
} from "../src";
import {
  NOOP_INTERNAL_EXECUTION_SEAMS
} from "../src/execution/internal/seams";

async function createRuntimeContext(requestId: string) {
  const block = handler<number, number>({
    name: "base-handler",
    execute: (value) => value
  });

  const flow = defineFlow({
    kind: "runtime-flow",
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

  it("covers retry and rescue edge paths", async () => {
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

    const rescueBlock = handler<Error, string>({
      name: "rescue",
      execute: () => "ok"
    });
    expect(
      resolveRescueHandler(new Error("x"), [{ when: [ValidationError], block: rescueBlock }])
    ).toBeUndefined();
    expect(resolveRescueHandler(new Error("x"), [])).toBeUndefined();
  });

  it("resolves rescue handlers by typed match then fallback", () => {
    const typedRescue = handler<Error, string>({
      name: "typed-rescue",
      execute: () => "typed"
    });
    const fallbackRescue = handler<Error, string>({
      name: "fallback-rescue",
      execute: () => "fallback"
    });

    const resolvedTyped = resolveRescueHandler(new ValidationError("x"), [
      { when: [ValidationError], block: typedRescue },
      { block: fallbackRescue }
    ]);
    expect(resolvedTyped?.name).toBe("typed-rescue");

    const resolvedFallback = resolveRescueHandler(new Error("x"), [
      { when: [ValidationError], block: typedRescue },
      { block: fallbackRescue }
    ]);
    expect(resolvedFallback?.name).toBe("fallback-rescue");
  });

  it("keeps work failures non-terminal by default and promotes with failOnError", async () => {
    const queue = createWorkQueue();
    expect(queue.hasPendingWork()).toBe(false);
    queue.addWork(async () => "ok", { name: "success" });
    queue.addWork(async () => {
      throw new Error("background failure");
    }, { name: "failure" });
    expect(queue.hasPendingWork()).toBe(true);

    const result = await queue.waitForWork();
    expect(result.completed).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error.message).toBe("background failure");
    expect(queue.hasPendingWork()).toBe(false);

    const queueFail = createWorkQueue();
    queueFail.addWork(async () => {
      throw new Error("fail on wait");
    });

    await expect(
      queueFail.waitForWork({ failOnError: true })
    ).rejects.toThrow("fail on wait");

    const queueUnknown = createWorkQueue();
    queueUnknown.addWork(async () => {
      throw "unknown";
    });
    const unknownResult = await queueUnknown.waitForWork();
    expect(unknownResult.failed[0]?.name).toBe("work_1");
    expect(unknownResult.failed[0]?.error.message).toBe(
      "Unknown work task failure"
    );
  });

  it("dispatches handler/generator/sequencer/router blocks", async () => {
    const { ctx } = await createRuntimeContext("req_dispatch");

    const handlerBlock = handler<number, number>({
      name: "plus-one",
      execute: (value) => value + 1
    });
    const generatorBlock = generator<string, string>({
      name: "gen",
      model: "mock-model",
      prompt: "say hi"
    });
    const sequencerBlock = sequencer<number>({
      name: "seq"
    }).map((value) => value + 2);

    const routeA = handler<number, string>({
      name: "route-a",
      execute: () => "a"
    });
    const routeB = handler<number, string>({
      name: "route-b",
      execute: () => "b"
    });
    const routerBlock = router<number, string>({
      name: "router",
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

  it("runs request lifecycle observers in canonical order for success and failure", async () => {
    const stores = createInMemoryStores();
    const events: string[] = [];

    const observer = (name: string) =>
      handler<any, void>({
        name,
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
          block: handler<{ value: number }, string>({
            name: "success-action",
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
      stores
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
          block: handler<{ value: number }, string>({
            name: "failure-action",
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
      stores
    });

    expect(failed.error).toBeDefined();
    expect(failed.error).toBeInstanceOf(FlowError);
    expect(failed.items.some((item) => item.type === "fsd:error")).toBe(true);
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
    const block = handler<number, number>({
      name: "seam-handler",
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
    expect(baseline.items.at(-1)?.type).toBe("fsd:block_output");
    expect(withNoopSeams.items.at(-1)?.type).toBe("fsd:block_output");
    expect(withNoopSeams.items.at(-1)).toMatchObject({
      blockName: "seam-handler",
      output: baseline.output
    });
    expect(withNoopSeams.error).toEqual(baseline.error);
  });

  it("allows internal seam interception on normalized block errors", async () => {
    const { ctx } = await createRuntimeContext("req_seam_error");
    const failing = handler<number, number>({
      name: "failing-block",
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
