/**
 * Unit tests for `bullmqJobQueue` — the JobQueueAdapter composition for
 * `createFlowState({ worker })`. The runtime/bridge/runner factories are
 * mocked; these tests pin the composition contract: option threading, mode
 * default, queue exposure, and that the worker side maps the resolved
 * FlowStateRuntime onto JobProcessorDeps verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlowStateRuntime } from "@flow-state-dev/engine/host";

const createdWorker = { close: vi.fn().mockResolvedValue(undefined) };
const fakeQueue = { name: "fsd-flows" };
const fakeRuntime = {
  queue: fakeQueue,
  enqueueAction: vi.fn(),
  createJobProcessor: vi.fn(() => createdWorker),
  close: vi.fn().mockResolvedValue(undefined),
};
const fakeBridge = { createPublisher: vi.fn(), createSubscriber: vi.fn() };
const fakeRunner = { dispatch: vi.fn(), close: vi.fn() };
const fakeLeaseBackend = { leaseMs: 10_000, close: vi.fn().mockResolvedValue(undefined) };

vi.mock("../src/runtime", () => ({
  createBullmqRuntime: vi.fn(() => fakeRuntime),
}));
vi.mock("../src/stream-bridge", () => ({
  createRedisStreamBridge: vi.fn(() => fakeBridge),
}));
vi.mock("../src/runner", () => ({
  createJobQueueRunner: vi.fn(() => fakeRunner),
}));
vi.mock("../src/lease-backend", () => ({
  createRedisLeaseBackend: vi.fn(() => fakeLeaseBackend),
}));

import { createBullmqRuntime } from "../src/runtime";
import { createRedisStreamBridge } from "../src/stream-bridge";
import { createJobQueueRunner } from "../src/runner";
import { createRedisLeaseBackend } from "../src/lease-backend";
import { bullmqJobQueue } from "../src/flowstate-adapter";

const flowStateRuntime = {
  registry: { get: () => undefined },
  stores: { request: {} },
  runtimeConfig: { logger: undefined },
} as unknown as FlowStateRuntime;

beforeEach(() => {
  vi.mocked(createBullmqRuntime).mockClear();
  vi.mocked(createRedisStreamBridge).mockClear();
  vi.mocked(createJobQueueRunner).mockClear();
  vi.mocked(createRedisLeaseBackend).mockClear();
  fakeLeaseBackend.close.mockClear();
  fakeRuntime.createJobProcessor.mockClear();
  fakeRuntime.close.mockClear();
  createdWorker.close.mockClear();
});

describe("bullmqJobQueue", () => {
  it("threads connection/queue/retry options into the runtime and bridge", () => {
    bullmqJobQueue({
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
    const adapter = bullmqJobQueue({ connection: "redis://localhost:6379" });
    expect(adapter.mode).toBe("colocated");
    expect(adapter.queue).toBe(fakeQueue);
    expect(adapter.runtime).toBe(fakeRuntime);
  });

  it("createRunner wires the shared queue, bridge, and retry config", () => {
    const adapter = bullmqJobQueue({
      connection: "redis://localhost:6379",
      retry: { attempts: 2 },
    });
    const runner = adapter.createRunner(flowStateRuntime);

    expect(runner).toBe(fakeRunner);
    expect(createJobQueueRunner).toHaveBeenCalledWith({
      queue: fakeQueue,
      bridge: fakeBridge,
      retryConfig: { attempts: 2 },
    });
  });

  it("startProcessing maps the resolved runtime onto JobProcessorDeps with the shared bridge", async () => {
    const adapter = bullmqJobQueue({
      connection: "redis://localhost:6379",
      concurrency: 7,
      lockDuration: 60_000,
    });
    const handle = adapter.startProcessing(flowStateRuntime);

    expect(fakeRuntime.createJobProcessor).toHaveBeenCalledWith({
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
    const adapter = bullmqJobQueue({ connection: "redis://localhost:6379" });
    await adapter.close?.();
    expect(fakeRuntime.close).toHaveBeenCalledTimes(1);
    expect(fakeLeaseBackend.close).toHaveBeenCalledTimes(1);
  });

  it("supplies the engine a lease backend on the same Redis, reading the shared queue", () => {
    // Without it the engine arbitrates only its own process, so a session's
    // `queue` / `reject` policy would not hold across worker processes.
    const adapter = bullmqJobQueue({
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
      bullmqJobQueue({ connection: "r", mode: "enqueue-only" }).mode
    ).toBe("enqueue-only");
    expect(
      bullmqJobQueue({ connection: "r", mode: "process-only" }).mode
    ).toBe("process-only");
  });
});
