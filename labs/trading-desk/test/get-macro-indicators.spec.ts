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
import { get_macro_indicators } from "../flows/analysis/tools/data/get_macro_indicators";
import { _resetCache } from "../lib/cache";
import { sessionStateSchema } from "../flows/analysis/state";

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
    // The one failed series degrades to NULL — not to 0, and not the whole
    // payload (FIX-1063). This is the partial-answer path and the most
    // dangerous of the four: the payload still says `source: "fred"`, so the
    // value is the ONLY thing that could mark the miss. Reading `0` here told
    // the macro analyst high-yield credit spreads were measured at zero — a
    // dramatic risk-on signal — on a series that 500'd.
    expect(result.output.hyCreditSpread).toBeNull();
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
    expect(result.output.tenYearYield).toBeNull();
    expect(result.output.cpiYoy).toBeNull();
    expect(result.output.unemployment).toBeNull();
  });

  /**
   * Runs the handler with CPI answering SUCCESSFULLY (HTTP 200) with exactly
   * `cpiValues` observations, newest-first, and every other series on `fredOk`.
   *
   * The success path is the whole point. A CPI fetch that FAILS yields `[]`,
   * where every index is undefined and `cpiYoy` nulls no matter what the
   * year-ago rule is — so a test driven by an HTTP error cannot fail on the
   * defect it names. The defect lives on a 200 that is simply short.
   */
  async function runWithCpiObservations(cpiValues: number[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("series_id=CPIAUCSL")) {
        return new Response(
          JSON.stringify({
            observations: cpiValues.map((v, i) => ({
              // Newest-first: the handler requests `sort_order=desc`, so
              // index 12 is the year-ago monthly print.
              date: `2026-05-${String(28 - i).padStart(2, "0")}`,
              value: String(v),
            })),
          }),
          { status: 200 },
        );
      }
      return fredOk();
    });
    return testBlock(get_macro_indicators, {
      input: { date: "2026-05-06" },
      flow: fixtureFlow,
      session: sessionFor("live"),
    });
  }

  it("computes cpiYoy from the true year-ago print when 13 observations arrive (FIX-1063)", async () => {
    // 13 observations: index 0 is the latest (110), index 12 the year-ago
    // print (100). This is the positive control — without it, the two
    // null-asserting tests below would still pass if `cpiYoy` were hardcoded
    // to null.
    const cpi = [110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100.8, 100.4, 100];
    const result = await runWithCpiObservations(cpi);

    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fred");
    // (110 - 100) / 100 — measured against index 12, not the oldest value.
    expect(result.output.cpiYoy).toBeCloseTo(0.1);
  });

  it("reports cpiYoy null on a SUCCESSFUL single-observation response (FIX-1063)", async () => {
    // The 200-but-short path. One observation is enough for a level and not
    // enough for a year-over-year change. The old fallback read the oldest
    // available value as the year-ago print, so `yearAgoCpi === latestCpi`
    // and the payload published a fabricated 0% inflation under a live
    // `source: "fred"` tag — a macro reading, not a gap.
    const result = await runWithCpiObservations([110]);

    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fred");
    expect(result.output.cpiYoy).toBeNull();
    // The series that DID answer are unaffected.
    expect(result.output.tenYearYield).toBeCloseTo(0.041);
  });

  it("reports cpiYoy null rather than a short-window change mislabeled YoY (FIX-1063)", async () => {
    // Six observations: a real six-month change exists, but it is NOT
    // year-over-year. The old fallback published (110-100)/100 = 10% as an
    // ANNUAL rate. A window we cannot measure over a year is no reading.
    const result = await runWithCpiObservations([110, 108, 106, 104, 102, 100]);

    expect(result.error).toBeNull();
    expect(result.output.source).toBe("fred");
    expect(result.output.cpiYoy).toBeNull();
  });
});
