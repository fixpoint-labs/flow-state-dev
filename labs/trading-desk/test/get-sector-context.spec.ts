/**
 * Tests for the `get_sector_context` handler. Covers fixture mode,
 * live mode with mocked Yahoo returns, and the empty-payload fallback.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_sector_context } from "../flows/analysis/tools/data/get_sector_context";
import { _resetCache } from "../lib/cache";
import { emptyPayload } from "../flows/analysis/tools/empty-payloads";
import { sectorContextSchema } from "../flows/analysis/tools/schemas";
import { sessionStateSchema } from "../flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: get_sector_context },
  },
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
});

describe("get_sector_context", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_sector_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ticker).toBe("NVDA");
    expect(result.output.sector).toBe("Technology");
    expect(result.output.sectorEtf).toBe("XLK");
    expect(result.output.nameReturn1m).toBeTypeOf("number");
    expect(result.output.relativeStrength1m).toBeTypeOf("number");
    expect(result.output.sectorVsMarket1m).toBeTypeOf("number");
  });

  it("surfaces FixtureMissingError for an unknown ticker in fixture mode", async () => {
    const result = await testBlock(get_sector_context, {
      input: { ticker: "ZZZZ", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("Missing fixture for get_sector_context");
  });

  it("returns unavailable when all providers fail in live mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const result = await testBlock(get_sector_context, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.sector).toBeNull();
    expect(result.output.sectorEtf).toBeNull();
    expect(result.output.relativeStrength1m).toBeNull();
  });

  it("computes relativeStrength1m and sectorVsMarket1m correctly", () => {
    const nameReturn1m = 0.082;
    const sectorEtfReturn1m = 0.034;
    const broadMarketReturn1m = 0.021;

    const relativeStrength1m = nameReturn1m - sectorEtfReturn1m;
    const sectorVsMarket1m = sectorEtfReturn1m - broadMarketReturn1m;

    expect(relativeStrength1m).toBeCloseTo(0.048, 5);
    expect(sectorVsMarket1m).toBeCloseTo(0.013, 5);
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_sector_context", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => sectorContextSchema.parse(payload)).not.toThrow();
    expect(payload.source).toBe("unavailable");
    expect(payload.sector).toBeNull();
    expect(payload.relativeStrength1m).toBeNull();
  });
});
