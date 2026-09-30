/**
 * Unit tests for `bullmqWorker` — the WorkerAdapter composition for
 * `createFlowState({ worker })`. The runtime/bridge/dispatcher factories are
 * mocked; these tests pin the composition contract: option threading, mode
 * default, queue exposure, and that the worker side maps the resolved
 * FlowStateRuntime onto FlowWorkerDeps verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowStateRuntime } from "@flow-state-dev/engine";

const createdWorker = { close: vi.fn().mockResolvedValue(undefined) };
const fakeQueue = { name: "fsd-flows" };
const fakeRuntime = {
  queue: fakeQueue,
  enqueueAction: vi.fn(),
  createWorker: vi.fn(() => createdWorker),
  close: vi.fn().mockResolvedValue(undefined),
};
const fakeBridge = { createPublisher: vi.fn(), createSubscriber: vi.fn() };
const fakeDispatcher = { dispatch: vi.fn(), close: vi.fn() };
const fakeLeaseBackend = { leaseMs: 10_000, close: vi.fn().mockResolvedValue(undefined) };

vi.mock("../src/runtime", () => ({
  createBullmqRuntime: vi.fn(() => fakeRuntime),
}));
vi.mock("../src/stream-bridge", () => ({
  createRedisStreamBridge: vi.fn(() => fakeBridge),
}));
vi.mock("../src/dispatcher", () => ({
  createWorkerDispatcher: vi.fn(() => fakeDispatcher),
}));
vi.mock("../src/lease-backend", () => ({
  createRedisLeaseBackend: vi.fn(() => fakeLeaseBackend),
}));

import { createBullmqRuntime } from "../src/runtime";
import { createRedisStreamBridge } from "../src/stream-bridge";
import { createWorkerDispatcher } from "../src/dispatcher";
import { createRedisLeaseBackend } from "../src/lease-backend";
import { bullmqWorker } from "../src/flowstate-adapter";

const flowStateRuntime = {
  registry: { get: () => undefined },
  stores: { request: {} },
  runtimeConfig: { logger: undefined },
} as unknown as FlowStateRuntime;

beforeEach(() => {
  vi.mocked(createBullmqRuntime).mockClear();
  vi.mocked(createRedisStreamBridge).mockClear();
  vi.mocked(createWorkerDispatcher).mockClear();
  vi.mocked(createRedisLeaseBackend).mockClear();
  fakeLeaseBackend.close.mockClear();
  fakeRuntime.createWorker.mockClear();
  fakeRuntime.close.mockClear();
  createdWorker.close.mockClear();
});

describe("bullmqWorker", () => {
  it("threads connection/queue/retry options into the runtime and bridge", () => {
    bullmqWorker({
      connection: "redis://localhost:6379",
      prefix: "app",
      queueName: "jobs",
      retry: { attempts: 5 },
      channelPrefix: "app:stream",
    });

    expect(createBullmqRuntime).toHaveBeenCalledWith({
      connection: "redis://localhost:6379",
      prefix: "app",
      queueName: "jobs",
      retry: { attempts: 5 },
    });
    expect(createRedisStreamBridge).toHaveBeenCalledWith({
      connection: "redis://localhost:6379",
      channelPrefix: "app:stream",
    });
  });

  it("defaults mode to colocated and exposes the queue and runtime", () => {
    const adapter = bullmqWorker({ connection: "redis://localhost:6379" });
    expect(adapter.mode).toBe("colocated");
    expect(adapter.queue).toBe(fakeQueue);
    expect(adapter.runtime).toBe(fakeRuntime);
  });

  it("createDispatcher wires the shared queue, bridge, and retry config", () => {
    const adapter = bullmqWorker({
      connection: "redis://localhost:6379",
      retry: { attempts: 2 },
    });
    const dispatcher = adapter.createDispatcher(flowStateRuntime);

    expect(dispatcher).toBe(fakeDispatcher);
    expect(createWorkerDispatcher).toHaveBeenCalledWith({
      queue: fakeQueue,
      bridge: fakeBridge,
      retryConfig: { attempts: 2 },
    });
  });

  it("startWorker maps the resolved runtime onto FlowWorkerDeps with the shared bridge", async () => {
    const adapter = bullmqWorker({
      connection: "redis://localhost:6379",
      concurrency: 7,
      lockDuration: 60_000,
    });
    const handle = adapter.startWorker(flowStateRuntime);

    expect(fakeRuntime.createWorker).toHaveBeenCalledWith({
      registry: flowStateRuntime.registry,
      stores: flowStateRuntime.stores,
      runtimeConfig: flowStateRuntime.runtimeConfig,
      bridge: fakeBridge,
      concurrency: 7,
      lockDuration: 60_000,
      leaseBackend: fakeLeaseBackend,
    });

    await handle.close();
    expect(createdWorker.close).toHaveBeenCalledTimes(1);
  });

  it("close delegates to the runtime (queue + workers) and closes the lease backend", async () => {
    const adapter = bullmqWorker({ connection: "redis://localhost:6379" });
    await adapter.close?.();
    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
    expect(fakeLeaseBackend.close).toHaveBeenCalledTimes(1);
  });

  it("supplies the engine a lease backend on the same Redis, reading the shared queue", () => {
    // Without it the engine arbitrates only its own process, so a session's
    // `queue` / `reject` policy would not hold across worker processes.
    const adapter = bullmqWorker({
      connection: "redis://localhost:6379",
      prefix: "app",
      leaseMs: 4_000,
    });
    expect(adapter.leaseBackend).toBe(fakeLeaseBackend);
    expect(createRedisLeaseBackend).toHaveBeenCalledWith({
      connection: "redis://localhost:6379",
      prefix: "app",
      queue: fakeQueue,
      leaseMs: 4_000,
    });
  });

  it("honors an explicit mode", () => {
    expect(
      bullmqWorker({ connection: "r", mode: "dispatch-only" }).mode
    ).toBe("dispatch-only");
    expect(
      bullmqWorker({ connection: "r", mode: "worker-only" }).mode
    ).toBe("worker-only");
  });
});
