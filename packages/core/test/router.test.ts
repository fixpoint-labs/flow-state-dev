import { describe, expect, it } from "vitest";
import { handler, router } from "../src";
import { createMockContext } from "./helpers";

describe("router builder", () => {
  it("executes selected route", async () => {
    const low = handler<number, string>({
      name: "low",
      execute: () => "low"
    });
    const high = handler<number, string>({
      name: "high",
      execute: () => "high"
    });

    const block = router<number, string>({
      name: "route",
      routes: [low, high],
      execute: (value) => (value < 10 ? low : high)
    });

    const ctx = createMockContext();
    await expect(block.run(3, ctx)).resolves.toBe("low");
    await expect(block.run(20, ctx)).resolves.toBe("high");
  });

  it("throws when selected route is not in declared candidates", async () => {
    const inRoutes = handler<number, string>({
      name: "in-routes",
      execute: () => "ok"
    });
    const rogue = handler<number, string>({
      name: "rogue",
      execute: () => "rogue"
    });

    const block = router<number, string>({
      name: "route-validation",
      routes: [inRoutes],
      execute: () => rogue
    });

    const ctx = createMockContext();
    await expect(block.run(1, ctx)).rejects.toThrow("invalid route");
  });

  it("uses validateRoute override when provided", async () => {
    const routeA = handler<number, string>({
      name: "a",
      execute: () => "a"
    });

    const block = router<number, string>({
      name: "custom-validator",
      routes: [routeA],
      execute: () => routeA,
      validateRoute: () => false
    });

    const ctx = createMockContext();
    await expect(block.run(1, ctx)).rejects.toThrow("invalid route");
  });

  it("throws when selected route has no run method", async () => {
    const valid = handler<number, string>({
      name: "valid",
      execute: () => "ok"
    });

    const missingRun = {
      ...valid,
      name: "missing-run",
      run: undefined
    };

    const block = router<number, string>({
      name: "missing-run-route",
      routes: [valid, missingRun as unknown as typeof valid],
      execute: () => missingRun as unknown as typeof valid
    });

    const ctx = createMockContext();
    await expect(block.run(1, ctx)).rejects.toThrow("not a function");
  });
});
