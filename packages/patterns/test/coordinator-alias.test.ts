/**
 * Smoke tests for the coordinator() deprecation-warning alias.
 *
 * Verifies:
 * 1. coordinator(config) returns the same shape as parallelTasks(config).
 * 2. First call with a given name emits console.warn exactly once.
 * 3. Second call with the same name does NOT emit another warning.
 * 4. Call with a different name emits its own one-time warning.
 * 5. __resetCoordinatorWarnings() clears the set so warnings re-fire.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { coordinator, __resetCoordinatorWarnings } from "../src/coordinator";
import { parallelTasks } from "../src/parallelTasks";

const dummyWorker = handler({
  name: "dummy-worker",
  inputSchema: z.any(),
  outputSchema: z.any(),
  execute: () => null,
});

beforeEach(() => {
  __resetCoordinatorWarnings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("coordinator() deprecation alias", () => {
  it("returns a sequencer with the same name and kind as parallelTasks()", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const coord = coordinator({ name: "alias-shape-test", worker: dummyWorker });
    const pt = parallelTasks({ name: "alias-shape-test", worker: dummyWorker });
    expect(coord.kind).toBe(pt.kind);
    expect(coord.name).toBe(pt.name);
    warnSpy.mockRestore();
  });

  it("emits a deprecation warning on the first call with a given name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    coordinator({ name: "warn-once-A", worker: dummyWorker });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("coordinator() is deprecated");
    expect(warnSpy.mock.calls[0][0]).toContain("parallelTasks()");
  });

  it("does NOT emit a second warning for the same name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    coordinator({ name: "warn-once-B", worker: dummyWorker });
    coordinator({ name: "warn-once-B", worker: dummyWorker });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("emits a separate one-time warning for each distinct name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    coordinator({ name: "name-X", worker: dummyWorker });
    coordinator({ name: "name-Y", worker: dummyWorker });
    coordinator({ name: "name-X", worker: dummyWorker }); // duplicate — no extra warning
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("__resetCoordinatorWarnings() allows warnings to re-fire", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    coordinator({ name: "reset-test", worker: dummyWorker });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    __resetCoordinatorWarnings();

    coordinator({ name: "reset-test", worker: dummyWorker });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
