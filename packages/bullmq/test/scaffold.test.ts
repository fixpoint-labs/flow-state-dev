/**
 * Placeholder test — verifies the package scaffold exports resolve.
 * Real tests arrive alongside the runtime/worker/scheduler implementations.
 */
import { describe, it, expect } from "vitest";

describe("@flow-state-dev/bullmq scaffold", () => {
  it("exports connection helpers", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.resolveProducerConnection).toBe("function");
    expect(typeof mod.resolveWorkerConnection).toBe("function");
  });

  it("exports retry helpers", async () => {
    const mod = await import("../src/index");
    expect(typeof mod.toJobOptions).toBe("function");
    expect(typeof mod.resolveDlqName).toBe("function");
  });
});
