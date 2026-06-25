/**
 * Unit tests for the flow-job processor: terminal-publish semantics across
 * BullMQ retry attempts, and event-sequence resumption when a retry re-runs
 * an action under the same requestId.
 *
 * `runAction` is mocked — these tests pin the processor's mapping between
 * execution results and BullMQ retry/terminal behavior, not flow execution.
 * BullMQ semantics under test: inside a processor `job.attemptsMade` counts
 * *completed* attempts (incremented after moveToCompleted/moveToFailed), so
 * the final attempt is `attemptsMade + 1 >= opts.attempts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";

vi.mock("@flow-state-dev/engine", () => ({
  runAction: vi.fn()
}));

import { runAction } from "@flow-state-dev/engine";
import { createFlowJobProcessor, type FlowWorkerDeps } from "../src/worker";
import type { FlowJobData } from "../src/types";

const runActionMock = vi.mocked(runAction);

function makeBridge() {
  const publisher = {
    publishEvent: vi.fn().mockResolvedValue(undefined),
    publishTerminal: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const bridge = {
    createPublisher: vi.fn(() => publisher),
    createSubscriber: vi.fn()
  };
  return { bridge, publisher };
}

function makeDeps(bridge?: unknown, overrides: Record<string, unknown> = {}): FlowWorkerDeps {
  return {
    registry: { get: vi.fn(() => ({ kind: "chat", actions: {} })) },
    stores: { request: { getEvents: vi.fn().mockResolvedValue([]) } },
    runtimeConfig: {},
    bridge,
    ...overrides
  } as unknown as FlowWorkerDeps;
}

function makeJob(overrides: Record<string, unknown> = {}): Job<FlowJobData> {
  return {
    id: "job_1",
    data: {
      flowKind: "chat",
      actionName: "send",
      input: {},
      userId: "u1",
      requestId: "req_1"
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides
  } as unknown as Job<FlowJobData>;
}

beforeEach(() => {
  runActionMock.mockReset();
});

describe("createFlowJobProcessor — terminal publish semantics", () => {
  it("publishes the result terminal once on success", async () => {
    const { bridge, publisher } = makeBridge();
    runActionMock.mockResolvedValue({ output: "ok" } as never);

    const result = await createFlowJobProcessor(makeDeps(bridge))(makeJob());

    expect(result).toEqual({ output: "ok" });
    expect(publisher.publishTerminal).toHaveBeenCalledTimes(1);
    expect(publisher.publishTerminal).toHaveBeenCalledWith({ output: "ok" });
    expect(publisher.close).toHaveBeenCalledTimes(1);
  });

  it("skips terminal publish for a retryable error on a non-final attempt", async () => {
    const { bridge, publisher } = makeBridge();
    runActionMock.mockResolvedValue({
      error: { message: "boom", retryable: true }
    } as never);

    await expect(
      createFlowJobProcessor(makeDeps(bridge))(makeJob({ attemptsMade: 0 }))
    ).rejects.toThrow("boom");

    expect(publisher.publishTerminal).not.toHaveBeenCalled();
    expect(publisher.close).toHaveBeenCalledTimes(1);
  });

  it("publishes the error terminal on the final attempt of a retryable error", async () => {
    const { bridge, publisher } = makeBridge();
    runActionMock.mockResolvedValue({
      error: { message: "boom", retryable: true }
    } as never);

    await expect(
      createFlowJobProcessor(makeDeps(bridge))(makeJob({ attemptsMade: 2 }))
    ).rejects.toThrow("boom");

    expect(publisher.publishTerminal).toHaveBeenCalledTimes(1);
    expect(publisher.publishTerminal).toHaveBeenCalledWith({
      error: { message: "boom" }
    });
  });

  it("publishes the full result terminal for a non-retryable error on any attempt", async () => {
    const { bridge, publisher } = makeBridge();
    const result = { error: { message: "bad input", retryable: false } };
    runActionMock.mockResolvedValue(result as never);

    await expect(
      createFlowJobProcessor(makeDeps(bridge))(makeJob({ attemptsMade: 0 }))
    ).rejects.toThrow(UnrecoverableError);

    expect(publisher.publishTerminal).toHaveBeenCalledTimes(1);
    expect(publisher.publishTerminal).toHaveBeenCalledWith(result);
  });

  it("skips terminal publish when runAction throws on a non-final attempt", async () => {
    const { bridge, publisher } = makeBridge();
    runActionMock.mockRejectedValue(new Error("redis blip"));

    await expect(
      createFlowJobProcessor(makeDeps(bridge))(makeJob({ attemptsMade: 1 }))
    ).rejects.toThrow("redis blip");

    expect(publisher.publishTerminal).not.toHaveBeenCalled();
    expect(publisher.close).toHaveBeenCalledTimes(1);
  });

  it("publishes the error terminal when runAction throws on the final attempt", async () => {
    const { bridge, publisher } = makeBridge();
    runActionMock.mockRejectedValue(new Error("redis blip"));

    await expect(
      createFlowJobProcessor(makeDeps(bridge))(makeJob({ attemptsMade: 2 }))
    ).rejects.toThrow("redis blip");

    expect(publisher.publishTerminal).toHaveBeenCalledTimes(1);
    expect(publisher.publishTerminal).toHaveBeenCalledWith({
      error: { message: "redis blip" }
    });
  });

  it("throws UnrecoverableError for an unknown flow without creating a publisher", async () => {
    const { bridge } = makeBridge();
    const deps = makeDeps(bridge, {
      registry: { get: vi.fn(() => undefined) }
    });

    await expect(createFlowJobProcessor(deps)(makeJob())).rejects.toThrow(
      UnrecoverableError
    );
    expect(bridge.createPublisher).not.toHaveBeenCalled();
  });
});

describe("createFlowJobProcessor — event sequence resumption", () => {
  it("resumes numbering past the last persisted event on a retry attempt", async () => {
    const deps = makeDeps(undefined, {
      stores: {
        request: {
          getEvents: vi
            .fn()
            .mockResolvedValue([{ sequence_number: 3 }, { sequence_number: 7 }])
        }
      }
    });
    runActionMock.mockResolvedValue({ output: "ok" } as never);

    await createFlowJobProcessor(deps)(makeJob({ attemptsMade: 1 }));

    expect(
      (deps.stores as unknown as { request: { getEvents: ReturnType<typeof vi.fn> } })
        .request.getEvents
    ).toHaveBeenCalledWith("req_1");
    expect(runActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSequenceNumber: 7 })
    );
  });

  it("starts fresh numbering on the first attempt without reading the store", async () => {
    const deps = makeDeps();
    runActionMock.mockResolvedValue({ output: "ok" } as never);

    await createFlowJobProcessor(deps)(makeJob({ attemptsMade: 0 }));

    expect(
      (deps.stores as unknown as { request: { getEvents: ReturnType<typeof vi.fn> } })
        .request.getEvents
    ).not.toHaveBeenCalled();
    expect(runActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSequenceNumber: undefined })
    );
  });

  it("falls back to fresh numbering when the prior-events read fails", async () => {
    const deps = makeDeps(undefined, {
      stores: {
        request: { getEvents: vi.fn().mockRejectedValue(new Error("store down")) }
      }
    });
    runActionMock.mockResolvedValue({ output: "ok" } as never);

    await createFlowJobProcessor(deps)(makeJob({ attemptsMade: 2 }));

    expect(runActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ startSequenceNumber: undefined })
    );
  });
});
