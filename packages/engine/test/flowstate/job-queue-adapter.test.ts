/**
 * Tests for the `jobQueue` option on `createFlowState` — the job queue
 * adapter seam. The contract under test: the adapter's enqueue side and
 * processing side both receive the SAME resolved runtime the router uses (the
 * store-identity invariant), mode controls which sides run, the adapter's
 * runner is installed on the router, and dispose() closes the processing side
 * before store adapters.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { CreateFlowApiRouterOptions } from "../../src/routes/createFlowApiRouter";
import type {
  FlowStateRuntime,
  JobQueueAdapter,
  JobQueueMode
} from "../../src/flowstate/types";
import type { FlowRunner } from "../../src/transports/runner";

const routerCalls: CreateFlowApiRouterOptions[] = [];

vi.mock("../../src/routes/createFlowApiRouter", async (importActual) => {
  const actual =
    await importActual<typeof import("../../src/routes/createFlowApiRouter")>();
  return {
    ...actual,
    createFlowApiRouter: (options: CreateFlowApiRouterOptions) => {
      routerCalls.push(options);
      return actual.createFlowApiRouter(options);
    }
  };
});

const { createFlowState, inMemoryStores } = await import("../../src");
const { FlowStateConfigError } = await import("../../src/errors/flow-error");

const noopFlow = defineFlow({
  kind: "noop-flow",
  actions: {
    ping: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined
      })
  }
})();

const stubModelResolver = (() => undefined) as never;

/** Records every adapter interaction so tests can assert the lifecycle. */
function makeFakeAdapter(mode?: JobQueueMode) {
  const calls = {
    runnerRuntimes: [] as FlowStateRuntime[],
    processingRuntimes: [] as FlowStateRuntime[],
    processingClosed: 0,
    adapterClosed: 0
  };
  const runner: FlowRunner = {
    dispatch: vi.fn(async (envelope) => ({
      requestId: envelope.requestId,
      finished: Promise.resolve({ output: undefined, items: [], durationMs: 0 }),
      abort: () => {}
    })),
    close: async () => {}
  };
  const adapter: JobQueueAdapter = {
    mode,
    createRunner(runtime) {
      calls.runnerRuntimes.push(runtime);
      return runner;
    },
    startProcessing(runtime) {
      calls.processingRuntimes.push(runtime);
      return {
        close: async () => {
          calls.processingClosed += 1;
        }
      };
    },
    close: async () => {
      calls.adapterClosed += 1;
    }
  };
  return { adapter, runner, calls };
}

function makeFlowState(adapter: JobQueueAdapter) {
  return createFlowState({
    flows: [noopFlow],
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: stubModelResolver,
    jobQueue: adapter
  });
}

afterEach(() => {
  routerCalls.length = 0;
});

describe("createFlowState — job queue adapter", () => {
  it("colocated (default): wires runner and processing side against the same runtime the router uses", async () => {
    const { adapter, runner, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.runnerRuntimes).toHaveLength(1);
    expect(calls.processingRuntimes).toHaveLength(1);

    // Store-identity invariant: enqueue side, processing side, and the public
    // runtime all see the same instances.
    const runtime = await fs.getRuntime();
    expect(calls.runnerRuntimes[0]?.stores).toBe(runtime.stores);
    expect(calls.processingRuntimes[0]?.stores).toBe(runtime.stores);
    expect(calls.processingRuntimes[0]?.registry).toBe(runtime.registry);
    expect(calls.processingRuntimes[0]?.runtimeConfig).toBe(runtime.runtimeConfig);

    // The adapter's runner reaches the router.
    expect(routerCalls[0]?.runner).toBe(runner);

    await fs.dispose();
  });

  it("enqueue-only: installs the runner, never starts processing", async () => {
    const { adapter, runner, calls } = makeFakeAdapter("enqueue-only");
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.runnerRuntimes).toHaveLength(1);
    expect(calls.processingRuntimes).toHaveLength(0);
    expect(routerCalls[0]?.runner).toBe(runner);

    await fs.dispose();
  });

  it("process-only: starts processing, installs no runner", async () => {
    const { adapter, calls } = makeFakeAdapter("process-only");
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.runnerRuntimes).toHaveLength(0);
    expect(calls.processingRuntimes).toHaveLength(1);
    expect(routerCalls[0]?.runner).toBeUndefined();

    await fs.dispose();
  });

  it("starts processing via getRuntime() too, not only via ready()", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.getRuntime();

    expect(calls.processingRuntimes).toHaveLength(1);
    await fs.dispose();
  });

  it("wires the adapter exactly once across ready() + getRuntime() + getRouter()", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await Promise.all([fs.ready(), fs.getRuntime(), fs.getRouter()]);
    await fs.ready();

    expect(calls.runnerRuntimes).toHaveLength(1);
    expect(calls.processingRuntimes).toHaveLength(1);
    await fs.dispose();
  });

  it("dispose() closes the processing handle and the adapter", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.ready();
    await fs.dispose();

    expect(calls.processingClosed).toBe(1);
    expect(calls.adapterClosed).toBe(1);

    // Idempotent: a second dispose() is a no-op.
    await fs.dispose();
    expect(calls.processingClosed).toBe(1);
    expect(calls.adapterClosed).toBe(1);
  });

  it("dispose() without init never starts (or closes) anything", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.dispose();

    expect(calls.processingRuntimes).toHaveLength(0);
    expect(calls.processingClosed).toBe(0);
    // Adapter close still runs so backends constructed eagerly (queues,
    // connections) are released even when the runtime never resolved.
    expect(calls.adapterClosed).toBe(1);
  });

  it("rejects jobQueue + runner together at construction", () => {
    const { adapter, runner } = makeFakeAdapter();
    expect(() =>
      createFlowState({
        flows: [noopFlow],
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: stubModelResolver,
        jobQueue: adapter,
        runner
      })
    ).toThrow(FlowStateConfigError);
  });

  // An old config still passing `dispatcher` would otherwise run its queued work in process.
  it("refuses the old `dispatcher` option by name, pointing at runner", () => {
    const { runner } = makeFakeAdapter();
    expect(() =>
      createFlowState({
        flows: [noopFlow],
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: stubModelResolver,
        dispatcher: runner
      } as never)
    ).toThrow(/createFlowState: the `dispatcher` option is now `runner`/);
  });

  // An old config still passing `worker` would otherwise run its queued work in process.
  it("refuses the old `worker` option by name, pointing at jobQueue", () => {
    const { adapter } = makeFakeAdapter();
    expect(() =>
      createFlowState({
        flows: [noopFlow],
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: stubModelResolver,
        worker: adapter
      } as never)
    ).toThrow(/createFlowState: the `worker` option is now `jobQueue`/);
  });

  // An unknown mode would otherwise both enqueue and process: a web process
  // configured to only enqueue would start consuming the queue.
  it("refuses a mode it does not know, naming the three it does", () => {
    const { adapter } = makeFakeAdapter();
    expect(() => makeFlowState({ ...adapter, mode: "enqueue-and-process" as never })).toThrow(
      /unknown job queue mode "enqueue-and-process"\. Use one of "colocated", "enqueue-only", "process-only"/
    );
  });
});
