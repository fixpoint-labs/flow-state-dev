/**
 * Tests for the `get_institutional_ownership` handler. Covers fixture mode, the
 * no-key / all-fail degradation, and the live accumulation/distribution
 * derivation from a mocked Finnhub `/stock/ownership` response (Finnhub fetches
 * go through global `fetch`, so the response shape is mockable here — this is
 * where the summed-QoQ-change → flowDirection logic is verified).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_institutional_ownership } from "../src/flows/trading-desk/tools/data/get_institutional_ownership";
import { _resetCache } from "../src/flows/trading-desk/tools/runtime/cache";
import { emptyPayload } from "../src/flows/trading-desk/tools/empty-payloads";
import { institutionalOwnershipSchema } from "../src/flows/trading-desk/tools/schemas";
import { sessionStateSchema } from "../src/flows/trading-desk/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-institutional-ownership-test",
  actions: { run: { block: get_institutional_ownership } },
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

function ownershipResponse(rows: unknown[]) {
  return new Response(JSON.stringify({ ownership: rows }), { status: 200 });
}

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.FINNHUB_API_KEY;
});

describe("get_institutional_ownership", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_institutional_ownership, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.flowDirection).toBe("accumulating");
    expect(result.output.topHolders.length).toBeGreaterThan(0);
  });

  it("returns unavailable in live mode with no Finnhub key", async () => {
    delete process.env.FINNHUB_API_KEY;
    const result = await testBlock(get_institutional_ownership, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.flowDirection).toBeNull();
    expect(result.output.topHolders).toEqual([]);
  });

  it("reads a net positive QoQ change as accumulating in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ownershipResponse([
        { name: "Alpha Capital", share: 1_000_000, change: 50_000, filingDate: "2026-03-31" },
        { name: "Beta Advisors", share: 500_000, change: 30_000, filingDate: "2026-03-31" },
      ]),
    );
    const result = await testBlock(get_institutional_ownership, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("finnhub");
    expect(result.output.holderCount).toBe(2);
    expect(result.output.totalSharesHeld).toBe(1_500_000);
    expect(result.output.netShareChange).toBe(80_000);
    expect(result.output.flowDirection).toBe("accumulating");
    // topHolders sorted by shares descending.
    expect(result.output.topHolders[0]?.name).toBe("Alpha Capital");
  });

  it("reads a net negative QoQ change as distributing in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ownershipResponse([
        { name: "Alpha Capital", share: 1_000_000, change: -50_000, filingDate: "2026-03-31" },
        { name: "Beta Advisors", share: 500_000, change: -30_000, filingDate: "2026-03-31" },
      ]),
    );
    const result = await testBlock(get_institutional_ownership, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("finnhub");
    expect(result.output.flowDirection).toBe("distributing");
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_institutional_ownership", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => institutionalOwnershipSchema.parse(payload)).not.toThrow();
    expect(payload.source).toBe("unavailable");
    expect(payload.flowDirection).toBeNull();
  });
});
