/**
 * Tests for the `get_sector_peers` handler. Covers fixture mode,
 * live mode with mocked Finnhub + Yahoo responses, and the empty-payload
 * fallback.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_sector_peers } from "../src/flows/analysis/tools/data/get_sector_peers";
import { _resetCache } from "../src/lib/cache";
import { emptyPayload } from "../src/flows/analysis/tools/empty-payloads";
import { sectorPeersSchema } from "../src/flows/analysis/tools/schemas";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-test",
  actions: {
    run: { block: get_sector_peers },
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
  delete process.env.FINNHUB_API_KEY;
});

describe("get_sector_peers", () => {
  it("loads the curated fixture in fixture mode", async () => {
    const result = await testBlock(get_sector_peers, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.ticker).toBe("NVDA");
    expect(result.output.grouping).toBe("subIndustry");
    expect(result.output.peers.length).toBeGreaterThan(0);
    expect(result.output.peerMedianReturn1m).toBeTypeOf("number");
  });

  it("surfaces FixtureMissingError for an unknown ticker in fixture mode", async () => {
    const result = await testBlock(get_sector_peers, {
      input: { ticker: "ZZZZ", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain("Missing fixture for get_sector_peers");
  });

  it("returns peers from Finnhub in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify(["NVDA", "AMD", "INTC", "AVGO"]),
        { status: 200 },
      ),
    );
    const result = await testBlock(get_sector_peers, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("finnhub");
    expect(result.output.peers.length).toBe(3);
    expect(result.output.peers.map((p: { ticker: string }) => p.ticker)).toEqual(["AMD", "INTC", "AVGO"]);
  });

  it("returns unavailable when Finnhub fails in live mode", async () => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const result = await testBlock(get_sector_peers, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.peers).toEqual([]);
    expect(result.output.peerMedianReturn1m).toBeNull();
  });

  it("empty payload parses against the schema", () => {
    const payload = emptyPayload("get_sector_peers", {
      ticker: "ZZZZ",
      date: "2026-05-06",
    });
    expect(() => sectorPeersSchema.parse(payload)).not.toThrow();
    expect(payload.source).toBe("unavailable");
    expect(payload.peers).toEqual([]);
    expect(payload.peerMedianReturn1m).toBeNull();
  });
});
