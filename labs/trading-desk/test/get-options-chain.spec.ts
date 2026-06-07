/**
 * Tests for the `get_options_chain` handler: fixture-mode load, the
 * no-key / live-failure degrade to `source: "unavailable"`, and the live happy
 * path that runs the snapshot through the options-math reduction.
 *
 * Uses `testBlock` (per AGENTS.md rule 4 — never reach into block.config.execute).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_options_chain } from "../src/flows/analysis/tools/data/get_options_chain";
import { _resetCache } from "../src/flows/analysis/tools/runtime/cache";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-options-chain-test",
  actions: { run: { block: get_options_chain } },
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

describe("get_options_chain handler", () => {
  it("loads the per-ticker fixture in fixture mode", async () => {
    const result = await testBlock(get_options_chain, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output.atmIv).toBeGreaterThan(0);
  });

  it("degrades to unavailable in live mode with no key (no fetch)", async () => {
    delete process.env.MASSIVE_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await testBlock(get_options_chain, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reduces a live snapshot to derivatives signals tagged massive", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                details: { strike_price: 118, expiration_date: "2026-05-15", contract_type: "call" },
                greeks: { delta: 0.5 },
                implied_volatility: 0.46,
                open_interest: 1000,
                day: { volume: 200 },
                underlying_asset: { price: 118.4 },
              },
              {
                details: { strike_price: 118, expiration_date: "2026-05-15", contract_type: "put" },
                greeks: { delta: -0.5 },
                implied_volatility: 0.48,
                open_interest: 1500,
                day: { volume: 250 },
                underlying_asset: { price: 118.4 },
              },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await testBlock(get_options_chain, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("massive");
    expect(result.output.spotPrice).toBe(118.4);
    expect(result.output.atmIv).toBeCloseTo(0.47, 6);
    expect(result.output.putCallOiRatio).toBeCloseTo(1.5, 6);
    expect(result.output.expiriesCovered).toBe(1);
  });

  it("stays tagged massive (not unavailable) for an empty-but-successful chain", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const result = await testBlock(get_options_chain, {
      input: { ticker: "ZZZZ", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    // The provider answered — the name simply has no listed options. That is a
    // real "massive" answer with null fields, not an "unavailable" failure.
    expect(result.output.source).toBe("massive");
    expect(result.output.atmIv).toBeNull();
    expect(result.output.expiriesCovered).toBe(0);
  });

  it("degrades to unavailable when the live fetch fails", async () => {
    process.env.MASSIVE_API_KEY = "test-key";
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("forbidden", { status: 403 }),
    );
    const result = await testBlock(get_options_chain, {
      input: { ticker: "NVDA", date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
  });
});
