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

  // FIX-2752 D1: the engine's tick fires every schedule, elected by the store's lease; BullMQ keeps no schedule path of its own.
  it("exports no schedule path of its own", async () => {
    const mod: Record<string, unknown> = await import("../src/index");
    expect(Object.keys(mod).filter((name) => /schedul/i.test(name))).toEqual([]);
    const removed = "@flow-state-dev/bullmq/schedules";
    await expect(import(/* @vite-ignore */ removed)).rejects.toThrow();
  });
});
