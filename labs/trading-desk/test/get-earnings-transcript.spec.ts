/**
 * Tests for the `get_earnings_transcript` handler. Covers the live-mode Alpha
 * Vantage path (previously always-unavailable), the no-key degrade, and the
 * failure degrade to `emptyPayload`.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get_earnings_transcript } from "../flows/analysis/tools/data/get_earnings_transcript";
import { _resetCache } from "../lib/cache";
import { _resetBudget, _resetMinutePacing } from "../lib/providers/alpha-vantage";

const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(path.resolve(__dirname, ".."));
  _resetCache();
  _resetBudget();
  // FIX-801 minute pacing defaults to 5/min and is module-scoped; disabled
  // here (this suite predates pacing and doesn't exercise it) so cumulative
  // AV calls across tests never wait on a real 60s window.
  _resetMinutePacing();
  process.env.ALPHAVANTAGE_MINUTE_LIMIT = "0";
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  delete process.env.ALPHAVANTAGE_API_KEY;
  delete process.env.ALPHAVANTAGE_MINUTE_LIMIT;
  _resetBudget();
  _resetMinutePacing();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctx(dataSource: "fixture" | "live"): any {
  return { session: { state: { dataSource } } };
}

const execute = get_earnings_transcript.config.execute!;

const EARNINGS = {
  symbol: "NVDA",
  annualEarnings: [{ fiscalDateEnding: "2025-12-31" }],
  quarterlyEarnings: [
    { fiscalDateEnding: "2026-03-31", reportedDate: "2026-04-20" },
  ],
};
const TRANSCRIPT = {
  symbol: "NVDA",
  quarter: "2026Q1",
  transcript: [{ speaker: "CEO", title: "CEO", content: "Great quarter." }],
};

function mockAv(byFn: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
    const fn = new URL((input as URL).toString()).searchParams.get("function") ?? "";
    return Promise.resolve(new Response(JSON.stringify(byFn[fn] ?? {}), { status: 200 }));
  });
}

describe("get_earnings_transcript", () => {
  it("returns a live Alpha Vantage transcript when a key is set", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "av-key";
    mockAv({ EARNINGS, EARNINGS_CALL_TRANSCRIPT: TRANSCRIPT });
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("alphavantage");
    expect(out.available).toBe(true);
    expect(out.content).toContain("CEO (CEO): Great quarter.");
  });

  it("degrades to unavailable in live mode when no AV key is set", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("unavailable");
    expect(out.available).toBe(false);
    expect(spy).not.toHaveBeenCalled(); // gated on hasAlphaVantageKey()
  });

  it("degrades to unavailable when the AV path throws", async () => {
    process.env.ALPHAVANTAGE_API_KEY = "av-key";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const out = await execute({ ticker: "NVDA", date: "2026-05-06" }, ctx("live"));
    expect(out.source).toBe("unavailable");
    expect(out.available).toBe(false);
  });
});
