/**
 * Tests for the `get_futures_curve` handler: fixture-mode load from the `_macro`
 * sentinel directory, the no-key / live-failure degrade, and the live happy path
 * that resolves the benchmark basket and computes the composite risk tone.
 *
 * Uses `testBlock` (per AGENTS.md rule 4 — never reach into block.config.execute).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_futures_curve } from "../flows/analysis/tools/data/get_futures_curve";
import { _resetCache } from "../lib/cache";
import { sessionStateSchema } from "../flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-futures-curve-test",
  actions: { run: { block: get_futures_curve } },
  session: { stateSchema: sessionStateSchema },
})({ id: "test" });

function sessionFor(dataSource: "fixture" | "live") {
  return {
    state: {
      ticker: "NVDA",
      date: "2026-05-06",
      costPreset: "fast" as const,
      dataSource,
      activePhase: "idle" as const,
      memoStatus: {},
    },
  };
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.MASSIVE_API_KEY;
});

describe("get_futures_curve handler", () => {
  it("loads the ticker-agnostic fixture from the _macro directory", async () => {
    const result = await testBlock(get_futures_curve, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.products.length).toBeGreaterThan(0);
    expect(result.output.products[0]).toHaveProperty("termStructure");
  });

  it("degrades to unavailable in live mode with no key (no fetch)", async () => {
    delete process.env.MASSIVE_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await testBlock(get_futures_curve, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resolves the basket and tags massive on the live path", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = String(input instanceof URL ? input.href : input);
      if (url.includes("/v3/futures/contracts")) {
        return new Response(JSON.stringify({ results: [{ ticker: "F1" }, { ticker: "F2" }] }), {
          status: 200,
        });
      }
      // aggregates: last 101, prior 100 → +1% session change
      return new Response(JSON.stringify({ results: [{ close: 101 }, { close: 100 }] }), {
        status: 200,
      });
    });

    const result = await testBlock(get_futures_curve, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("massive");
    expect(result.output.products).toHaveLength(5);
    const es = result.output.products.find((p) => p.productCode === "ES");
    expect(es?.lastPrice).toBe(101);
    expect(es?.changePct).toBeCloseTo(0.01, 6);
    // Every leg moved +1% identically, so the equity-minus-gold composite is 0
    // → neutral. A precise assertion: it would flip to risk-on if the composite
    // ever stopped subtracting the gold leg.
    expect(result.output.riskTone).toBe("neutral");
  });

  it("degrades to unavailable when no product prices", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("error", { status: 500 }),
    );
    const result = await testBlock(get_futures_curve, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
  });
});
