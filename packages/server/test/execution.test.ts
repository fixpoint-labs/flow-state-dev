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
      logger
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
      logger
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

    const rescueBlock = handler({
      name: "rescue",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: () => "ok"
    });
    expect(
      resolveRescueHandler(new Error("x"), [{ when: [ValidationError], block: rescueBlock }])
    ).toBeUndefined();
    expect(resolveRescueHandler(new Error("x"), [])).toBeUndefined();
  });

  it("resolves rescue handlers by typed match then fallback", () => {
    const typedRescue = handler({
      name: "typed-rescue",
      inputSchema: z.any(),
      outputSchema: z.string(),
      execute: () => "typed"
    });
    const fallbackRescue = handler({
      name: "fallback-rescue",
      inputSchema: z.any(),
      outputSchema: z.string(),
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
      .then(validate)
      .then(chat)
      .then(gate);

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
      .then(duplicateA)
      .then(duplicateB)
      .work(worker)
      .then(inspect)
      .waitForWork();

    const outer = sequencer({ name: "outer", inputSchema: z.number() }).then(inner);

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
    expect(dupInstanceId).toMatch(/^dup_/);
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
        expect(target?.instanceId).toMatch(/^dup_/);
        return value;
      }
    });

    const child = sequencer({ name: "child", inputSchema: z.number() })
      .then(sibling)
      .then(inspect);

    const outer = sequencer({ name: "dup", inputSchema: z.number() }).then(child);

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

    const inner = sequencer({ name: "dup", inputSchema: z.number() }).then(duplicateLeaf);
    const outer = sequencer({ name: "dup", inputSchema: z.number() }).then(inner);

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
    }).then(inspect);

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
    }).then(leaf);

    const outer = sequencer({
      name: "outer",
      inputSchema: z.number(),
      stateSchema: z.object({ count: z.number().default(7) })
    }).then(inner);

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
    }).then(chat);

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
      stores
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
    expect(baseline.items.at(-1)?.type).toBe("block_output");
    expect(withNoopSeams.items.at(-1)?.type).toBe("block_output");
    expect(withNoopSeams.items.at(-1)).toMatchObject({
      blockName: "seam-handler",
      output: baseline.output
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
