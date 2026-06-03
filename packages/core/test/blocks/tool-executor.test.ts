import { describe, expect, it, vi } from "vitest";
import {
  buildToolExecutor,
  runToolObserver,
  runWithRetry,
  type ToolExecutorConfig,
} from "../../src/blocks/internal/tool-executor";
import type { BlockContext } from "../../src/types/block";
import { createMockContext } from "../helpers";

function makeTool(overrides: {
  name?: string;
  run?: (args: unknown, ctx: BlockContext) => Promise<unknown>;
  cacheable?: unknown;
} = {}) {
  const runFn = overrides.run ?? (async (args: unknown) => ({ result: args }));
  return {
    name: overrides.name ?? "test-tool",
    kind: "handler" as const,
    description: "a test tool",
    inputSchema: {},
    config: {
      cacheable: overrides.cacheable,
    },
    run: runFn,
    _substrate: { run: runFn },
  } as any;
}

function makeConfig(overrides?: Partial<ToolExecutorConfig>): ToolExecutorConfig {
  return {
    flowTools: undefined,
    generatorBlockName: "gen",
    itemVisibility: undefined,
    agentName: undefined,
    statusGuard: { active: 0, saved: "" },
    ...overrides,
  };
}

describe("buildToolExecutor", () => {
  it("calls tool.run with args and returns the output", async () => {
    const runSpy = vi.fn(async (args: unknown) => ({ echoed: args }));
    const tool = makeTool({ run: runSpy });
    const ctx = createMockContext();
    const execute = buildToolExecutor(tool, makeConfig(), ctx);

    const result = await execute({ input: "hello" });
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ echoed: { input: "hello" } });
  });

  it("restores status guard after tool completes", async () => {
    const statusGuard = { active: 0, saved: "" };
    const tool = makeTool();
    const ctx = createMockContext({
      _peekStatus: () => "previous status",
    });
    const execute = buildToolExecutor(tool, makeConfig({ statusGuard }), ctx);

    await execute({ x: 1 });
    expect(statusGuard.active).toBe(0);
  });

  it("restores status guard after tool throws", async () => {
    const statusGuard = { active: 0, saved: "" };
    const tool = makeTool({
      run: async () => { throw new Error("boom"); },
    });
    const ctx = createMockContext({
      _peekStatus: () => "saved",
    });
    const execute = buildToolExecutor(tool, makeConfig({ statusGuard }), ctx);

    await expect(execute({})).rejects.toThrow("boom");
    expect(statusGuard.active).toBe(0);
  });

  it("fires onToolStarted and onToolCompleted observers", async () => {
    const events: string[] = [];
    const flowTools = {
      onToolStarted: async (event: any) => { events.push(`started:${event.toolName}`); },
      onToolCompleted: async (event: any) => { events.push(`completed:${event.toolName}`); },
    } as any;
    const tool = makeTool({ name: "obs-tool" });
    const ctx = createMockContext();
    const execute = buildToolExecutor(
      tool,
      makeConfig({ flowTools }),
      ctx,
    );

    await execute({ val: 1 });
    expect(events).toEqual(["started:obs-tool", "completed:obs-tool"]);
  });

  it("fires onToolErrored before the error propagates", async () => {
    const events: string[] = [];
    const flowTools = {
      onToolStarted: async () => { events.push("started"); },
      onToolErrored: async (event: any) => { events.push(`errored:${event.error.message}`); },
    } as any;
    const tool = makeTool({
      name: "err-tool",
      run: async () => { throw new Error("fail"); },
    });
    const ctx = createMockContext();
    const execute = buildToolExecutor(
      tool,
      makeConfig({ flowTools }),
      ctx,
    );

    await expect(execute({})).rejects.toThrow("fail");
    expect(events).toContain("errored:fail");
    expect(events.indexOf("errored:fail")).toBeGreaterThan(events.indexOf("started"));
  });

  it("runs without toolCallId (no envelope path)", async () => {
    const tool = makeTool({ run: async () => "direct" });
    const ctx = createMockContext();
    const execute = buildToolExecutor(tool, makeConfig(), ctx);

    const result = await execute({ a: 1 });
    expect(result).toBe("direct");
  });
});

describe("runWithRetry", () => {
  it("returns immediately without retry policy", async () => {
    const result = await runWithRetry(async () => 42, undefined);
    expect(result).toBe(42);
  });

  it("retries on failure and succeeds", async () => {
    let attempt = 0;
    const result = await runWithRetry(
      async () => {
        attempt++;
        if (attempt < 2) throw new Error("transient");
        return "ok";
      },
      { maxAttempts: 3, baseDelayMs: 0 },
    );
    expect(result).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("exhausts retries and throws", async () => {
    await expect(
      runWithRetry(
        async () => { throw new Error("permanent"); },
        { maxAttempts: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow("permanent");
  });

  it("respects retryableErrors filter", async () => {
    class RetryableError extends Error {}
    let attempt = 0;
    await expect(
      runWithRetry(
        async () => {
          attempt++;
          if (attempt === 1) throw new Error("not retryable");
          return "ok";
        },
        { maxAttempts: 3, baseDelayMs: 0, retryableErrors: [RetryableError] },
      ),
    ).rejects.toThrow("not retryable");
    expect(attempt).toBe(1);
  });
});

describe("runToolObserver", () => {
  it("does nothing when observer is undefined", async () => {
    await runToolObserver(undefined, { toolName: "x", input: {} }, createMockContext());
  });

  it("calls function observers", async () => {
    const spy = vi.fn();
    await runToolObserver(spy, { toolName: "x", input: {} }, createMockContext());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("dispatches block observers through asRuntime.run", async () => {
    const runSpy = vi.fn();
    const blockObserver = {
      run: runSpy,
      _substrate: { run: runSpy },
    } as any;
    await runToolObserver(blockObserver, { toolName: "x", input: {} }, createMockContext());
    expect(runSpy).toHaveBeenCalledTimes(1);
  });
});
