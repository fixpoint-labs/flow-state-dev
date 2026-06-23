/**
 * Tests for the `worker` option on `createFlowState` — the execution-backend
 * adapter seam. The contract under test: the adapter's dispatch side and
 * worker side both receive the SAME resolved runtime the router uses (the
 * store-identity invariant), mode controls which sides run, the adapter's
 * dispatcher is installed on the router, and dispose() closes the worker
 * before store adapters.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { CreateFlowApiRouterOptions } from "../../src/routes/createFlowApiRouter";
import type {
  FlowStateRuntime,
  WorkerAdapter,
  WorkerMode
} from "../../src/flowstate/types";
import type { FlowDispatcher } from "../../src/transports/dispatcher";

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
    ping: {
      inputSchema: z.object({}).passthrough(),
      block: handler({
        name: "ping",
        inputSchema: z.object({}).passthrough(),
        execute: () => undefined
      })
    }
  }
})();

const stubModelResolver = (() => undefined) as never;

/** Records every adapter interaction so tests can assert the lifecycle. */
function makeFakeAdapter(mode?: WorkerMode) {
  const calls = {
    dispatcherRuntimes: [] as FlowStateRuntime[],
    workerRuntimes: [] as FlowStateRuntime[],
    workerClosed: 0,
    adapterClosed: 0
  };
  const dispatcher: FlowDispatcher = {
    dispatch: vi.fn(async (envelope) => ({
      requestId: envelope.requestId,
      finished: Promise.resolve({}),
      abort: () => {}
    })),
    close: async () => {}
  };
  const adapter: WorkerAdapter = {
    mode,
    createDispatcher(runtime) {
      calls.dispatcherRuntimes.push(runtime);
      return dispatcher;
    },
    startWorker(runtime) {
      calls.workerRuntimes.push(runtime);
      return {
        close: async () => {
          calls.workerClosed += 1;
        }
      };
    },
    close: async () => {
      calls.adapterClosed += 1;
    }
  };
  return { adapter, dispatcher, calls };
}

function makeFlowState(adapter: WorkerAdapter) {
  return createFlowState({
    flows: { noop: noopFlow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: stubModelResolver,
    worker: adapter
  });
}

afterEach(() => {
  routerCalls.length = 0;
});

describe("createFlowState — worker adapter", () => {
  it("colocated (default): wires dispatcher and worker against the same runtime the router uses", async () => {
    const { adapter, dispatcher, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.dispatcherRuntimes).toHaveLength(1);
    expect(calls.workerRuntimes).toHaveLength(1);

    // Store-identity invariant: dispatch side, worker side, and the public
    // runtime all see the same instances.
    const runtime = await fs.getRuntime();
    expect(calls.dispatcherRuntimes[0]?.stores).toBe(runtime.stores);
    expect(calls.workerRuntimes[0]?.stores).toBe(runtime.stores);
    expect(calls.workerRuntimes[0]?.registry).toBe(runtime.registry);
    expect(calls.workerRuntimes[0]?.runtimeConfig).toBe(runtime.runtimeConfig);

    // The adapter's dispatcher reaches the router.
    expect(routerCalls[0]?.dispatcher).toBe(dispatcher);

    await fs.dispose();
  });

  it("dispatch-only: installs the dispatcher, never starts a worker", async () => {
    const { adapter, dispatcher, calls } = makeFakeAdapter("dispatch-only");
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.dispatcherRuntimes).toHaveLength(1);
    expect(calls.workerRuntimes).toHaveLength(0);
    expect(routerCalls[0]?.dispatcher).toBe(dispatcher);

    await fs.dispose();
  });

  it("worker-only: starts the worker, installs no dispatcher", async () => {
    const { adapter, calls } = makeFakeAdapter("worker-only");
    const fs = makeFlowState(adapter);
    await fs.ready();

    expect(calls.dispatcherRuntimes).toHaveLength(0);
    expect(calls.workerRuntimes).toHaveLength(1);
    expect(routerCalls[0]?.dispatcher).toBeUndefined();

    await fs.dispose();
  });

  it("starts the worker via getRuntime() too, not only via ready()", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.getRuntime();

    expect(calls.workerRuntimes).toHaveLength(1);
    await fs.dispose();
  });

  it("wires the adapter exactly once across ready() + getRuntime() + getRouter()", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await Promise.all([fs.ready(), fs.getRuntime(), fs.getRouter()]);
    await fs.ready();

    expect(calls.dispatcherRuntimes).toHaveLength(1);
    expect(calls.workerRuntimes).toHaveLength(1);
    await fs.dispose();
  });

  it("dispose() closes the worker handle and the adapter", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.ready();
    await fs.dispose();

    expect(calls.workerClosed).toBe(1);
    expect(calls.adapterClosed).toBe(1);

    // Idempotent: a second dispose() is a no-op.
    await fs.dispose();
    expect(calls.workerClosed).toBe(1);
    expect(calls.adapterClosed).toBe(1);
  });

  it("dispose() without init never starts (or closes) anything", async () => {
    const { adapter, calls } = makeFakeAdapter();
    const fs = makeFlowState(adapter);
    await fs.dispose();

    expect(calls.workerRuntimes).toHaveLength(0);
    expect(calls.workerClosed).toBe(0);
    // Adapter close still runs so backends constructed eagerly (queues,
    // connections) are released even when the runtime never resolved.
    expect(calls.adapterClosed).toBe(1);
  });

  it("rejects worker + dispatcher together at construction", () => {
    const { adapter, dispatcher } = makeFakeAdapter();
    expect(() =>
      createFlowState({
        flows: { noop: noopFlow },
        stores: { default: { primary: inMemoryStores() } },
        modelResolver: stubModelResolver,
        worker: adapter,
        dispatcher
      })
    ).toThrow(FlowStateConfigError);
  });
});
