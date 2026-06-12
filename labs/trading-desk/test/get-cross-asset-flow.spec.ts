/**
 * Tests for the `get_cross_asset_flow` handler. Covers fixture mode, the
 * live-mode all-providers-fail degradation, and empty-payload schema validity.
 *
 * The directional logic (spread classification, composite appetite, NFCI
 * trend) lives in `cross-asset-math` and is unit-tested in
 * `cross-asset-math.spec.ts`; these tests pin the handler's mode-branching and
 * honest degradation, not the math.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_cross_asset_flow } from "../src/flows/analysis/tools/data/get_cross_asset_flow";
import { _resetCache } from "../src/flows/analysis/tools/runtime/cache";
import { emptyPayload } from "../src/flows/analysis/tools/empty-payloads";
import { crossAssetFlowSchema } from "../src/flows/analysis/tools/schemas";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-cross-asset-flow-test",
  actions: { run: { block: get_cross_asset_flow } },
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
  delete process.env.FRED_API_KEY;
});

describe("get_cross_asset_flow", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_cross_asset_flow, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ratios.length).toBe(4);
    expect(result.output.riskAppetite).toBe("risk-on");
    expect(result.output.nameVsBroadMarket).toBeTypeOf("number");
    expect(result.output.liquidity?.nfciTrend).toBe("easing");
  });

  it("degrades to unavailable when every provider fails in live mode", async () => {
    delete process.env.FRED_API_KEY; // no NFCI liquidity block
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const result = await testBlock(get_cross_asset_flow, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    // The basket entries still render, but every leg/spread is an honest null.
    expect(result.output.ratios.length).toBe(4);
    expect(result.output.ratios.every((r) => r.spread === null)).toBe(true);
    expect(result.output.riskAppetite).toBeNull();
    expect(result.output.nameVsBroadMarket).toBeNull();
    expect(result.output.liquidity).toBeNull();
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_cross_asset_flow", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => crossAssetFlowSchema.parse(payload)).not.toThrow();
    expect(payload.source).toBe("unavailable");
    expect(payload.riskAppetite).toBeNull();
    expect(payload.liquidity).toBeNull();
  });
});
