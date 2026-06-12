/**
 * Tests for the `get_macro_indicators` handler — in particular its per-series
 * resilience (FIX-704 follow-up).
 *
 * Regression: the live FRED fetch used to wrap all nine series in a single
 * `Promise.all` inside one try/catch, so ONE failing/renamed/rate-limited
 * series collapsed the entire payload to `source: "unavailable"` with all
 * zeros — which left the Macro Analyst with nothing to read. The fix degrades
 * each series independently; "unavailable" is reported only when every series
 * fails. These tests pin that behavior.
 *
 * Uses `testBlock` for the handler (per AGENTS.md rule 4 — never reach into
 * `block.config.execute`).
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlow } from "@flow-state-dev/core";
import { testBlock } from "@flow-state-dev/testing";
import { get_macro_indicators } from "../src/flows/analysis/tools/data/get_macro_indicators";
import { _resetCache } from "../src/flows/analysis/tools/runtime/cache";
import { sessionStateSchema } from "../src/flows/analysis/state";

const fixtureFlow = defineFlow({
  kind: "trading-desk-macro-indicators-test",
  actions: {
    run: { block: get_macro_indicators },
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

/** A valid single-observation FRED response. The value "4.1" reads as 0.041
 *  for rate-like fields (divided by 100) and 4.1 for index-level fields. */
function fredOk() {
  return new Response(
    JSON.stringify({ observations: [{ date: "2026-05-01", value: "4.1" }] }),
    { status: 200 },
  );
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

describe("get_macro_indicators handler", () => {
  it("loads the ticker-agnostic fixture in fixture mode", async () => {
    const result = await testBlock(get_macro_indicators, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("fixture"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fixture");
    expect(result.output).toHaveProperty("yieldCurve2s10s");
  });

  it("falls back to unavailable in live mode with no API key", async () => {
    delete process.env.FRED_API_KEY;
    const result = await testBlock(get_macro_indicators, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
  });
});

describe("get_macro_indicators per-series resilience", () => {
  beforeEach(() => {
    process.env.FRED_API_KEY = "test-key";
  });

  it("survives a single failing series — others populate, source stays fred (regression)", async () => {
    // One series (HY credit spread) 500s; every other series answers.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("series_id=BAMLH0A0HYM2")) {
        return new Response("upstream error", { status: 500 });
      }
      return fredOk();
    });

    const result = await testBlock(get_macro_indicators, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });

    expect(result.error).toBeNull();
    // The bug: one failure used to make the whole payload "unavailable".
    expect(result.output.source).toBe("fred");
    // Surviving rate-like series are populated (value 4.1 → 0.041).
    expect(result.output.tenYearYield).toBeCloseTo(0.041);
    expect(result.output.fedFundsRate).toBeCloseTo(0.041);
    // Index-level series are stored raw (no /100).
    expect(result.output.dollarIndex).toBeCloseTo(4.1);
    // The one failed series degrades to 0 — not the whole payload.
    expect(result.output.hyCreditSpread).toBe(0);
  });

  it("retries a transient 429 and recovers the series", async () => {
    // HY spread is throttled on its first call, then answers on retry.
    let hyCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("series_id=BAMLH0A0HYM2")) {
        hyCalls += 1;
        if (hyCalls === 1) return new Response("rate limited", { status: 429 });
        return new Response(
          JSON.stringify({ observations: [{ date: "2026-05-01", value: "3.2" }] }),
          { status: 200 },
        );
      }
      return fredOk();
    });

    const result = await testBlock(get_macro_indicators, {
      input: { date: "2026-06-01" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });

    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fred");
    // The 429 was retried rather than swallowed as a permanent failure...
    expect(hyCalls).toBeGreaterThanOrEqual(2);
    // ...so the series ends up populated (3.2 → 0.032), not 0.
    expect(result.output.hyCreditSpread).toBeCloseTo(0.032);
  });

  it("reports unavailable only when every series fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("upstream error", { status: 500 }),
    );

    const result = await testBlock(get_macro_indicators, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });

    expect(result.error).toBeNull();
    expect(result.output.source).toBe("unavailable");
    expect(result.output.tenYearYield).toBe(0);
  });
});
