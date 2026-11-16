/**
 * Verifies the package barrel exports resolve correctly.
 */
import { describe, it, expect } from "vitest";

describe("@flow-state-dev/bullmq exports", () => {
  it("exports connection helpers", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.resolveProducerConnection).toBe("function");
    expect(typeof mod.resolveProcessorConnection).toBe("function");
  });

  it("exports retry helpers", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.toJobOptions).toBe("function");
    expect(typeof mod.resolveDlqName).toBe("function");
  });

  it("exports runtime factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createBullmqRuntime).toBe("function");
  });

  it("exports the job processor factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createJobProcessor).toBe("function");
  });

  it("exports the flowstate job queue adapter factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.bullmqJobQueue).toBe("function");
  });

  it("exports the flow runner factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createJobQueueRunner).toBe("function");
  });

  it("exports stream bridge factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createRedisStreamBridge).toBe("function");
  });

  it("exports schedule index factory", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.createBullmqScheduleIndex).toBe("function");
  });
});
