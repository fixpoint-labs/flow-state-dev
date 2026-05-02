import { describe, expect, it } from "vitest";
import { handler, router } from "../src";
import { createMockContext, runForTest } from "./helpers";
describe("router builder", () => {
  it("executes selected route", async () => {
    const low = handler({
      name: "low",
      execute: () => "low"
    });
    const high = handler({
      name: "high",
      execute: () => "high"
    });

    const block = router({
      name: "route",
      routes: [low, high],
      execute: (value) => (value < 10 ? low : high)
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 3, ctx)).resolves.toBe("low");
    await expect(runForTest(block, 20, ctx)).resolves.toBe("high");
  });

  it("throws when selected route is not in declared candidates", async () => {
    const inRoutes = handler({
      name: "in-routes",
      execute: () => "ok"
    });
    const rogue = handler({
      name: "rogue",
      execute: () => "rogue"
    });

    const block = router({
      name: "route-validation",
      routes: [inRoutes],
      execute: () => rogue
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("invalid route");
  });

  it("uses validateRoute override when provided", async () => {
    const routeA = handler({
      name: "a",
      execute: () => "a"
    });

    const block = router({
      name: "custom-validator",
      routes: [routeA],
      execute: () => routeA,
      validateRoute: () => false
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("invalid route");
  });

  it("throws when selected route has no run method", async () => {
    const valid = handler({
      name: "valid",
      execute: () => "ok"
    });

    // FIX-503: substrate dispatch entry is `run` (was `run` before the
    // BP-011 type firewall). Strip it to simulate a misshapen route.
    const missingRun = {
      ...valid,
      name: "missing-run",
      run: undefined
    };

    const block = router({
      name: "missing-run-route",
      routes: [valid, missingRun as unknown as typeof valid],
      execute: () => missingRun as unknown as typeof valid
    });

    const ctx = createMockContext();
    await expect(runForTest(block, 1, ctx)).rejects.toThrow("not a function");
  });
});
