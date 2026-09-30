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
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";

vi.mock("@flow-state-dev/engine", () => ({
  runAction: vi.fn(),
  holdLeasePlace: vi.fn(() => ({ stop: vi.fn() })),
  planQueueWait: vi.fn(() => ({ kind: "wait", delayMs: 10 })),
  settleUnstartedRequest: vi.fn().mockResolvedValue(undefined),
  // Matched by NAME in the processor's catch (cross-realm safe), so the mock
  // only has to carry the same name the real class sets.
  OrgRequiredError: class OrgRequiredError extends Error {
    constructor(flowKind: string, seam = "this call") {
      super(`${seam} requires an organization for flow "${flowKind}".`);
      this.name = "OrgRequiredError";
    }
  }
}));

import { holdLeasePlace, runAction, settleUnstartedRequest } from "@flow-state-dev/engine";
import { createFlowJobProcessor, type FlowWorkerDeps } from "../src/worker";
import type { FlowJobData } from "../src/types";

const runActionMock = vi.mocked(runAction);
const holdMock = vi.mocked(holdLeasePlace);
const settleMock = vi.mocked(settleUnstartedRequest);

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
      orgId: DEFAULT_ORG_ID,
      requestId: "req_1"
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides
  } as unknown as Job<FlowJobData>;
}

beforeEach(() => {
  runActionMock.mockReset();
  settleMock.mockClear();
  holdMock.mockClear();
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

describe("createFlowJobProcessor — a job enqueued before organizations were required", () => {
  /**
   * The refusal is correct; where it happened was not. Thrown between the
   * publisher's creation and the `try`, it skipped every terminal path: no
   * error terminal, so a web-side subscriber waited forever; no `close()`, so
   * the publisher leaked; and not an `UnrecoverableError`, so BullMQ retried a
   * job that can never become valid until its attempts ran out.
   *
   * Nothing about such a job changes between attempts — a worker runs below
   * principal resolution and there is no organization to recover — so the only
   * correct outcome is one terminal, one close, and no retry.
   */
  it("fails it terminally instead of retrying it forever", async () => {
    const { bridge, publisher } = makeBridge();

    const job = makeJob({
      data: {
        flowKind: "chat",
        actionName: "send",
        input: {},
        userId: "u1",
        requestId: "req_1"
      }
    });

    await expect(createFlowJobProcessor(makeDeps(bridge))(job)).rejects.toThrow(
      UnrecoverableError
    );

    expect(runActionMock).not.toHaveBeenCalled();
    expect(publisher.publishTerminal).toHaveBeenCalledTimes(1);
    expect(publisher.close).toHaveBeenCalledTimes(1);
  });
});

describe("createFlowJobProcessor — a job that holds a place on a concurrency key", () => {
  const place = { key: "session:s_1", ticket: "t_1" };
  const placeJob = (overrides: Record<string, unknown> = {}) =>
    makeJob({
      data: {
        flowKind: "chat",
        actionName: "send",
        input: {},
        userId: "u1",
        orgId: DEFAULT_ORG_ID,
        requestId: "req_1",
        leasePlace: place
      },
      updateData: vi.fn().mockResolvedValue(undefined),
      ...overrides
    });
  const backendThat = (overrides: Record<string, unknown> = {}) => ({
    take: vi.fn(),
    isMyTurn: vi.fn().mockResolvedValue(true),
    renew: vi.fn().mockResolvedValue(undefined),
    giveBack: vi.fn().mockResolvedValue(undefined),
    ...overrides
  });
  const stores = () => ({
    request: {
      getEvents: vi.fn().mockResolvedValue([]),
      isAbortRequested: vi.fn().mockResolvedValue(false)
    }
  });

  it("settles the request and gives its place back when the turn check fails on the final attempt", async () => {
    // Nothing else will end the request: no run started, so runAction never
    // wrote a terminal record, and BullMQ will not try the job again.
    const { bridge, publisher } = makeBridge();
    const backend = backendThat({ renew: vi.fn().mockRejectedValue(new Error("Connection is closed.")) });
    const processor = createFlowJobProcessor(makeDeps(bridge, { leaseBackend: backend, stores: stores() }));

    await expect(processor(placeJob({ attemptsMade: 2 }))).rejects.toThrow("Connection is closed.");

    expect(runActionMock).not.toHaveBeenCalled();
    expect(settleMock).toHaveBeenCalledWith(expect.anything(), "req_1", {
      status: "failed",
      cause: expect.objectContaining({ message: "Connection is closed." })
    });
    expect(publisher.publishTerminal).toHaveBeenCalledWith({ error: { message: "Connection is closed." } });
    expect(backend.giveBack).toHaveBeenCalledWith(place);
  });

  it("keeps the request open and the place held when the turn check fails with a retry to come", async () => {
    const { bridge, publisher } = makeBridge();
    const backend = backendThat({ renew: vi.fn().mockRejectedValue(new Error("Connection is closed.")) });
    const processor = createFlowJobProcessor(makeDeps(bridge, { leaseBackend: backend, stores: stores() }));

    await expect(processor(placeJob({ attemptsMade: 0 }))).rejects.toThrow("Connection is closed.");

    expect(settleMock).not.toHaveBeenCalled();
    expect(publisher.publishTerminal).not.toHaveBeenCalled();
    expect(backend.giveBack).not.toHaveBeenCalled();
  });

  it("does not fail a run that completed when its place is lost as it finishes", async () => {
    // The loss lands after the run's work is done: nothing is left to stop,
    // and reporting the completed work as interrupted would be the costly way
    // to be wrong.
    const { bridge, publisher } = makeBridge();
    let onLost!: (error: Error) => void;
    const stop = vi.fn();
    holdMock.mockImplementationOnce(((_b: unknown, _p: unknown, lost: (error: Error) => void) => {
      onLost = lost;
      return { stop };
    }) as never);
    runActionMock.mockImplementationOnce(async () => {
      onLost(new Error("lease lost"));
      return { output: "ok" } as never;
    });
    const processor = createFlowJobProcessor(
      makeDeps(bridge, { leaseBackend: backendThat(), stores: stores() })
    );

    const result = await processor(placeJob());

    expect(result).toEqual({ output: "ok" });
    expect(publisher.publishTerminal).toHaveBeenCalledWith({ output: "ok" });
    expect(stop).toHaveBeenCalled();
  });

  it("fails a run its lost place stopped, without a retry", async () => {
    const { bridge } = makeBridge();
    let onLost!: (error: Error) => void;
    holdMock.mockImplementationOnce(((_b: unknown, _p: unknown, lost: (error: Error) => void) => {
      onLost = lost;
      return { stop: vi.fn() };
    }) as never);
    runActionMock.mockImplementationOnce(async () => {
      onLost(new Error("lease lost"));
      return { output: undefined, error: { message: "interrupted" } } as never;
    });
    const processor = createFlowJobProcessor(
      makeDeps(bridge, { leaseBackend: backendThat(), stores: stores() })
    );

    await expect(processor(placeJob())).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
